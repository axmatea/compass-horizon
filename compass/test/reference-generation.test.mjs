import test from 'node:test'
import assert from 'node:assert/strict'
import {BUILD_TYPES,normalizeReference,compileReferenceBrief} from '../src/start/reference.mjs'
import {createApplicationManifest,referenceApplicationSelection,validateApplicationRecord} from '../generation/manifest.mjs'
import {createApplicationBundle,exportApplicationZip,renderApplicationPreview} from '../generation/index.mjs'
import {applicationPlan} from '../platform/model.mjs'
import {createSiteBuilder} from '../builder/index.mjs'
import {referenceWebsiteSelection,interpretSite} from '../builder/interpret.mjs'
import {createState,applyUpdate} from '../builder/spec.mjs'

const ref=normalizeReference('Booking.com').value
function brief(type,features,name='North Studio') {
  const result=compileReferenceBrief({reference:ref,type,name,features,notes:'Use a white background.'})
  assert.equal(result.ok,true,result.message);return result.prompt
}
const mockEnv={COMPASS_DEMO_MODE:'live',LLM_PROVIDER:'generalcompute',GENERALCOMPUTE_API_KEY:'test-only'}
const response=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}})

test('prepared application builds keep the selected kind, exact name and fields despite conflicting reference words',()=>{
  for(const type of BUILD_TYPES.filter(type=>type.target==='app')) {
    const features=type.defaultFeatures.filter(feature=>feature!=='notes')
    const prompt=brief(type.id,features,'Booking Inventory — North')
    const manifest=createApplicationManifest(prompt)
    assert.equal(manifest.kind,type.id);assert.equal(manifest.title,'Booking Inventory — North')
    assert.deepEqual(manifest.entity.fields.map(field=>field.key),features)
    assert.equal(manifest.entity.fields[0].required,true)
    const base={[features[0]]:'Demo'}
    if(features.includes('status'))base.status=manifest.entity.fields.find(field=>field.key==='status').options[0]
    if(features.includes('service'))base.service='Consultation'
    if(features.includes('date'))base.date='2026-11-18'
    if(features.includes('quantity'))base.quantity=2
    assert.equal(validateApplicationRecord(manifest,base).ok,true)
    assert.equal(validateApplicationRecord(manifest,{...base,notes:'not selected'}).ok,false)
  }
})

test('malformed structured app plans reject unknown and missing primary fields without changing ordinary requests',()=>{
  for(const fields of ['title, password','title, __proto__','title, title','notes','title; execute'])assert.throws(()=>createApplicationManifest(`Create an original project tracker app called "North". Fields: ${fields}. Reference: Notion.`),error=>error.code==='invalid_reference_plan')
  assert.equal(createApplicationManifest('A CRM called Forma').kind,'crm')
  assert.equal(createApplicationManifest('An appointment booking app').kind,'booking')
  assert.equal(referenceApplicationSelection('An ordinary project tracker'),null)
})

test('explicit app plans skip configured providers while ordinary ideas and later refinements still use AI',async()=>{
  const prompt=brief('tracker',['title','notes'],'İstanbul Studio')
  let calls=0
  const proposed=createApplicationManifest('An inventory app called Other Brand')
  const result=await applicationPlan({text:prompt,env:mockEnv,fetchImpl:async()=>{calls++;return response(proposed)}})
  assert.equal(calls,0);assert.equal(result.source,'prepared');assert.equal(result.modelUsed,false)
  assert.equal(result.manifest.title,'İstanbul Studio');assert.equal(result.manifest.kind,'tracker')
  assert.deepEqual(result.manifest.entity.fields.map(field=>field.key),['title','notes'])
  const prepared=await applicationPlan({text:prompt,env:{COMPASS_DEMO_MODE:'examples'},fetchImpl:()=>{throw Error('No provider expected')}})
  assert.equal(prepared.source,'prepared');assert.deepEqual(prepared.manifest,result.manifest)
  const refined=await applicationPlan({text:'Add a priority field',previous:prepared.manifest,env:mockEnv,fetchImpl:()=>{throw Error('No provider needed')}})
  assert.ok(refined.manifest.entity.fields.some(field=>field.key==='priority'))
  const ordinary=createApplicationManifest('A project tracker called North')
  ordinary.description='A tailored project tracker.'
  const idea=await applicationPlan({text:'A project tracker called North',env:mockEnv,fetchImpl:async()=>{calls++;return response(ordinary)}})
  assert.equal(calls,1);assert.equal(idea.source,'model');assert.equal(idea.manifest.description,ordinary.description)
  const renamed={...prepared.manifest,title:'North operations'}
  const later=await applicationPlan({text:'Rename this workspace North operations',previous:prepared.manifest,env:mockEnv,fetchImpl:async()=>{calls++;return response(renamed)}})
  assert.equal(calls,2);assert.equal(later.source,'model');assert.equal(later.manifest.title,'North operations')
})

