import {accountErrorText,isAccountChanged,AccountRequestError,safeSocialRedirect,ACCOUNT_REAUTH_PATH} from './flow.mjs'

const names = {credential:'Email',email:'Email',google:'Google',github:'GitHub',apple:'Apple'}
const node = (tag,text,className) => { const item=document.createElement(tag); if(text)item.textContent=text; if(className)item.className=className; return item }
const link = (text,href) => {const item=node('a',text,'text-button');item.href=href;return item}

// Reset tokens are transient. The caller removes the query before any request;
// neither drafts nor account preferences ever receive the token.
export function accountEntry(value) {
  const url=new URL(value)
  const token=url.searchParams.get('token')
  const resetToken=url.searchParams.get('view')==='reset' && typeof token==='string' && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : null
  const linkError=url.searchParams.has('error')
  const oauthError=url.searchParams.get('oauth')==='failed'
  url.searchParams.delete('token');url.searchParams.delete('error');url.searchParams.delete('error_description');url.searchParams.delete('oauth')
  return {resetToken,linkError,oauthError,cleanURL:url.pathname+url.search+url.hash}
}

export function createAccountViews({root,api,onMessage,onExpired,onUser,onPreferences}) {
  let generation=0, running=false
  function field(form,label,{type='text',value='',autocomplete='',minLength,maxLength=128}={}) {
    const wrapper=node('div',null,'field'), text=node('label',label), input=node('input')
    const id='manage-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-')
    input.id=id;text.htmlFor=id;input.type=type;input.value=value;input.autocomplete=autocomplete;input.required=true;input.maxLength=maxLength
    if(minLength)input.minLength=minLength
    wrapper.append(text,input);form.append(wrapper);return input
  }
  function action(text,run,className='primary') {
    const button=node('button',text,className);button.type='button';button.addEventListener('click',run);return button
  }
  function form(title,buttonText,submit) {
    const item=node('form',null,'account-section');item.method='post';item.append(node('h2',title))
    const button=node('button',buttonText,'primary');button.type='submit'
    item.addEventListener('submit',event=>{event.preventDefault();if(item.reportValidity())void submit(item)})
    return {item,button,finish(){item.append(button);root.append(item)}}
  }
  async function run(work,success='Saved.') {
    if(running)return
    running=true;const mine=generation
    root.querySelectorAll('input,button,select').forEach(item=>{item.disabled=true})
    onMessage('')
    try {await work();if(mine===generation && success)onMessage(success)}
    catch(error){if(mine===generation){if(isAccountChanged(error)||error?.status===401)onExpired(error);else onMessage(accountErrorText(error,'manage'),true)}}
    finally{if(mine===generation){running=false;root.querySelectorAll('input,button,select').forEach(item=>{item.disabled=false})}}
  }
  async function render(view,{config,user,resetToken,linkError,hasDraft=false}={}) {
    const mine=++generation;running=false;root.replaceChildren()
    const back=link('Back to sign in','/create?signin=1')
    const emailEnabled=config?.providers?.includes('email') === true && config?.emailMode !== 'disabled'
    if(view==='recover') {
      if(!emailEnabled || !config?.features.passwordRecovery){root.append(node('p','Email recovery is unavailable. Use your connected sign-in method.'),back);return}
      const section=form('Recover your account','Request reset link',()=>run(()=>api.requestPasswordReset(email.value.trim()),'Reset link requested. Check your inbox.'))
      const email=field(section.item,'Recovery email',{type:'email',autocomplete:'email',value:user?.email || '',maxLength:254})
      section.finish();root.append(back);return
    }
    if(view==='reset') {
      if(!emailEnabled || !config?.features.passwordRecovery){root.append(node('p','Email recovery is unavailable. Use your connected sign-in method.'),back);return}
      if(!resetToken || linkError){root.append(node('p','This reset link is missing, invalid or expired.'),link('Request a new link','/create?view=recover'),back);return}
      let token=resetToken
      const section=form('Choose a new password','Reset password',()=>run(async()=>{
        if(password.value!==confirmation.value)throw new AccountRequestError('PASSWORD_MISMATCH',400)
        await api.resetPassword({token,newPassword:password.value});token=null;password.value=confirmation.value='';section.item.hidden=true;root.append(back)
      },'Password changed. Sign in to continue.'))
      const password=field(section.item,'New password',{type:'password',autocomplete:'new-password',minLength:12})
      const confirmation=field(section.item,'Confirm password',{type:'password',autocomplete:'new-password',minLength:12})
      section.finish();return
    }
    if(view==='verify') {
      if(!linkError && user?.emailVerified){root.append(node('p','Signed in as '+user.email,'account-address'),node('p',"This account's email is verified."),link(hasDraft?'Continue your idea':'Open workspace',hasDraft?'/create':'/workspace'));return}
      root.append(node('p',linkError?'Verification didn’t finish. Try again or request another link.':'Open the link in your email, then sign in.'))
      if(user?.email)root.append(node('p','Signed in as '+user.email,'account-address'))
      root.append(link(user?'Use another account':'Sign in',user?ACCOUNT_REAUTH_PATH:'/create?view=account'))
      if(!emailEnabled || !config?.features.emailVerification){root.append(node('p','Email verification is unavailable.'));return}
      const section=form('Request verification','Request link',()=>run(()=>api.resendVerification(email.value.trim()),'Verification link requested. Check your inbox.'))
      const email=field(section.item,'Verification email',{type:'email',autocomplete:'email',value:user?.email || '',maxLength:254})
      section.finish();return
    }
    if(!user || !config?.features.accountManagement){root.append(node('p','Sign in to manage your account.'),back);return}
    root.append(node('p',user.email || '', 'account-address'))
    const name=form('Profile','Save name',()=>run(async()=>{
      await api.updateName(displayName.value.trim())
      const session=await api.session()
      if(session?.user?.id!==user.id)throw new AccountRequestError('account_changed',403)
      user=session.user;onUser(session.user)
    }))
    const displayName=field(name.item,'Name',{value:user.name || '',autocomplete:'name',maxLength:80});name.finish()
    if(emailEnabled && config.features.emailVerification) {
      const emailChange=form('Email','Request email change',()=>run(()=>api.changeEmail(newEmail.value.trim()),'Email change requested. Confirm it from your email.'))
      const newEmail=field(emailChange.item,'New email',{type:'email',autocomplete:'email',maxLength:254});emailChange.finish()
    }
    const security=node('section',null,'account-section');security.append(node('h2','Security'))
    const sessions=node('p','Checking active sessions…');security.append(sessions,action('Sign out other devices',()=>run(async()=>{await api.revokeOtherSessions();sessions.textContent='Other sessions signed out.'},''),'social-button'))
    const reauthenticate=link('Sign in again',ACCOUNT_REAUTH_PATH);reauthenticate.hidden=true;security.append(reauthenticate)
    root.append(security)
    const password=form('Password','Change password',()=>run(async()=>{
      await api.changePassword({currentPassword:current.value,newPassword:next.value});current.value=next.value=''
    },'Password changed. Other sessions signed out.'))
    const current=field(password.item,'Current password',{type:'password',autocomplete:'current-password'})
    const next=field(password.item,'New account password',{type:'password',autocomplete:'new-password',minLength:12});password.finish()
    password.item.hidden=true
    const connections=node('section',null,'account-section');connections.append(node('h2','Sign-in methods'))
    const accountsList=node('div');connections.append(accountsList);root.append(connections)
    const footer=node('div',null,'account-links')
    footer.append(action('Preferences',onPreferences,'text-button'),link('Open workspace','/workspace'),action('Sign out',()=>run(async()=>{await api.signOut();onUser(null);location.replace('/create?signin=1')},''),'text-button'))
    if(hasDraft)footer.append(link('Continue idea','/create'))
    root.append(footer)
    function loadError(error) {
      if(isAccountChanged(error)||error?.status===401)onExpired(error)
      else onMessage(accountErrorText(error,'manage'),true)
    }
    async function loadSessions() {
      try {
        const active=await api.sessions()
        if(mine!==generation)return
        sessions.textContent=Array.isArray(active)?`${active.length} active ${active.length===1?'session':'sessions'}.`:'Session details unavailable.'
      } catch(error) {
        if(mine!==generation)return
        if(error?.code==='SESSION_NOT_FRESH') {
          sessions.textContent='Sign in again to view active sessions.'
          reauthenticate.hidden=false
        } else {sessions.textContent='Session details unavailable.';loadError(error)}
      }
    }
    async function loadAccounts() {
      try {
        const accounts=await api.accounts()
        if(mine!==generation)return
        const methods=Array.isArray(accounts)?accounts:[]
        const usable=method=>config.providers.includes(method.providerId==='credential'?'email':method.providerId)
        const usableMethods=methods.filter(usable)
        const emailAccount=methods.some(item=>item.providerId==='credential')
        password.item.hidden=!(emailEnabled && emailAccount)
        if(emailEnabled && !emailAccount && config.features.passwordRecovery)root.append(link('Set up email sign-in','/create?view=recover'))
        for(const item of methods) {
          const row=node('div',null,'account-method');row.append(node('span',(names[item.providerId] || 'Linked account')+(usable(item)?'':' · unavailable')))
          if(usable(item) && usableMethods.length>1 && config.features.accountLinking && item.providerId!=='credential')row.append(action('Disconnect',()=>run(async()=>{await api.unlinkAccount(item.id);await render('account',{config,user,hasDraft})},''),'text-button'))
          accountsList.append(row)
        }
        if(config.features.accountLinking)for(const provider of config.providers.filter(item=>item!=='email'&&!methods.some(account=>account.providerId===item))) {
          accountsList.append(action('Connect '+names[provider],()=>run(async()=>{const response=await api.linkSocial(provider);const url=safeSocialRedirect(response?.url,provider);if(!url)throw new AccountRequestError('invalid-response');location.assign(url)},''),'social-button'))
        }
      } catch(error) {
        if(mine!==generation)return
        accountsList.textContent='Sign-in methods unavailable.'
        loadError(error)
      }
    }
    await Promise.all([loadSessions(),loadAccounts()])
  }
  return {render,cancel(){generation++;running=false}}
}
