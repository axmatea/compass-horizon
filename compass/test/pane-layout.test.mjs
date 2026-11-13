import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizePaneSizes,resizedPaneSizes,mountPaneLayout} from '../src/builder/pane-layout.mjs'

test('pane dimensions stay bounded and leave the preview usable',()=>{
  assert.deepEqual(normalizePaneSizes({projects:-100,conversation:9000}),{projects:150,conversation:460})
  assert.deepEqual(normalizePaneSizes({projects:'unsafe',conversation:null}),{projects:180,conversation:260})
  assert.deepEqual(resizedPaneSizes({projects:180,conversation:310},'projects',1000,1000),{projects:280,conversation:310})
  assert.deepEqual(resizedPaneSizes({projects:250,conversation:310},'conversation',460,1000),{projects:250,conversation:370})
})

test('resize supports pointer and keyboard, stores only owner-specific dimensions, and removes listeners',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key) || null,setItem:(key,value)=>values.set(key,value)}
  const handles=['projects','conversation'].map(name=>({dataset:{resizePane:name},attributes:{},listeners:{},setAttribute(key,value){this.attributes[key]=value},addEventListener(type,fn){this.listeners[type]=fn},removeEventListener(type){delete this.listeners[type]},setPointerCapture(){}}))
  const styles={},root={style:{setProperty:(key,value)=>styles[key]=value},querySelectorAll:()=>handles,getBoundingClientRect:()=>({width:1300}),classList:{add(){},remove(){}}}
  const layout=mountPaneLayout({root,owner:'owner_A',storage,window:{}})
  const preventDefault=()=>{}
  handles[0].listeners.keydown({key:'ArrowRight',preventDefault});assert.equal(styles['--pane-projects'],'190px')
  handles[1].listeners.pointerdown({button:0,pointerId:1,clientX:900,preventDefault});handles[1].listeners.pointermove({pointerId:1,clientX:850});handles[1].listeners.pointerup({pointerId:1});assert.equal(styles['--pane-conversation'],'360px')
  assert.deepEqual(JSON.parse(values.get('compass:pane-layout:1:owner_A:applications')),{projects:190,conversation:360})
  layout.destroy();assert.equal(Object.keys(handles[0].listeners).length,0)
  const other=mountPaneLayout({root,owner:'owner_B',storage,window:{}});assert.equal(styles['--pane-projects'],'180px');assert.equal(styles['--pane-conversation'],'310px');other.destroy()
  const restored=mountPaneLayout({root,owner:'owner_A',storage,window:{}});assert.equal(styles['--pane-projects'],'190px');assert.equal(handles[0].attributes['aria-valuenow'],'190');restored.destroy()
})
