import { validateEditableHtml } from '../../html/edit.mjs'

export function changedLines(before='',after='') {
  const a=before.split('\n'),b=after.split('\n')
  let start=0;while(start<a.length && start<b.length && a[start]===b[start])start++
  let endA=a.length,endB=b.length
  while(endA>start && endB>start && a[endA-1]===b[endB-1]){endA--;endB--}
  return {added:endB-start,removed:endA-start}
}

export function createCodeEditor({document:doc,container,getHtml,getBase=()=>'',canEdit=()=>true,onApply,onClose}) {
  const title=doc.createElement('h3');title.textContent='index.html'
  const note=doc.createElement('p');note.textContent=onApply ? 'HTML + CSS. Scripts and external resources are disabled.' : 'HTML source'
  const field=doc.createElement('textarea');field.className='code-input';field.spellcheck=false;field.setAttribute('aria-label','HTML and CSS source');field.setAttribute('data-code-input','')
  const actions=doc.createElement('div');actions.className='code-actions'
  const apply=doc.createElement('button');apply.type='button';apply.textContent='Apply changes';apply.hidden=!onApply
  const revert=doc.createElement('button');revert.type='button';revert.textContent='Discard draft'
  const close=doc.createElement('button');close.type='button';close.textContent='Close code'
  const status=doc.createElement('p');status.className='code-status';status.setAttribute('role','status')
  const changes=doc.createElement('p');changes.className='code-changes'
  actions.append(apply,revert,close);container.append(title,note,field,changes,actions,status)
  let original='',working=false,stale=false
  function paint() {
    field.readOnly=!onApply || !canEdit() || working
    apply.disabled=working || stale || !canEdit() || field.value===original
    revert.disabled=working || field.value===getHtml()
    const diff=changedLines(getBase() || original,field.value)
    changes.textContent=diff.added || diff.removed ? `index.html · +${diff.added} / −${diff.removed} lines` : 'index.html · No changes'
  }
  function open() {original=getHtml() || '';field.value=original;stale=false;status.textContent='';paint();field.focus()}
  function update() {
    if(container.hidden)return
    if(getHtml()!==original){
      if(field.value===original){original=getHtml() || '';field.value=original;stale=false}
      else {stale=true;status.textContent='The project changed. Discard this draft and reopen the latest code before applying.'}
    }
    paint()
  }
  async function save() {
    if(!onApply || apply.disabled)return
    const checked=validateEditableHtml(field.value)
    if(!checked.ok){status.textContent=checked.error;return}
    working=true;paint()
    try {
      const result=await onApply(checked.html)
      if(result?.ok===false)throw new Error(result.error)
      original=getHtml() || checked.html;field.value=original;stale=false
      status.textContent='Changes applied. A revision is available in History.'
    } catch(error) {status.textContent=error.message || 'Could not apply. Your draft and last preview are kept.'}
    finally {working=false;paint()}
  }
  field.addEventListener('input',paint)
  field.addEventListener('keydown',event=>{if((event.metaKey || event.ctrlKey) && event.key==='Enter'){event.preventDefault();void save()}})
  apply.addEventListener('click',()=>void save())
  revert.addEventListener('click',open)
  close.addEventListener('click',onClose)
  container.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();onClose()}})
  return {open,update}
}
