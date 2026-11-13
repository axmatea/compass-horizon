import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEditableHtml, rebaseEditedHtml } from '../html/edit.mjs'
import { renderSite } from '../builder/render.mjs'
import { completedRevision, createProjectStore, restoredProject } from '../src/builder/project-store.mjs'
import { DatabaseSync } from 'node:sqlite'
import { createAccountStore } from '../account/store.mjs'

const document=(body='<h1 id="title">Studio</h1>',style='body{color:#121416;background:white}')=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`
test('editor accepts and canonicalizes current generated compositions across design profiles',()=>{
  for(const kind of ['architecture','bakery','real estate','booking','portfolio'])for(const font of ['serif','sans','display']) {
    const html=renderSite({spec:{kind,font,theme:'light',hero:'split',density:'airy',sections:['features','products','gallery','testimonials','pricing','faq','contact','signup']},copy:{hero:{headline:'New studio'}},version:1})
    const result=validateEditableHtml(html)
    assert.equal(result.ok,true,kind+' '+font+' '+result.error)
    assert.equal(validateEditableHtml(result.html).html,result.html)
    assert.doesNotMatch(result.html,/<script|src=|http-equiv/i)
  }
})

test('editor rejects active, network, encoded, malformed CSS and foreign-content payloads',()=>{
  for(const body of [
    '<script>alert(1)</script>','<img src="https://example.com/x">','<iframe srcdoc="hello"></iframe>',
    '<a href="javascript:alert(1)">x</a>','<a href="&#104;ttps://example.com">x</a>',
    '<h1 onclick="alert(1)">x</h1>','<form><input name="secret"></form>',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<svg><foreignObject><p>x</p></foreignObject></svg>',
    '<svg><a href="https://example.com">x</a></svg>','<svg><path fill="url(#x)" d="M0 0"></path></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<template><img src=x onerror=alert(1)></template>',
    '<p style="background:u&#114;l(https://example.com)">x</p>',
  ])assert.equal(validateEditableHtml(document(body)).ok,false,body)
  for(const style of [
    '@import "https://example.com/x";','body{background:u\\72l(https://example.com)}',
    'body{background:URL(data:image/png;base64,AAAA)}','body{background:image-set("https://example.com" 1x)}',
    '@font-face{font-family:x;src:local(x)}','body{color: red; broken ???}',
    'body{behavior:expression(x)}','body{--x:u/**/rl(https://example.com);background:var(--x)}',
    'body{content:"</style><script>alert(1)</script>"}',
  ])assert.equal(validateEditableHtml(document('',style)).ok,false,style)
  assert.equal(validateEditableHtml(document('<div>'.repeat(90)+'x'+'</div>'.repeat(90))).ok,false)
  assert.equal(validateEditableHtml(document('x'.repeat(160001))).ok,false)
})

test('independent code and chat edits merge while actual conflicts retain the previous document',()=>{
  const base=document('<h1 id="title">Studio</h1><p>First idea.</p>','body{color:#111;background:white}h1{font-size:64px}')
  const edited=base.replace('First idea.','Our studio.').replace('64px','72px')
  const next=base.replace('Studio</h1>','Atelier</h1>').replace('background:white','background:#fafafa')
  const merged=rebaseEditedHtml({base,edited,next})
  assert.equal(merged.ok,true,merged.error)
  assert.match(merged.html,/Atelier<\/h1><p>Our studio\./)
  assert.match(merged.html,/font-size:72px/)
  assert.match(merged.html,/background:#fafafa/)
  const conflict=rebaseEditedHtml({base,edited,next:base.replace('First idea.','Changed by chat.')})
  assert.equal(conflict.ok,false)
  assert.match(conflict.error,/same content/)
  const unsafe=rebaseEditedHtml({base,edited,next:document('<script>alert(1)</script>')})
  assert.equal(unsafe.ok,false)
})

test('edited document provenance survives explicit device save and reopen',()=>{
  const base=document(),html=base.replace('Studio</h1>','Atelier</h1>')
  const revision=completedRevision({plan:{intent:{kind:'studio'},version:1},render:{html,version:1,pending:[]},source:'edited',documentBase:base},'Edited index.html')
  assert.ok(revision);assert.equal(revision.source,'edited');assert.equal(revision.documentBase,base)
  let raw='';const store=createProjectStore({storage:{getItem:()=>raw,setItem:(_,v)=>{raw=v}}})
  const saved=store.save({name:'Studio',revisions:[revision]});assert.equal(saved.ok,true)
  const restored=restoredProject(store.read().projects[0]);assert.equal(restored.documentBase,base);assert.equal(restored.render.html,html)
})

test('account saves revalidate HTML with the shared parser before any publish boundary',()=>{
  const database=new DatabaseSync(':memory:');const store=createAccountStore(database)
  try {
    const base=document(),revision=completedRevision({plan:{intent:{kind:'studio'},version:1},render:{html:base,version:1,pending:[]},source:'edited'},'Code')
    assert.ok(store.saveProject('owner',{name:'Studio',revisions:[revision]}))
    // This inert-looking element passes the lightweight device-store gate but
    // is outside the canonical subset. The server does not trust that gate.
    assert.throws(()=>store.saveProject('owner',{name:'Bad',revisions:[{...revision,render:{...revision.render,html:document('<marquee>Unsupported</marquee>')}}]}),/invalid_project/)
  } finally {database.close()}
})
