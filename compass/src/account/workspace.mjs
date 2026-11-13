function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (className) node.className = className
  return node
}
export async function mountAccountWorkspace({getProject,onLoad,onClear,onMessage}) {
  let mountedOwner = null
  async function request(path, options={}) {
    const response = await fetch('/api/account/'+path, {credentials:'same-origin',...options,
      headers:{...(options.body ? {'content-type':'application/json'} : {}),...options.headers,...(mountedOwner ? {'x-compass-user':mountedOwner} : {})}})
    const data = await response.json()
    if (response.status === 401 || data.error === 'account_changed') { onClear({accountChanged:data.error === 'account_changed'}); location.replace('/create'); throw new Error('Sign in again to continue.') }
    if (!response.ok) throw new Error(data.error === 'project_limit' ? 'The preview account holds up to 20 projects.' : 'This request could not finish. Your current page is unchanged.')
    return data
  }
  try { mountedOwner=(await request('me')).userId } catch (error) { onMessage(error.message); return null }
  document.body.classList.add('account-workspace')
  document.title = 'Workspace — COMPASS'
  document.querySelector('h1').textContent = 'Workspace'
  const sidebar = element('aside',null,'workspace-nav')
  sidebar.setAttribute('aria-label','Workspace')
  const mark = element('img'); mark.src='/assets/brand-next/mark-b-offset.svg'; mark.alt='COMPASS preview identity'; mark.width=32; mark.height=32
  sidebar.append(mark)
  const projects = element('button','Projects'), history = element('button','History'), usage = element('button','Usage')
  const settings = element('a','Settings'); settings.href='/create?edit=1'
  const logout = element('button','Sign out')
  for (const button of [projects,history,usage,logout]) button.type='button'
  sidebar.append(projects,history,usage,settings,logout)
  document.querySelector('main').before(sidebar)
  const note = element('p','Account preview · saves can be lost when this preview redeploys. Export work you want to keep.','account-preview-note')
  document.querySelector('.project-heading').after(note)
  const save = element('button','Save to preview account','button')
  save.type='button'; save.disabled=true
  document.querySelector('.project-buttons').prepend(save)
  const panel = element('section',null,'account-panel'); panel.hidden=true
  panel.setAttribute('aria-label','Account projects and usage')
  const title = element('h2'), close = element('button','Close'), status = element('p'), content = element('div')
  close.type='button'; close.className='text-button'
  panel.append(title,close,status,content)
  note.after(panel)
  let cloudId = null, signature = '', lastSaved = '', saving = false, projectEpoch = 0, loadRequest = 0
  close.addEventListener('click',()=>{panel.hidden=true; projects.focus()})
  const api = {
    userId:mountedOwner,
    update() {
      const project = getProject()
      signature = project ? project.name+':'+project.revisions.map(item=>item.id).join(',') : ''
      save.disabled = saving || !project || signature===lastSaved
    },
    reset() { projectEpoch+=1; loadRequest+=1; cloudId=null; lastSaved=''; api.update() },
  }
  const recheck = () => { if(document.visibilityState !== 'hidden')void request('me').catch(error=>onMessage(error.message)) }
  window.addEventListener('focus',recheck)
  document.addEventListener('visibilitychange',recheck)
  async function showProjects() {
    panel.hidden=false; title.textContent='Account projects'; status.textContent='Loading…'; content.replaceChildren()
    try {
      const data = await request('projects')
      status.textContent = data.projects.length ? 'Saved in this isolated preview.' : 'No account projects yet.'
      for (const item of data.projects) {
        const row = element('div',null,'account-project-row'), open = element('button',item.name), remove = element('button','Delete')
        open.type=remove.type='button'; open.className='project-open'; remove.className='project-remove'
        remove.setAttribute('aria-label','Delete '+item.name+' from preview account')
        open.addEventListener('click',async()=>{
          const requestId=++loadRequest
          try {
            const result = await request('projects/'+encodeURIComponent(item.id))
            if(requestId!==loadRequest)return
            if (onLoad(result.project) === false) return
            cloudId=result.project.id; lastSaved=signature; panel.hidden=true; api.update()
          } catch(error) { status.textContent=error.message }
        })
        remove.addEventListener('click',async()=>{
          if (!confirm('Delete '+item.name+' from this preview account? This cannot be undone. Export it first if you need a copy.')) return
          remove.disabled=true
          try { await request('projects/'+encodeURIComponent(item.id),{method:'DELETE'}); if(cloudId===item.id)api.reset(); await showProjects() }
          catch(error) { status.textContent=error.message; remove.disabled=false }
        })
        row.append(open,remove); content.append(row)
      }
    } catch(error) { status.textContent=error.message }
  }
  projects.addEventListener('click',showProjects)
  history.addEventListener('click',()=>{const details=document.querySelector('.history-details'); details.open=true; details.scrollIntoView({block:'nearest'}); details.querySelector('summary').focus()})
  usage.addEventListener('click',async()=>{
    panel.hidden=false; title.textContent='Usage'; status.textContent='Loading…'; content.replaceChildren()
    try {
      const data=await request('usage')
      status.textContent='Billing and credits are not enabled.'
      const count=data.operations.reduce((sum,item)=>sum+item.count,0)
      content.append(element('p',count+' build '+(count===1?'request':'requests')+' in this preview account.'))
      const list=element('ul')
      for(const attempt of data.attempts) {
        const tokens = attempt.inputTokens == null || attempt.outputTokens == null ? 'Token counts unavailable' : attempt.inputTokens+' input · '+attempt.outputTokens+' output tokens'
        list.append(element('li',[attempt.provider,attempt.model,attempt.status,tokens].filter(Boolean).join(' · ')))
      }
      if (!data.attempts.length) content.append(element('p','No model calls recorded. Prepared builds and local design refinements can run without a model call.'))
      else content.append(list)
    } catch(error) { status.textContent=error.message }
  })
  save.addEventListener('click',async()=>{
    const project=getProject(); if(!project || saving)return
    saving=true; api.update()
    const savedSignature=signature
    const savedEpoch=projectEpoch
    try {
      const result=await request('projects',{method:'POST',body:JSON.stringify({...project,projectId:cloudId})})
      if(savedEpoch!==projectEpoch)return
      cloudId=result.project.id; lastSaved=savedSignature; onMessage('Saved to preview account. Export a copy before the preview redeploys.')
    } catch(error) { if(savedEpoch===projectEpoch)onMessage(error.message) }
    finally { saving=false; api.update() }
  })
  logout.addEventListener('click',async()=>{
    logout.disabled=true
    try {
      const result=await fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
      if(!result.ok)throw new Error('Sign out could not finish. Try again.')
      onClear({accountChanged:true}); location.replace('/create?signin=1')
    } catch(error) { onMessage(error.message); logout.disabled=false }
  })
  return api
}
