import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, MAX_PROJECTS, MAX_REVISIONS, createProjectStore, completedRevision,
  appendRevision, normalizeSavedIntent, safeSavedHtml, restoredProject,
} from '../src/builder/project-store.mjs';
import { renderSite } from '../builder/render.mjs';

const stamp = '2026-11-12T20:00:00.000Z';
test('saved HTML rejects encoded navigation and escaped remote CSS while accepting generated layouts',()=>{
  for(const html of [
    '<!doctype html><a href="&#106;avascript:alert(1)">x</a>',
    '<!doctype html><svg/onload="alert(1)"></svg>',
    '<!doctype html><style>@\\69mport "https://example.invalid/a.css";</style>',
    '<!doctype html><div style="background:&#117;rl(https://example.invalid/a)">x</div>',
    '<!doctype html><style>body{background:image-set("https://example.invalid/a" 1x)}</style>',
  ])assert.equal(safeSavedHtml(html),null);
  for(const kind of ['real estate','booking','creative studio','bakery'])for(const font of ['serif','sans','display']){
    const html=renderSite({spec:{business:'QA',kind,theme:'light',font,accent:'slate',hero:'split',density:'airy',sections:['products','contact']},version:1});
    assert.equal(safeSavedHtml(html),html,kind+' '+font);
  }
});
function memory() {
  const values = new Map();
  return { getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value), values };
}
function state(version = 1, theme = 'light') {
  const intent = {business:'Atelier',kind:'architecture studio',theme,accent:'sky',font:'sans',hero:'centered',sections:['features','contact']};
  return {plan:{intent,version},render:{html:renderSite({spec:intent,version}),version,pending:[]},source:'prepared',placeholder:true,busy:false};
}
function revision(version = 1, theme = 'light') {
  return completedRevision(state(version,theme),'A studio page',{now:() => stamp,id:() => 'r_' + version});
}

test('projects persist only after explicit save, restore without network/session identifiers, and retain exact preview', () => {
  const storage = memory();
  const store = createProjectStore({storage,now:() => stamp,id:() => 'p_studio'});
  assert.deepEqual(store.read(),{ok:true,projects:[]});
  assert.equal(storage.values.size,0);
  const first = revision();
  assert.ok(first);
  const saved = store.save({name:'  Atelier   project ',revisions:[first]});
  assert.equal(saved.ok,true);
  assert.equal(saved.project.name,'Atelier project');
  const opened = restoredProject(createProjectStore({storage}).read().projects[0]);
  assert.equal(opened.sessionId,'');
  assert.equal(opened.render.html,first.render.html);
  assert.equal(opened.render.version,0);
  assert.equal(opened.plan.version,0);
  assert.equal(opened.source,'saved');
  assert.deepEqual(opened.resumeIntent,first.plan.intent);
  assert.equal('actions' in opened,false);
  assert.equal('sessionId' in saved.project,false);
  assert.equal(saved.project.revisions[0].render.html,first.render.html);
});

test('save updates only the deliberately opened project and never evicts another project', () => {
  const storage = memory();
  let serial = 0;
  const store = createProjectStore({storage,now:() => stamp,id:() => 'p_' + ++serial});
  for (let i=0;i<MAX_PROJECTS;i++) assert.equal(store.save({name:'Project ' + i,revisions:[revision()]}).ok,true);
  const before = storage.getItem(STORAGE_KEY);
  assert.equal(store.save({name:'One too many',revisions:[revision()]}).error,'full');
  assert.equal(storage.getItem(STORAGE_KEY),before);
  assert.equal(store.save({projectId:'p_missing',name:'Wrong record',revisions:[revision()]}).error,'missing');
  const updated = store.save({projectId:'p_2',name:'Renamed second project',revisions:[revision(),revision(2,'dark')]});
  assert.equal(updated.ok,true);
  assert.equal(updated.projects.length,MAX_PROJECTS);
  assert.equal(updated.projects.find(item => item.id==='p_1').name,'Project 0');
  assert.equal(updated.projects.find(item => item.id==='p_2').name,'Renamed second project');
  assert.equal(store.remove('p_2').ok,true);
  assert.equal(store.read().projects.some(item=>item.id==='p_2'),false);
});