test('review mode can propose a broader refinement while retaining only trusted asset references',async()=>{
  const previous={...createApplicationManifest('A tracker called Harbor'),assets:{logo:'asset_saved'}};
  const manifest={...previous,title:'Harbor Operations',assets:{logo:'asset_other'},theme:{...previous.theme,mode:'dark'}};
  let calls=0;
  const result=await applicationPlan({
    text:'Make it dark and rename the app Harbor Operations',previous,review:true,env:mockEnv,
    fetchImpl:async()=>{calls++;return response(manifest)},
  });
  assert.equal(calls,1);
  assert.equal(result.source,'model');
  assert.equal(result.manifest.title,'Harbor Operations');
  assert.deepEqual(result.manifest.assets,previous.assets);
  assert.equal(previous.title,'Harbor');
});

test('reference app previews and exported source show concise purpose descriptions with honest generation provenance',async()=>{
  for(const [kind,description] of [['tracker','Project tracker'],['crm','Contacts'],['booking','Booking records'],['inventory','Inventory']]) {
    const plan=compileReferenceBrief({reference:normalizeReference('Notion').value,type:kind,name:'North',features:BUILD_TYPES.find(type=>type.id===kind).defaultFeatures,notes:'Make it compact.'})
    assert.equal(plan.ok,true)
    let calls=0
    const result=await applicationPlan({text:plan.prompt,env:mockEnv,fetchImpl:()=>{calls++;throw Error('A reviewed plan needs no provider')}})
    assert.equal(calls,0);assert.equal(result.source,'prepared');assert.equal(result.modelUsed,false)
    assert.equal(result.manifest.description,description);assert.ok(result.manifest.description.length<=15)
    const preview=await renderApplicationPreview(result.manifest)
    assert.ok(preview.includes(`description&quot;:&quot;${description}&quot;`))
    for(const instruction of ['Create an original','Fields:','White, minimal design','Reference:','Notion','Make it compact.'])assert.ok(!preview.includes(instruction),instruction)
    const bundle=await createApplicationBundle(result.manifest)
    const exported=bundle.files.find(file=>file.path==='manifest.json')
    assert.deepEqual(JSON.parse(exported.content),result.manifest)
    assert.ok(exportApplicationZip(bundle).includes(Buffer.from(exported.content)))
    assert.ok(plan.prompt.includes('Reference: Notion (notion.so).'),'reference context remains in the original project brief')
  }
  const ordinary='A project tracker called North with notes'
  assert.equal(createApplicationManifest(ordinary).description,ordinary)
})

test('actual prepared website builds omit deselected profile sections and keep the new brand',async()=>{
  for(const features of [['gallery'],['products','faq'],['features','gallery','contact']]) {
    const prompt=brief('website',features,'North Studio')
    const {runtime}=createSiteBuilder({env:{COMPASS_DEMO_MODE:'examples'}})
    const result=await runtime.runTurn(null,prompt)
    assert.equal(result.intent.business,'North Studio')
    assert.deepEqual(result.intent.sections,features)
    for(const section of ['features','products','gallery','contact','faq'])assert.equal(result.page.html.includes(`id="${section}"`),features.includes(section),section)
  }
})

test('website model interpretations preserve the reviewed brand/sections and reject unsafe plan section names',async()=>{
  const prompt=brief('website',['gallery'],'North Studio')
  const result=await interpretSite({state:createState('reference'),text:prompt,env:mockEnv,fetchImpl:async()=>response({set:{business:'Booking.com',kind:'creative studio',sections:['features','contact']},add_sections:['pricing'],tool:'write_copy',reply:'Building the page.'})})
  assert.equal(result.source,'model');assert.equal(result.set.business,'North Studio')
  assert.deepEqual(result.set.sections,['gallery']);assert.deepEqual(result.add_sections,[])
  assert.deepEqual(applyUpdate(createState('result'),result).state.intent.sections,['gallery'])
  for(const sections of ['gallery, testimonials','gallery, __proto__','gallery, gallery','script'])assert.throws(()=>referenceWebsiteSelection(`Create an original website for a business called "North". Sections: ${sections}.`),error=>error.code==='invalid_reference_plan')
})

