import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {DRAFT_KEY,DRAFT_TTL,readDraft,writeDraft,clearDraft,onboardingIntent,normalizePreferences,validPrompt} from '../src/create/draft.mjs'
import {createAccountApi,normalizeAccountConfig,allowedEmail,safeSocialRedirect,AccountRequestError,accountErrorText,isAccountChanged,resolveCreateEntry} from '../src/create/flow.mjs'

const at = Date.parse('2026-11-13T12:00:00Z')
function memory() {
  const values = new Map()
  return {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value),removeItem:key => values.delete(key),values}
}
function fixture() {
  const storage = memory()
  let serial = 0
  return {storage,now:() => at,id:() => `draft_${++serial}`}
}

test('returning sign-in and preferences routes do not require or invent a generation prompt', () => {
  const config = {enabled:true,configured:true}
  assert.deepEqual(resolveCreateEntry({search:'?signin=1',config}),{mode:'signin',step:'auth'})
  assert.deepEqual(resolveCreateEntry({search:'?signin=1',config,signedIn:true}),{mode:'signin',step:'workspace'})
  assert.deepEqual(resolveCreateEntry({search:'?edit=1',config}),{mode:'profile',step:'auth'})
  assert.deepEqual(resolveCreateEntry({search:'?edit=1',config,signedIn:true}),{mode:'profile',step:'onboarding'})
  assert.deepEqual(resolveCreateEntry({search:'?edit=1&redirect=https://example.com',config,signedIn:true}),{mode:'profile',step:'onboarding'})
  assert.deepEqual(resolveCreateEntry({config,signedIn:true}),{mode:'project',step:'prompt'})
})

test('a pending idea retains its creation flow and accounts-off visitors never see an empty sign-in screen', () => {
  const config = {enabled:true,configured:true}
  for (const search of ['?signin=1','?edit=1']) {
    assert.deepEqual(resolveCreateEntry({search,hasDraft:true,config}),{mode:'project',step:'auth'})
    assert.deepEqual(resolveCreateEntry({search,hasDraft:true,config,signedIn:true}),{mode:'project',step:'onboarding'})
    assert.deepEqual(resolveCreateEntry({search,config:{enabled:false,configured:false}}),{mode:'project',step:'prompt'})
    assert.deepEqual(resolveCreateEntry({search,config:{enabled:true,configured:false}}),{mode:'project',step:'prompt'})
  }
  assert.deepEqual(resolveCreateEntry({hasDraft:true,config:{enabled:false}}),{mode:'project',step:'onboarding'})
  assert.deepEqual(resolveCreateEntry({hasDraft:true}),{mode:'project',step:'auth'})
})

test('an original multi-line idea survives auth redirects, preferences and a reload until its completed build is claimed', () => {
  const options = fixture()
  const prompt = '  A website for my studio.\nKeep the gallery quiet.  '
  const first = writeDraft({prompt},options)
  assert.equal(first.ok,true)
  assert.equal(first.draft.prompt,prompt)
  assert.equal(first.draft.ready,false)
  const selected = writeDraft({prompt,preferences:{projectType:'website',visualDirection:'editorial'}},options)
  const reloaded = readDraft({...options,now:() => at + 60000})
  assert.equal(reloaded.prompt,prompt)
  assert.deepEqual(reloaded.preferences,{projectType:'website',visualDirection:'editorial'})
  assert.equal(reloaded.ready,false)
  const ready = writeDraft({...reloaded,ready:true},{...options,now:() => at + 120000})
  assert.equal(ready.draft.ready,true)
  assert.equal(ready.draft.id,selected.draft.id)
  assert.equal(ready.draft.expiresAt,at + DRAFT_TTL)
  assert.equal(clearDraft({...options,id:ready.draft.id}),true)
  assert.equal(readDraft(options),null)
})

test('failed validation, blocked writes and stale build completion do not discard a newer idea or saved projects', () => {
  const options = fixture()
  options.storage.setItem('compass.projects.v1','existing-projects')
  const first = writeDraft({prompt:'A site for Forma'},options)
  assert.equal(writeDraft({prompt:' '},options).error,'invalid-prompt')
  assert.equal(readDraft(options).id,first.draft.id)
  const second = writeDraft({prompt:'A booking page for my studio'},options)
  assert.equal(clearDraft({...options,id:first.draft.id}),false)
  assert.equal(readDraft(options).prompt,second.draft.prompt)
  const blocked = {...options.storage,setItem(){throw Error('quota')}}
  assert.equal(writeDraft({prompt:'Another idea'},{...options,storage:blocked}).error,'storage-unavailable')
  assert.equal(readDraft(options).id,second.draft.id)
  assert.equal(options.storage.getItem('compass.projects.v1'),'existing-projects')
  assert.equal(clearDraft(options),false)
})

test('a changed style or reopened ready handoff has a different claim id and cannot be cleared by an earlier build', () => {
  const options = fixture()
  const first = writeDraft({prompt:'A studio page',preferences:{visualDirection:'minimal'},ready:true},options)
  const next = writeDraft({prompt:first.draft.prompt,preferences:{visualDirection:'bold'}},options)
  assert.notEqual(next.draft.id,first.draft.id)
  assert.equal(clearDraft({...options,id:first.draft.id}),false)
  assert.equal(readDraft(options).preferences.visualDirection,'bold')
})

