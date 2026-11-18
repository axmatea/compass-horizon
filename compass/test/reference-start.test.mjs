import test from 'node:test'
import assert from 'node:assert/strict'
import {BUILD_TYPES,REFERENCE_PRESETS,normalizeReference,suggestBlueprint,compileReferenceBrief} from '../src/start/reference.mjs'

const reference=raw=>{const result=normalizeReference(raw);assert.equal(result.ok,true,result.message);return result.value}
const plan=(overrides={})=>({reference:reference('Notion'),type:'tracker',name:'North Studio',features:['title','status','notes'],notes:'',...overrides})

test('reference intake recognizes known apps without retaining URL paths, credentials or tokens',()=>{
  for(const preset of REFERENCE_PRESETS) {
    const named=reference(preset.name),linked=reference('https://www.'+preset.host+'/private/project?token=private-value#client-name')
    assert.equal(named.presetId,preset.id);assert.equal(linked.presetId,preset.id)
    assert.equal(linked.type,preset.type)
    assert.ok(!JSON.stringify(linked).includes('private'));assert.ok(!JSON.stringify(linked).includes('client-name'))
  }
  assert.equal(reference('notion.so/a-page?secret=123').name,'Notion')
  assert.equal(reference('https://docs.notion.so/path').presetId,'notion')
  assert.equal(reference('https://notion.so.attacker.com/path').presetId,null)
  assert.equal(reference('An app I like').host,null)
})

test('local/private addresses, unsupported schemes and malformed reference data fail before a handoff',()=>{
  for(const raw of ['https://localhost','https://127.0.0.1','http://127.1','http://2130706433','http://0x7f000001','https://[::1]','https://[::ffff:127.0.0.1]','https://office.internal','https://host.local','https://subdomain.test']) {
    assert.equal(normalizeReference(raw).ok,false,raw)
  }
  for(const raw of ['javascript:alert(1)','file:///private/data','data:text/html,test','ftp://notion.so'])assert.equal(normalizeReference(raw).error,'unsupported-protocol',raw)
  for(const raw of ['https://user:password@notion.so','https://notion.so:8443','https://bad..com','Notion\nsecret','<script>app</script>','x'.repeat(2049)])assert.equal(normalizeReference(raw).ok,false,raw)
  assert.equal(normalizeReference('').error,'reference-required')
})

test('known app patterns suggest supported kinds while unknown references preserve the requested target',()=>{
  assert.equal(suggestBlueprint(reference('Notion')).type,'tracker')
  assert.equal(suggestBlueprint(reference('HubSpot')).type,'crm')
  assert.equal(suggestBlueprint(reference('Shopify')).type,'inventory')
  assert.equal(suggestBlueprint(reference('Airbnb')).type,'booking')
  assert.equal(suggestBlueprint(reference('An app I like'),{defaultTarget:'app'}).type,'tracker')
  assert.equal(suggestBlueprint(reference('An app I like'),{defaultTarget:'website'}).type,'website')
  const value=suggestBlueprint(reference('Notion'));value.features.pop()
  assert.deepEqual(suggestBlueprint(reference('Notion')).features,['title','status','notes'])
})

test('compilation produces bounded editable original-project briefs and the existing account/guest paths',()=>{
  for(const type of BUILD_TYPES) {
    const result=compileReferenceBrief(plan({type:type.id,features:[...type.defaultFeatures],notes:'Use blue accents.'}))
    assert.equal(result.ok,true,result.message);assert.ok(result.prompt.length<=500)
    assert.match(result.prompt,/called "North Studio"/);assert.match(result.prompt,/Reference: Notion \(notion\.so\)/)
    assert.equal(result.preferences.projectType,type.target==='website'?'website':'internal-tool')
    assert.equal(result.createPath,type.target==='website'?'/create':'/create?app=1')
    assert.equal(result.preferences.visualDirection,'minimal')
  }
  const result=compileReferenceBrief(plan({reference:reference('https://notion.so/private?secret=never-store')}))
  assert.ok(!result.prompt.includes('never-store'));assert.ok(!result.prompt.includes('/private'))
  assert.deepEqual(compileReferenceBrief(plan({features:['notes','title']})).blueprint.features,['title','notes'])
})

test('invalid or unsupported plan selections never silently become a different build',()=>{
  for(const [patch,error] of [
    [{name:''},'name-required'],[{name:'x'.repeat(61)},'invalid-name'],[{name:'NOVA "admin"'},'invalid-name'],
    [{type:'__proto__'},'invalid-type'],[{type:'payments'},'invalid-type'],[{features:['title','password']},'invalid-features'],
    [{features:['title','constructor']},'invalid-features'],[{features:[]},'features-required'],[{features:['notes']},'features-required'],
    [{notes:'x'.repeat(141)},'invalid-notes'],[{reference:{name:'Notion',host:'notion.so?token=secret'}},'invalid-reference'],
  ])assert.equal(compileReferenceBrief(plan(patch)).error,error)
  assert.equal(compileReferenceBrief(plan({reference:Object.create({name:'Notion'})})).ok,false)
  const host=['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(57),'com'].join('.')
  assert.equal(compileReferenceBrief(plan({reference:reference('https://'+host),name:'N'.repeat(60),notes:'x'.repeat(140)})).error,'brief-too-long')
})
