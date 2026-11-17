import test from 'node:test'
import assert from 'node:assert/strict'
import { createCodeEditor } from '../src/builder/code-editor.mjs'

class Element {
  constructor(tag) {this.tagName=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this.disabled=false;this.textContent=''}
  append(...children) {this.children.push(...children)}
  setAttribute() {}
  addEventListener(type,handler) {(this.listeners[type] ||= []).push(handler)}
  focus() {this.focused=true}
  fire(type,event={}) {for(const handler of this.listeners[type] || [])handler({preventDefault(){},...event})}
}

function fixture() {
  const container=new Element('section')
  let html='<!doctype html><html><head></head><body><h1>Original</h1></body></html>'
  const applied=[]
  const editor=createCodeEditor({document:{createElement:tag=>new Element(tag)},container,getHtml:()=>html,
    canEdit:()=>true,onApply:value=>{html=value;applied.push(value);return {ok:true}},onClose:()=>{container.hidden=true}})
  const field=container.children.find(node=>node.tagName==='textarea')
  const actions=container.children.find(node=>node.tagName==='div')
  const button=label=>actions.children.find(node=>node.textContent===label)
  const status=container.children.find(node=>node.className==='code-status')
  const open=()=>{container.hidden=false;editor.open()}
  const edit=text=>{field.value=text;field.fire('input')}
  open()
  return {container,editor,field,button,status,applied,open,edit,get html(){return html},preview:value=>{html=value;editor.update()}}
}

test('closing with the button or Escape preserves unapplied code when reopened',()=>{
  for(const escape of [false,true]) {
    const ui=fixture(),draft=ui.html.replace('Original','My unapplied code')
    ui.edit(draft)
    if(escape)ui.container.fire('keydown',{key:'Escape'});else ui.button('Close code').fire('click')
    assert.equal(ui.container.hidden,true)
    ui.open()
    assert.equal(ui.field.value,draft)
    assert.equal(ui.button('Apply changes').disabled,false)
    assert.equal(ui.applied.length,0)
    ui.open()
    assert.equal(ui.field.value,draft,'opening Code again keeps the same draft')
  }
})

test('a preview update preserves an active draft and requires explicit discard before applying',()=>{
  const ui=fixture(),draft=ui.html.replace('Original','My unapplied code'),next=ui.html.replace('Original','Updated preview')
  ui.edit(draft);ui.preview(next)
  assert.equal(ui.field.value,draft)
  assert.equal(ui.button('Apply changes').disabled,true)
  assert.match(ui.status.textContent,/project changed/i)
  ui.button('Discard draft').fire('click')
  assert.equal(ui.field.value,next)
  assert.equal(ui.status.textContent,'')
  assert.equal(ui.button('Apply changes').disabled,true)
  assert.equal(ui.button('Discard draft').disabled,true)
})

test('a preview that finishes after closing keeps the draft and stale protection on reopen',async()=>{
  const ui=fixture(),draft=ui.html.replace('Original','Keep this draft'),next=ui.html.replace('Original','Late result')
  ui.edit(draft);ui.button('Close code').fire('click')
  await Promise.resolve().then(()=>ui.preview(next))
  ui.open()
  assert.equal(ui.field.value,draft)
  assert.equal(ui.button('Apply changes').disabled,true)
  assert.match(ui.status.textContent,/project changed/i)
  ui.button('Discard draft').fire('click')
  assert.equal(ui.field.value,next)
})

test('a clean editor follows the current preview across close and reopen',()=>{
  const ui=fixture(),next=ui.html.replace('Original','Another completed preview')
  ui.button('Close code').fire('click');ui.preview(next);ui.open()
  assert.equal(ui.field.value,next)
  assert.equal(ui.button('Apply changes').disabled,true)
  assert.equal(ui.status.textContent,'')
})

test('a preview that exactly matches the draft resolves its stale state without replacing text',()=>{
  const ui=fixture(),draft=ui.html.replace('Original','The shared result')
  ui.edit(draft);ui.preview(draft)
  assert.equal(ui.field.value,draft)
  assert.equal(ui.button('Apply changes').disabled,true)
  assert.equal(ui.button('Discard draft').disabled,true)
  assert.equal(ui.status.textContent,'')
  ui.edit(draft.replace('The shared result','My next edit'))
  assert.equal(ui.button('Apply changes').disabled,false)
  assert.equal(ui.applied.length,0)
})

test('a preview returning to the draft base clears an obsolete conflict and keeps the draft',()=>{
  const ui=fixture(),original=ui.html,draft=original.replace('Original','My unapplied code')
  ui.edit(draft);ui.preview(original.replace('Original','Another result'))
  assert.equal(ui.button('Apply changes').disabled,true)
  assert.match(ui.status.textContent,/project changed/i)
  ui.preview(original)
  assert.equal(ui.field.value,draft)
  assert.equal(ui.button('Apply changes').disabled,false)
  assert.equal(ui.status.textContent,'')
  assert.equal(ui.applied.length,0)
})