test('draft expiry clears only the handoff and cannot be extended by redirects or arbitrary stored timestamps', () => {
  const options = fixture()
  options.storage.setItem('compass.projects.v1','keep')
  writeDraft({prompt:'An architecture website'},options)
  assert.ok(readDraft({...options,now:() => at + DRAFT_TTL - 1}))
  assert.equal(readDraft({...options,now:() => at + DRAFT_TTL}),null)
  assert.equal(options.storage.getItem(DRAFT_KEY),null)
  assert.equal(options.storage.getItem('compass.projects.v1'),'keep')
  for (const raw of ['{broken',JSON.stringify({schema:1,id:'a',prompt:'A page',createdAt:at,expiresAt:at + DRAFT_TTL * 10}),'x'.repeat(5000)]) {
    options.storage.setItem(DRAFT_KEY,raw)
    assert.equal(readDraft(options),null)
    assert.equal(options.storage.getItem(DRAFT_KEY),null)
  }
})

test('a draft accepts literal prompt text but never imports identity, HTML, redirect targets or arbitrary preferences', () => {
  const options = fixture()
  const prompt = '<script>literal idea</script> for a studio'
  const result = writeDraft({prompt,userId:'another-user',html:'active HTML',redirect:'https://example.com',preferences:{projectType:'saas',visualDirection:'editorial',owner:'x',theme:'dark'}},options)
  assert.equal(result.ok,true)
  const restored = readDraft(options)
  assert.equal(restored.prompt,prompt)
  assert.deepEqual(restored.preferences,{projectType:'saas',visualDirection:'editorial'})
  for (const key of ['html','redirect','userId','owner']) assert.equal(key in restored,false)
  assert.deepEqual(normalizePreferences({projectType:'__proto__',visualDirection:'invented'}),{})
  assert.equal(validPrompt('x'.repeat(501)),false)
  assert.equal(validPrompt('an idea\u0000'),false)
  assert.equal(writeDraft({prompt:'A valid idea'},{storage:null}).ok,false)
})

test('personalization produces bounded rendering changes without overriding the original business or declaring app generation', () => {
  const editorial = onboardingIntent({projectType:'saas',visualDirection:'editorial'})
  assert.deepEqual(editorial,{theme:'light',font:'serif',hero:'split',density:'airy',accent:'slate'})
  assert.equal('business' in editorial,false)
  assert.equal('kind' in editorial,false)
  assert.deepEqual(onboardingIntent({visualDirection:'custom'}),{})
  assert.deepEqual(onboardingIntent({}),{})
})

test('only configured supported providers are offered and test accounts remain limited to reserved .test addresses', () => {
  assert.deepEqual(normalizeAccountConfig({enabled:false,configured:true,providers:['email','google']}).providers,[])
  assert.deepEqual(normalizeAccountConfig({enabled:true,configured:false,providers:['email']}).providers,[])
  const config = normalizeAccountConfig({enabled:true,configured:true,providers:['email','apple','apple','unknown'],emailMode:'test'})
  assert.deepEqual(config.providers,['email','apple'])
  assert.equal(allowedEmail('founder@example.test',config),true)
  assert.equal(allowedEmail('founder@example.com',config),false)
  assert.equal(allowedEmail('bad@address',config),false)
  assert.equal(allowedEmail('founder@example.com',{emailMode:'verified'}),true)
  const realMail = normalizeAccountConfig({enabled:true,configured:true,providers:['email'],emailMode:'verification'})
  assert.equal(realMail.emailMode,'verified')
  assert.equal(allowedEmail('founder@example.com',realMail),true)
})

test('account form enforces the backend minimum password policy before sending credentials', async () => {
  const html = await readFile(new URL('../create.html',import.meta.url),'utf8')
  const password = html.match(/<input\b[^>]*id="account-password"[^>]*>/)?.[0]
  assert.ok(password)
  assert.ok(Number(password.match(/minlength="(\d+)"/)?.[1]) >= 12)
  assert.match(password,/type="password"/)
  assert.match(password,/maxlength="128"/)
  assert.match(html,/At least 12 characters/)
})

test('account requests use same-origin HttpOnly cookies and keep passwords and prompts out of URLs and callbacks', async () => {
  const calls = []
  const api = createAccountApi({origin:'https://preview.example/create?untrusted=anything',fetch:async (url,options) => {
    calls.push({url,options})
    return {ok:true,status:200,json:async () => url === '/api/account/config' ? {enabled:true,configured:true,providers:['email'],emailMode:'test'} : {user:{id:'u_1'},session:{id:'s_1'}}}
  }})
  await api.config()
  await api.signUp({name:'Test founder',email:'founder@example.test',password:'not-a-real-password',prompt:'private idea'})
  await api.session()
  api.bindUser('u_1')
  await api.saveProfile({projectType:'website',visualDirection:'minimal'})
  const signup = calls.find(call => call.url === '/api/auth/sign-up/email')
  assert.deepEqual(JSON.parse(signup.options.body),{name:'Test founder',email:'founder@example.test',password:'not-a-real-password',callbackURL:'https://preview.example/create'})
  assert.ok(calls.every(call => !call.url.includes('?') && call.options.credentials === 'same-origin' && call.options.cache === 'no-store'))
  assert.ok(calls.every(call => !('authorization' in call.options.headers)))
  const profile = calls.find(call => call.url === '/api/account/profile')
  assert.equal(profile.options.method,'PUT')
  assert.equal(profile.options.headers['x-compass-user'],'u_1')
  assert.ok(calls.filter(call => call.url.startsWith('/api/auth/')).every(call => !('x-compass-user' in call.options.headers)))
  assert.deepEqual(JSON.parse(profile.options.body),{preferences:{projectType:'website',visualDirection:'minimal'}})
})

