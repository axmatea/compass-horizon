import {REFERENCE_PRESETS,BUILD_TYPES,normalizeReference,suggestBlueprint,compileReferenceBrief} from './reference.mjs'
import {writeDraft as storeDraft} from '../create/draft.mjs'
import './start.css'

let serial=0
const errors={
  'reference-required':'Enter an app name or a public link.',
  'empty-reference':'Enter an app name or a public link.',
  'invalid-reference':'Use an app name or a public website link.',
  'invalid-url':'Use a public website link without sign-in details.',
  'private-url':'Use a public website link.',
  'name-required':'Name your project.',
  'invalid-name':'Use a project name of 1–60 characters.',
  'features-required':'Choose at least one feature.',
  'invalid-features':'Choose the features you want to build.',
  'invalid-type':'Choose a supported project type.',
  'invalid-notes':'Keep your changes to 140 characters.',
  'brief-too-long':'Shorten your project name or notes, then try again.',
}

// The drawer receives no identity or current project. Existing work is checked
// only through the caller's explicit continuation guard, before any draft write.
export function mountReferenceStart({trigger,defaultTarget='website',beforeContinue,document:doc=globalThis.document,window:view=globalThis.window,writeDraft=storeDraft,navigate=path=>view.location.assign(path)}={}) {
  if(!trigger?.addEventListener || !doc?.body || !['website','app'].includes(defaultTarget))throw new TypeError('Invalid reference start configuration')
  const id='reference-start-'+(++serial),listeners=[]
  let ui,opened=false,disposed=false,closing=null,focusBefore,bodyOverflow='',step='reference',reference=null,plan=null,busy=false,epoch=0,prepared=null
  const on=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn))}
  const element=(tag,text,className)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node}
  const button=(text,action,className='rs-button')=>{const node=element('button',text,className);node.type='button';node.dataset.start=action;return node}
  const reduced=()=>view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true
  const setTimer=(fn,delay)=>view?.setTimeout?view.setTimeout(fn,delay):setTimeout(fn,delay)
  const clearTimer=timer=>view?.clearTimeout?view.clearTimeout(timer):clearTimeout(timer)
  function notice(text='') {ui.status.textContent=text;ui.status.hidden=!text}
  function setBusy(value) {
    busy=value
    for(const node of ui.dialog.querySelectorAll('input,select,textarea,button'))if(node!==ui.exit)node.disabled=value || node.dataset?.required==='true'
    ui.dialog.setAttribute('aria-busy',String(value));ui.build.textContent=value?'Preparing…':prepared?'Open builder':'Build my version'
  }
  function invalidate() {prepared=null;ui.recovery.hidden=true;ui.build.textContent='Build my version';notice()}
  function typeInfo(type=ui.type.value) {return BUILD_TYPES.find(item=>item.id===type) || BUILD_TYPES[0]}
  function readPlan() {
    return {reference,type:ui.type.value,name:ui.name.value,features:Array.from(ui.features.querySelectorAll('input')).filter(node=>node.checked).map(node=>node.value),notes:ui.notes.value}
  }
  function updateBrief() {
    if(!reference)return
    const result=compileReferenceBrief(readPlan())
    ui.brief.textContent=result.ok?result.prompt:'Name your project and choose what it should include.'
  }
  function paintFeatures(selected) {
    const info=typeInfo(),chosen=new Set(selected ?? info.defaultFeatures)
    ui.features.replaceChildren()
    for(const feature of info.features) {
      const label=element('label',null,'rs-feature'),input=element('input'),text=element('span',feature.label)
      input.type='checkbox';input.value=feature.id;input.checked=feature.required===true || chosen.has(feature.id);input.name='feature';input.dataset.required=String(feature.required===true);input.disabled=feature.required===true
      if(feature.required)label.title='Every record needs this field.';label.append(input,text);ui.features.append(label)
    }
    for(const node of ui.targets)node.setAttribute('aria-pressed',String(node.dataset.target===info.target))
    ui.typeLabel.hidden=info.target==='website'
    ui.notesLabel.children[0].textContent=info.target==='app'?'Design changes':'What should be different?'
    ui.notes.placeholder=info.target==='app'?'Bright blue accents. Compact layout.':'For my construction team. Bright blue accents.'
    updateBrief()
  }
  function show(next,{focus=true}={}) {
    step=next;ui.referenceForm.hidden=next!=='reference';ui.planForm.hidden=next!=='plan'
    ui.step.textContent=next==='reference'?'01 / Reference':'02 / Your plan'
    ui.heading.textContent=next==='reference'?'Start from an app':'Make it yours'
    notice()
    if(focus)(next==='reference'?ui.referenceInput:ui.name).focus({preventScroll:true})
  }
  function chooseReference(event) {
    event?.preventDefault?.();if(busy)return
    const result=normalizeReference(ui.referenceInput.value)
    if(!result.ok){notice(result.message || errors[result.error] || 'Enter an app name or a public website link.');ui.referenceInput.focus();return}
    const changed=JSON.stringify(reference)!==JSON.stringify(result.value)
    reference=result.value
    if(changed || !plan) {
      const previous=plan;plan=suggestBlueprint(reference,{defaultTarget})
      ui.type.value=plan.type;ui.name.value=previous?.name || '';ui.notes.value=previous?.notes || '';paintFeatures(plan.features)
      invalidate()
    }
    ui.referenceName.textContent=reference.label || reference.name || reference.host
    show('plan');updateBrief()
  }
  async function build(event) {
    event?.preventDefault?.();if(busy || !opened || disposed)return
    const result=compileReferenceBrief(readPlan())
    if(!result.ok){notice(result.message || errors[result.error] || 'Check your project name, features and changes.');if(!ui.name.value.trim())ui.name.focus();return}
    const mine=++epoch;setBusy(true);notice()
    try {
      const allowed=beforeContinue?await beforeContinue():true
      if(!opened || disposed || mine!==epoch)return
      if(allowed===false){notice('Your current project is kept.');return}
      // Another start flow may replace or outlive this tab-local draft while
      // the drawer is closed. Reassert the reviewed plan on every explicit
      // continuation; writeDraft preserves id and lifetime when unchanged.
      prepared=null;ui.recovery.hidden=true
      const written=writeDraft({prompt:result.prompt,preferences:result.preferences,ready:false})
      if(!written?.ok){notice('This browser couldn’t keep your plan. Your changes are still here. Allow session storage and try again.');return}
      prepared={path:result.createPath}
      if(!opened || disposed || mine!==epoch)return
      try {navigate(prepared.path)}catch {ui.recovery.href=prepared.path;ui.recovery.hidden=false;notice('Your plan is ready. Open the builder to continue.')}
    } catch {if(opened && !disposed && mine===epoch)notice('We couldn’t continue. Your plan is still here. Try again.')}
    finally {if(mine===epoch && !disposed)setBusy(false)}
  }
  function finishClose() {
    if(opened || !ui)return
    if(ui.dialog.open && typeof ui.dialog.close==='function')ui.dialog.close();else ui.dialog.removeAttribute('open')
    ui.dialog.classList.remove('is-closing');doc.body.style.overflow=bodyOverflow
    const target=focusBefore?.isConnected===false?trigger:focusBefore || trigger;target?.focus?.({preventScroll:true});focusBefore=null
  }
  function close() {
    if(!opened || !ui)return
    opened=false;epoch++;setBusy(false);trigger.setAttribute('aria-expanded','false');ui.dialog.classList.remove('is-open')
    if(reduced()){finishClose();return}
    ui.dialog.classList.add('is-closing');closing=setTimer(()=>{closing=null;finishClose()},220)
  }
  function keydown(event) {
    if(!opened)return
    event.stopPropagation()
    if(event.key==='Escape'){event.preventDefault();close();return}
    if(event.key!=='Tab')return
    const items=Array.from(ui.dialog.querySelectorAll('button,input,select,textarea,a[href]')).filter(node=>!node.disabled && !node.hidden && !node.closest('[hidden]'))
    const first=items[0],last=items.at(-1),active=doc.activeElement
    if(!first){event.preventDefault();ui.dialog.focus();return}
    if(event.shiftKey && (active===first || !ui.dialog.contains(active))){event.preventDefault();last.focus()}
    else if(!event.shiftKey && (active===last || !ui.dialog.contains(active))){event.preventDefault();first.focus()}
  }
  function field(labelText,input) {const label=element('label',null,'rs-field');label.append(element('span',labelText),input);return label}
  function create() {
    const dialog=element('dialog',null,'reference-start');dialog.id=id;dialog.tabIndex=-1;dialog.setAttribute('aria-labelledby',id+'-title');dialog.setAttribute('aria-modal','true')
    const shell=element('div',null,'rs-shell'),header=element('header',null,'rs-header'),title=element('h2','New project'),exit=button('×','close','rs-close')
    title.id=id+'-title';exit.setAttribute('aria-label','Close app reference');header.append(title,exit)
    const body=element('div',null,'rs-body'),stepLabel=element('p','01 / Reference','rs-step'),heading=element('h3','Start from an app','rs-heading')
    const referenceForm=element('form',null,'rs-reference-form');referenceForm.noValidate=true
    const referenceInput=element('input');referenceInput.type='text';referenceInput.maxLength=300;referenceInput.autocomplete='off';referenceInput.placeholder='Notion or notion.so';referenceInput.name='reference';referenceInput.required=true
    const examples=element('div',null,'rs-presets');examples.setAttribute('role','group');examples.setAttribute('aria-label','App references')
    for(const preset of REFERENCE_PRESETS.slice(0,5)){const node=button(preset.name,'preset','rs-preset');on(node,'click',()=>{referenceInput.value=preset.name;notice();referenceInput.focus()});examples.append(node)}
    const continueButton=button('Continue','continue','rs-button rs-primary');continueButton.type='submit'
    const guidance=element('p','References guide the structure. Your app is a new build.','rs-guidance')
    referenceForm.append(field('App name or link',referenceInput),examples,guidance,continueButton)
    const planForm=element('form',null,'rs-plan-form');planForm.noValidate=true;planForm.hidden=true
    const referenceRow=element('div',null,'rs-reference-row'),referenceName=element('p'),change=button('Change','change','rs-text-button');referenceRow.append(referenceName,change)
    const name=element('input');name.type='text';name.name='projectName';name.maxLength=60;name.placeholder='North Studio';name.required=true;name.autocomplete='off'
    const targets=element('div',null,'rs-targets');targets.setAttribute('role','group');targets.setAttribute('aria-label','Build format');const targetButtons=[]
    for(const [value,label]of [['website','Website'],['app','Data app']]){const node=button(label,'target');node.dataset.target=value;targetButtons.push(node);targets.append(node);on(node,'click',()=>{const current=typeInfo();if(current.target===value)return;const suggested=suggestBlueprint(reference,{defaultTarget:value});const next=BUILD_TYPES.find(item=>item.id===suggested.type && item.target===value) || BUILD_TYPES.find(item=>item.target===value);ui.type.value=next.id;invalidate();paintFeatures(next.defaultFeatures)})}
    const type=element('select');type.name='projectType';type.setAttribute('aria-label','App type')
    for(const info of BUILD_TYPES){const option=element('option',info.label);option.value=info.id;option.hidden=info.target==='website';type.append(option)}
    const typeLabel=field('App type',type),featuresGroup=element('fieldset',null,'rs-feature-group'),featuresTitle=element('legend','Include'),features=element('div',null,'rs-features');featuresGroup.append(featuresTitle,features)
    const notes=element('textarea');notes.name='notes';notes.rows=2;notes.maxLength=140;notes.placeholder='For my construction team. Bright blue accents.'
    const notesLabel=field('What should be different?',notes)
    const briefDetails=element('details',null,'rs-brief-details'),briefLabel=element('summary','Build brief'),brief=element('p',null,'rs-brief');briefDetails.append(briefLabel,brief)
    const footer=element('div',null,'rs-footer'),back=button('Back','back'),buildButton=button('Build my version','build','rs-button rs-primary');buildButton.type='submit';footer.append(back,buildButton)
    planForm.append(referenceRow,field('Project name',name),targets,typeLabel,featuresGroup,notesLabel,briefDetails,footer)
    const status=element('p',null,'rs-status');status.setAttribute('role','status');status.hidden=true
    const recovery=element('a','Open builder','rs-recovery');recovery.hidden=true
    body.append(stepLabel,heading,referenceForm,planForm,status,recovery);shell.append(header,body);dialog.append(shell);doc.body.append(dialog)
    ui={dialog,exit,step:stepLabel,heading,referenceForm,referenceInput,planForm,referenceName,name,targets:targetButtons,type,typeLabel,features,notes,notesLabel,brief,status,build:buildButton,recovery}
    on(exit,'click',close);on(dialog,'cancel',event=>{event.preventDefault();close()});on(dialog,'keydown',keydown)
    on(dialog,'click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)close()})
    on(referenceForm,'submit',chooseReference);on(planForm,'submit',build);on(recovery,'click',build);on(change,'click',()=>{plan=readPlan();show('reference')});on(back,'click',()=>{plan=readPlan();show('reference')})
    on(type,'change',()=>{invalidate();paintFeatures()});on(features,'change',()=>{invalidate();updateBrief()});on(name,'input',()=>{invalidate();updateBrief()});on(notes,'input',()=>{invalidate();updateBrief()});on(referenceInput,'input',()=>notice())
  }
  function open() {
    if(disposed)return false
    const active=doc.querySelector?.('dialog[open]');if(active && active!==ui?.dialog)return false
    if(!ui)create()
    const wasClosing=closing!=null;if(closing!=null){clearTimer(closing);closing=null}
    if(!opened && !wasClosing){focusBefore=doc.activeElement || trigger;bodyOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden'}
    opened=true;trigger.setAttribute('aria-expanded','true');ui.dialog.classList.remove('is-closing')
    if(!ui.dialog.open){if(typeof ui.dialog.showModal==='function')ui.dialog.showModal();else{ui.dialog.setAttribute('open','');ui.dialog.setAttribute('role','dialog')}}
    ui.dialog.getBoundingClientRect();ui.dialog.classList.add('is-open');show(step,{focus:false});ui.exit.focus({preventScroll:true});return true
  }
  function destroy() {
    if(disposed)return
    if(opened)close();disposed=true;epoch++;if(closing!=null)clearTimer(closing);finishClose();listeners.splice(0).forEach(remove=>remove());ui?.dialog.remove()
    for(const name of ['aria-controls','aria-haspopup','aria-expanded'])trigger.removeAttribute(name)
  }
  trigger.setAttribute('aria-controls',id);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false')
  on(trigger,'click',open)
  return {open,close,destroy,get isOpen(){return opened}}
}
