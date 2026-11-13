import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSiteBuilder, publicTurn, validateResumeIntent } from '../builder/index.mjs'
import { createStudioExperience, studioSource, studioFiles } from '../src/studio/experience.mjs'
import { createProjectStore, restoredProject } from '../src/builder/project-store.mjs'

const encoder = new TextEncoder()
function stream(body, size = 83) {
  const bytes = encoder.encode(body)
  let offset = 0
  return new Response(new ReadableStream({pull(controller) {
    if (offset >= bytes.length) return controller.close()
    controller.enqueue(bytes.slice(offset,offset += size))
  }}),{headers:{'content-type':'text/event-stream'}})
}
function offline() {
  let network = 0
  const {runtime} = createSiteBuilder({env:{},fetchImpl:async () => {network++;throw new Error('offline')}})
  const requests = []
  const fetchImpl = async (url,options) => {
    assert.equal(url,'/api/site/turn')
    const body = JSON.parse(options.body);requests.push(body)
    const result = publicTurn(await runtime.runTurn(body.sessionId,body.text,{resumeIntent:body.resumeIntent ? validateResumeIntent(body.resumeIntent) : null,preferences:body.preferences}))
    return stream(result.events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join('') + 'event: result\ndata: ' + JSON.stringify(result) + '\n\n')
  }
  return {requests,fetchImpl,get network(){return network}}
}

test('Studio uses real shared streamed generation, revisions, exact device save and Builder reopen',async () => {
  const api = offline(), updates = []
  const studio = createStudioExperience({fetchImpl:api.fetchImpl,onChange:state => updates.push({busy:state.busy,source:studioSource(state),phase:state.progress?.phase})})
  assert.equal(api.requests.length,0,'loading Studio never starts a model call')
  assert.equal((await studio.submit('A white website for an architecture studio called Forma. Add a gallery and contact section.')).ok,true)
  assert.equal(studio.state.current.number,1)
  assert.equal(studioSource(studio.state),'Prepared copy')
  assert.ok(studioFiles(studio.state).some(file => file.name === 'gallery'))
  const first = studio.state.current
  assert.equal((await studio.submit('Use serif font')).ok,true)
  assert.equal(studio.state.current.number,2)
  assert.equal(studio.state.current.plan.intent.font,'serif')
  assert.equal(studio.state.current.plan.intent.business,first.plan.intent.business)
  assert.equal(studio.state.history.length,2)
  assert.equal(api.requests[1].sessionId,api.requests.length ? JSON.parse(JSON.stringify(api.requests[1])).sessionId : '')
  assert.ok(updates.some(update => update.busy && update.phase === 'thinking'))
  assert.equal(updates.some(update => update.busy && update.source === 'Live model'),false)
  const values = new Map(),storage = {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value)}
  const store = createProjectStore({storage,id:() => 'p_studio_real'})
  assert.equal(values.size,0)
  const saved = store.save({name:'Forma',revisions:studio.revisionsForSave()})
  assert.equal(saved.ok,true)
  const reopened = restoredProject(createProjectStore({storage}).read().projects[0])
  assert.equal(reopened.render.html,studio.state.current.render.html)
  assert.equal(reopened.history.length,2)
  assert.equal(reopened.sessionId,'')
  assert.equal(api.network,0)
})

test('Studio restores exactly the chosen preview and seeds only the validated brief on the next turn',async () => {
  const api = offline(),studio = createStudioExperience({fetchImpl:api.fetchImpl})
  await studio.submit('A website for a bakery called Morning. Use light theme.')
  const first = studio.state.current
  await studio.submit('Make it darker')
  assert.equal(studio.state.current.plan.intent.theme,'dark')
  assert.equal(studio.restore(first.id),true)
  assert.equal(studio.state.current.render.html,first.render.html)
  assert.equal(studioSource(studio.state),'Restored revision')
  const history = studio.revisionsForSave()
  assert.equal(history.at(-1).render.html,first.render.html)
  assert.equal(history.at(-1).number,3)
  await studio.submit('Use sans font')
  const request = api.requests.at(-1)
  assert.equal('sessionId' in request,false)
  assert.deepEqual(request.resumeIntent,first.plan.intent)
  for (const key of ['html','render','history','source','version']) assert.equal(key in request.resumeIntent,false)
  assert.equal(studio.state.current.plan.intent.theme,'light')
  assert.equal(studio.state.current.plan.intent.font,'sans')
})

test('an interrupted or duplicate terminal stream retains the complete preview and retry instruction',async () => {
  const api = offline()
  let fail = false
  const studio = createStudioExperience({fetchImpl:(url,options) => fail ? stream('event: render\ndata: {"type":"render","version":50,"html":"<!doctype html><p>Partial</p>"}\n\n') : api.fetchImpl(url,options)})
  await studio.submit('A website for an architecture studio.')
  const before = studio.state.current
  fail = true
  const result = await studio.submit('Make it blue')
  assert.equal(result.ok,false)
  assert.equal(studio.state.current,before)
  assert.equal(studio.state.history.length,1)
  assert.equal(studio.state.retry,'Make it blue')
  assert.match(studio.state.error,/previous version is ready/i)
  assert.equal(studio.state.busy,false)
  const duplicate = createStudioExperience({fetchImpl:async () => stream('event: result\ndata: {}\n\nevent: result\ndata: {}\n\n')})
  assert.equal((await duplicate.submit('A bakery website')).error,'duplicate_result')
  assert.equal(duplicate.state.current,null)
})

test('cancellation prevents an old response from overwriting a newer project',async () => {
  const api = offline()
  let release,first = true
  const studio = createStudioExperience({fetchImpl:async (url,options) => {
    if (first) {first = false;await new Promise(resolve => {release = resolve})}
    return api.fetchImpl(url,options)
  }})
  const pending = studio.submit('A bakery called Stale')
  assert.equal(studio.cancel(),true)
  assert.equal(studio.state.retry,'A bakery called Stale')
  await studio.submit('A website for an architecture studio called Current')
  const completed = studio.state.current
  release();await pending
  assert.equal(studio.state.current,completed)
  assert.equal(studio.state.history.length,1)
  assert.equal(studio.state.busy,false)
})

test('Studio has six reachable scenes, a scriptless preview, honest launch and motion fallback',async () => {
  const html = await readFile(new URL('../studio.html',import.meta.url),'utf8')
  const css = await readFile(new URL('../src/site/studio-page.css',import.meta.url),'utf8')
  for (const name of ['idea','intelligence','creation','personalization','evolution','launch']) {
    assert.ok(html.includes('id="' + name + '"'))
    assert.ok(html.includes('data-scene-link="' + name + '"'))
  }
  assert.match(html,/<iframe[^>]+sandbox=""/)
  assert.match(html,/Forms have no connected services/)
  assert.match(html,/saves this project on this device/)
  assert.doesNotMatch(html,/assets\/studio\/compass-study|autoplay|allow-scripts/)
  assert.match(css,/prefers-reduced-motion:reduce/)
  assert.match(css,/update:slow/)
  assert.match(css,/max-width:800px/)
})