test('corrupt, unavailable and quota-limited storage never destroys the previous saved data', () => {
  const storage = memory();
  storage.setItem(STORAGE_KEY,'{broken');
  const store = createProjectStore({storage});
  assert.equal(store.save({name:'New',revisions:[revision()]}).error,'corrupt');
  assert.equal(storage.getItem(STORAGE_KEY),'{broken');
  assert.equal(createProjectStore({storage:null}).read().error,'unavailable');
  const denied = createProjectStore({storage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}});
  assert.equal(denied.read().error,'unavailable');
  const quota = createProjectStore({storage:{getItem:()=>null,setItem(){throw Error('quota')}},now:()=>stamp,id:()=> 'p_quota'});
  assert.equal(quota.save({name:'Quota',revisions:[revision()]}).error,'quota');
});

test('revision history holds completed matching versions, deduplicates no-op updates and stays bounded', () => {
  assert.equal(completedRevision({...state(),busy:true}),null);
  assert.equal(completedRevision({...state(),render:{...state().render,pending:['hero']}}),null);
  assert.equal(completedRevision({...state(),plan:{...state().plan,version:2}}),null);
  let history = appendRevision([],revision());
  assert.equal(appendRevision(history,{...revision(),id:'r_duplicate'}),history);
  for(let i=2;i<20;i++) history=appendRevision(history,revision(i,i%2 ? 'dark' : 'light'));
  assert.equal(history.length,MAX_REVISIONS);
  assert.equal(history.at(-1).number,19);
  assert.equal(history.at(-1).render.version,19);
});

test('saved state accepts only bounded structured intent and inert self-contained renderer documents', () => {
  assert.equal(normalizeSavedIntent({kind:'studio',sections:[]}).sections.length,0);
  assert.equal(normalizeSavedIntent({kind:'studio',theme:'invented'}),null);
  assert.equal(normalizeSavedIntent({kind:'studio',business:'x'.repeat(141)}),null);
  assert.equal(normalizeSavedIntent({kind:'studio',sections:['unknown']}),null);
  assert.equal(safeSavedHtml(state().render.html),state().render.html);
  for(const html of [
    '<!doctype html><script>alert(1)</script>',
    '<!doctype html><img src="https://example.com/tracker">',
    '<!doctype html><p onclick="alert(1)">x</p>',
    '<!doctype html><style>body{background:url(https://example.com/a)}</style>',
    '<!doctype html><meta http-equiv="refresh" content="0;url=https://example.com">',
  ]) assert.equal(safeSavedHtml(html),null);
});

test('saved projects preserve optional layout refinements without changing older briefs', () => {
  const original = state();
  assert.equal('density' in normalizeSavedIntent(original.plan.intent),false);
  assert.equal('mobile' in normalizeSavedIntent(original.plan.intent),false);
  const intent = {...original.plan.intent,density:'airy',mobile:'comfortable'};
  const refined = {...original,plan:{intent,version:1},render:{html:renderSite({spec:intent,version:1}),version:1,pending:[]}};
  const store = createProjectStore({storage:memory(),now:()=>stamp,id:()=> 'p_layout'});
  const saved = store.save({name:'Comfortable layout',revisions:[completedRevision(refined,'Improve the mobile layout',{now:()=>stamp,id:()=> 'r_layout'})]});
  assert.equal(saved.ok,true);
  const restored = restoredProject(saved.project);
  assert.equal(restored.resumeIntent.density,'airy');
  assert.equal(restored.resumeIntent.mobile,'comfortable');
  for(const bad of [{density:'fullscreen'},{mobile:'javascript'},{density:{html:'bad'}}]) assert.equal(normalizeSavedIntent({...intent,...bad}),null);
});