test('structured app appearance ignores reference and business words but honors explicit changes and onboarding',async()=>{
  for(const host of ['dark.com','blue.com']) {
    const compile=notes=>compileReferenceBrief({reference:normalizeReference('https://'+host).value,type:'tracker',name:'Dark Blue Serif Studio',features:['title','notes'],notes}).prompt
    const prompt=compile(''),local=createApplicationManifest(prompt,{preferences:{visualDirection:'editorial'}})
    assert.deepEqual(local.theme,{mode:'light',accent:'indigo',font:'serif',density:'comfortable'})
    const model=await applicationPlan({text:prompt,preferences:{visualDirection:'editorial'},env:mockEnv,fetchImpl:()=>{throw Error('No model for a fixed plan')}})
    assert.equal(model.modelUsed,false);assert.equal(model.source,'prepared')
    assert.deepEqual(model.manifest.theme,local.theme)
    const changed=compile('Make it dark and compact. Use blue and sans.')
    const explicit=createApplicationManifest(changed,{preferences:{visualDirection:'editorial'}})
    assert.deepEqual(explicit.theme,{mode:'dark',accent:'blue',font:'sans',density:'compact'})
    const changedModel=await applicationPlan({text:changed,preferences:{visualDirection:'editorial'},env:mockEnv,fetchImpl:()=>{throw Error('No model for a fixed plan')}})
    assert.deepEqual(changedModel.manifest.theme,explicit.theme)
  }
})

test('structured website appearance and personalization ignore reference hosts in prepared and model builds',async()=>{
  for(const host of ['dark.com','blue.com']) {
    const compile=notes=>compileReferenceBrief({reference:normalizeReference('https://'+host).value,type:'website',name:'Dark Blue Serif Studio',features:['gallery','contact'],notes}).prompt
    const prompt=compile('')
    const prepared=createSiteBuilder({env:{COMPASS_DEMO_MODE:'examples'}})
    const first=await prepared.runtime.runTurn(null,prompt,{preferences:{visualDirection:'editorial'}})
    assert.equal(first.intent.theme,'light');assert.equal(first.intent.accent,'slate');assert.equal(first.intent.font,'serif')
    const interpretation=await interpretSite({state:createState('appearance'),text:prompt,env:mockEnv,fetchImpl:async()=>response({set:{business:'Other',kind:'creative studio',theme:'dark',accent:'sky',font:'display',density:'compact'},tool:'write_copy',reply:'Building the page.'})})
    assert.equal(interpretation.set.theme,'light');assert.equal(interpretation.set.accent,'slate');assert.equal(interpretation.set.font,'sans');assert.equal(interpretation.set.density,'airy')
    const explicit=createSiteBuilder({env:{COMPASS_DEMO_MODE:'examples'}})
    const second=await explicit.runtime.runTurn(null,compile('Make it dark. Use blue and sans. Compact spacing.'),{preferences:{visualDirection:'editorial'}})
    assert.equal(second.intent.theme,'dark');assert.equal(second.intent.accent,'sky');assert.equal(second.intent.font,'sans');assert.equal(second.intent.density,'compact')
    const synonyms=createSiteBuilder({env:{COMPASS_DEMO_MODE:'examples'}})
    const third=await synonyms.runtime.runTurn(null,compile('Go noir. Make it warm.'),{preferences:{visualDirection:'minimal'}})
    assert.equal(third.intent.theme,'dark');assert.equal(third.intent.accent,'gold')
  }
  const ordinary=createApplicationManifest('A dark blue inventory application')
  assert.equal(ordinary.theme.mode,'dark');assert.equal(ordinary.theme.accent,'blue')
})

test('application font choices distinguish sans compounds from bare serif for reference and ordinary ideas',()=>{
  for(const [word,font] of [['sans-serif','sans'],['sans serif','sans'],['sans','sans'],['serif','serif'],['editorial','serif']]) {
    const plan=compileReferenceBrief({reference:normalizeReference('Notion').value,type:'tracker',name:'North',features:['title'],notes:`Use ${word} typography.`})
    assert.equal(plan.ok,true)
    assert.equal(createApplicationManifest(plan.prompt,{preferences:{visualDirection:'editorial'}}).theme.font,font,word)
    assert.equal(createApplicationManifest(`A project tracker with ${word} typography`,{preferences:{visualDirection:'editorial'}}).theme.font,font,word)
  }
})