test('private profile reads and writes bind the verified user and reject shared-cookie account changes', async () => {
  const calls = []
  const api = createAccountApi({origin:'https://preview.example',fetch:async (url,options) => {
    calls.push({url,options})
    return {ok:false,status:403,json:async () => ({error:'account_changed'})}
  }})
  await assert.rejects(api.profile(),error => error.status === 401)
  assert.equal(calls.length,0,'no private request before a verified user is bound')
  api.bindUser('user_a')
  for (const operation of [() => api.profile(),() => api.saveProfile({visualDirection:'minimal'})]) {
    await assert.rejects(operation(),error => {
      assert.equal(isAccountChanged(error),true)
      assert.ok(accountErrorText(error).includes('Sign in again'))
      return true
    })
  }
  assert.ok(calls.every(call => call.options.headers['x-compass-user'] === 'user_a'))
  api.bindUser(null)
  await assert.rejects(api.saveProfile({}),error => error.status === 401)
  assert.equal(calls.length,2)
})

test('returning authentication callbacks retain only controlled mode flags, never a prompt or arbitrary destination', async () => {
  const calls = []
  const api = createAccountApi({origin:'https://preview.example',fetch:async (url,options) => {
    calls.push({url,body:JSON.parse(options.body)})
    return {ok:true,status:200,json:async () => ({})}
  }})
  api.setReturnMode('signin')
  await api.signIn({email:'returning@example.test',password:'not-a-real-password'})
  api.setReturnMode('profile')
  await api.social('google')
  api.setReturnMode('project')
  await api.social('github')
  assert.deepEqual(calls.map(call => call.body.callbackURL),[
    'https://preview.example/create?signin=1','https://preview.example/create?edit=1','https://preview.example/create',
  ])
  assert.throws(() => api.setReturnMode('https://example.com'),TypeError)
  assert.ok(calls.every(call => !('prompt' in call.body)))
})

test('a profile response already in flight is discarded when the UI identity binding changes', async () => {
  let finish
  const api = createAccountApi({origin:'https://preview.example',fetch:async () => new Promise(resolve => { finish = resolve })})
  api.bindUser('user_a')
  const profile = api.profile()
  api.bindUser('user_b')
  finish({ok:true,status:200,json:async () => ({preferences:{visualDirection:'editorial'}})})
  await assert.rejects(profile,error => isAccountChanged(error))
})

test('network, malformed-response and server errors are actionable without leaking raw credentials or internal messages', async () => {
  const failure = createAccountApi({origin:'https://preview.example',fetch:async () => ({ok:false,status:401,json:async () => ({code:'INVALID_EMAIL_OR_PASSWORD',message:'internal secret should not be shown'})})})
  await assert.rejects(failure.signIn({email:'a@example.test',password:'bad password'}),error => {
    assert.equal(error.status,401)
    assert.equal(error.message,'Account request failed')
    assert.ok(!accountErrorText(error).includes('internal secret'))
    return true
  })
  const malformed = createAccountApi({origin:'https://preview.example',fetch:async () => ({ok:true,status:200,json:async () => {throw Error('html')}})})
  await assert.rejects(malformed.session(),error => error.code === 'invalid-response')
  const network = createAccountApi({origin:'https://preview.example',fetch:async () => {throw Error('private network detail')}})
  await assert.rejects(network.config(),error => error.code === 'network')
  assert.ok(accountErrorText(new AccountRequestError('request-failed',429)).includes('Wait'))
  assert.ok(accountErrorText(new AccountRequestError('request-failed',500),'profile').includes('save your choices'))
})

test('social redirects accept only the configured provider HTTPS origin, excluding lookalikes and credentials', () => {
  assert.equal(safeSocialRedirect('https://accounts.google.com/o/oauth2/v2/auth?state=server-owned','google'),'https://accounts.google.com/o/oauth2/v2/auth?state=server-owned')
  for (const value of ['javascript:alert(1)','http://accounts.google.com/auth','https://accounts.google.com.example.com/auth','https://accounts.google.com:8443/auth','https://user:secret@accounts.google.com/auth','https://github.com/login/oauth/authorize']) assert.equal(safeSocialRedirect(value,'google'),null)
  assert.equal(safeSocialRedirect('https://github.com/login/oauth/authorize','github'),'https://github.com/login/oauth/authorize')
})
