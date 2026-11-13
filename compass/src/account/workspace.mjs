import { draftCanAutoBuild, disarmDraft } from '../create/draft.mjs'
import { applicationDraft } from '../applications/intent.mjs'
import { connectionActions } from './connections.mjs'
import { mountApplicationWorkspace } from '../applications/workspace.mjs'
function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (className) node.className = className
  return node
}
export async function mountAccountWorkspace({getProject,onLoad,onClear,onMessage,initialDraft,onDraftBuilt}) {
  let mountedOwner = null
  async function requestRaw(path, options={}) {
    const response = await fetch('/api/account/'+path, {credentials:'same-origin',cache:'no-store',...options,
      headers:{...(options.body ? {'content-type':'application/json'} : {}),...options.headers,...(mountedOwner ? {'x-compass-user':mountedOwner} : {})}})
    if (!response.ok) {
      const data=await response.json().catch(()=>({}))
      if (response.status===401 || data.error==='account_changed') {onClear({accountChanged:data.error==='account_changed'});location.replace('/create');throw Error('Sign in again to continue.')}
      const messages={project_limit:'This preview holds up to 20 websites.',application_limit:'This preview holds up to 12 applications.',insufficient_credits:'Not enough available credits.',billing_external_blocked:'Billing needs its verified test configuration.',integration_external_blocked:'This connection needs its provider configuration.',version_conflict:'The project changed. Reopen it before applying this edit.'}
      throw Error(messages[data.error] || 'This request could not finish. Try again. Your current work is kept.')
    }
    return response
  }
  const request=async(path,options)=> (await requestRaw(path,options)).json()
  try { mountedOwner=(await request('me')).userId } catch (error) { onMessage(error.message); return null }
  if(initialDraft?.ready && !draftCanAutoBuild(initialDraft,{accountMode:true,userId:mountedOwner})){disarmDraft({id:initialDraft.id});onMessage('Review your idea with this account before building.');location.replace('/create');return null}
  document.body.classList.add('account-workspace')
  document.title = 'Workspace — COMPASS'
  document.querySelector('h1').textContent = 'Workspace'
  const sidebar = element('aside',null,'workspace-nav')
  sidebar.setAttribute('aria-label','Workspace')
  const mark = element('img'); mark.src='/assets/brand-next/mark-b-offset.svg'; mark.alt='COMPASS'; mark.width=32; mark.height=32
  sidebar.append(mark)
  const apps = element('button','Applications'), websites = element('button','Websites'), connections=element('button','Connections'), billing=element('button','Billing'), publishing=element('button','Publish'), admin=element('button','Operations')
  const projects = element('button','Saved websites'), history = element('button','History'), usage = element('button','Usage')
  const settings = element('a','Settings'); settings.href='/create?view=account'
  const logout = element('button','Sign out')
  for (const button of [apps,websites,projects,history,usage,connections,billing,publishing,admin,logout]) button.type='button'
  sidebar.append(apps,websites,projects,history,usage,connections,billing,publishing,admin,settings,logout)
  admin.hidden=true
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
  const websiteSurface=document.querySelector('.sd'), websiteButtons=document.querySelector('.project-buttons')
  const appContainer=element('section'); appContainer.hidden=true; document.querySelector('main').append(appContainer)
  let appWorkspace=null, applicationMode=false, panelEpoch=0
  function selectMode(appMode) {
    panelEpoch+=1;loadRequest+=1
    applicationMode=appMode; appContainer.hidden=!appMode; websiteSurface.hidden=appMode; websiteButtons.hidden=appMode
    if(appMode)document.querySelector('#projects-panel').hidden=true
    document.querySelector('.skip').href=appMode?'#application-prompt':'#sd-input'
    apps.setAttribute('aria-current',appMode?'page':'false');websites.setAttribute('aria-current',appMode?'false':'page')
    if(appMode)appWorkspace?.show();else appWorkspace?.hide()
  }
  apps.addEventListener('click',()=>{panel.hidden=true;selectMode(true)})
  websites.addEventListener('click',()=>{panel.hidden=true;selectMode(false)})
  let cloudId = null, signature = '', lastSaved = '', saving = false, projectEpoch = 0, loadRequest = 0
  close.addEventListener('click',()=>{panelEpoch+=1;loadRequest+=1;panel.hidden=true; projects.focus()})
  const api = {
    userId:mountedOwner,
    handlesDraft:applicationDraft(initialDraft),
    update() {
      const project = getProject()
      signature = project ? project.name+':'+project.revisions.map(item=>item.id).join(',') : ''
      save.disabled = applicationMode || saving || !project || signature===lastSaved
    },
    reset() { projectEpoch+=1; loadRequest+=1; cloudId=null; lastSaved=''; api.update() },
  }
  const recheck = () => { if(document.visibilityState !== 'hidden')void request('me').catch(error=>onMessage(error.message)) }
  window.addEventListener('focus',recheck)
  document.addEventListener('visibilitychange',recheck)
  async function showProjects() {
    selectMode(false)
    const run=panelView('Saved websites')
    try {
      const data = await request('projects')
      if(run!==panelEpoch)return
      status.textContent = data.projects.length ? 'Saved in this isolated preview.' : 'No account projects yet.'
      for (const item of data.projects) {
        const row = element('div',null,'account-project-row'), open = element('button',item.name), remove = element('button','Delete')
        open.type=remove.type='button'; open.className='project-open'; remove.className='project-remove'
        remove.setAttribute('aria-label','Delete '+item.name+' from preview account')
        open.addEventListener('click',async()=>{
          const requestId=++loadRequest
          try {
            const result = await request('projects/'+encodeURIComponent(item.id))
            if(requestId!==loadRequest || run!==panelEpoch)return
            if (onLoad(result.project) === false) return
            cloudId=result.project.id; lastSaved=signature; panel.hidden=true; api.update()
          } catch(error) { if(run===panelEpoch)status.textContent=error.message }
        })
        remove.addEventListener('click',async()=>{
          if (!confirm('Delete '+item.name+' from this preview account? This cannot be undone. Export it first if you need a copy.')) return
          remove.disabled=true
          try { await request('projects/'+encodeURIComponent(item.id),{method:'DELETE'}); if(cloudId===item.id)api.reset(); await showProjects() }
          catch(error) { status.textContent=error.message; remove.disabled=false }
        })
        row.append(open,remove); content.append(row)
      }
    } catch(error) { if(run===panelEpoch)status.textContent=error.message }
  }
  projects.addEventListener('click',showProjects)
  history.addEventListener('click',()=>{selectMode(false);const details=document.querySelector('.history-details'); details.open=true; details.scrollIntoView({block:'nearest'}); details.querySelector('summary').focus()})
  usage.addEventListener('click',async()=>{
    const run=panelView('Usage')
    try {
      const [data,billingData]=await Promise.all([request('usage'),request('billing')])
      if(run!==panelEpoch)return
      const financial=billingData.status || billingData
      status.textContent=financial.creditsEnabled?'Measured usage · test credit ledger.':'Billing and credits are not enabled.'
      const count=data.operations.reduce((sum,item)=>sum+item.count,0)
      content.append(element('p',count+' build '+(count===1?'request':'requests')+' in this preview account.'))
      const list=element('ul')
      for(const attempt of data.attempts) {
        const tokens = attempt.inputTokens == null || attempt.outputTokens == null ? 'Token counts unavailable' : attempt.inputTokens+' input · '+attempt.outputTokens+' output tokens'
        list.append(element('li',[attempt.provider,attempt.model,attempt.status,tokens].filter(Boolean).join(' · ')))
      }
      if (!data.attempts.length) content.append(element('p','No model calls recorded. Prepared builds and local design refinements can run without a model call.'))
      else content.append(list)
    } catch(error) { if(run===panelEpoch)status.textContent=error.message }
  })
  save.addEventListener('click',async()=>{
    const project=getProject(); if(applicationMode || !project || saving)return
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
  function panelView(heading) { const run=++panelEpoch;panel.hidden=false;title.textContent=heading;status.textContent='Loading…';content.replaceChildren();return run }
  const action=(label,perform)=>{const epoch=panelEpoch,button=element('button',label,'button');button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{await perform()}catch(error){if(epoch===panelEpoch)status.textContent=error.message}finally{button.disabled=false}});return button}
  connections.addEventListener('click',async()=>{
    const run=panelView('Connections')
    try {
      const data=await request('integrations');if(run!==panelEpoch)return;status.textContent=data.enabled?'Choose what COMPASS can access.':'Connections need their provider configuration.'
      for(const provider of data.providers || []) {
        const row=element('details',null,'account-connection'),summary=element('summary',provider.label+' · '+(provider.connected?'Connected':provider.configured?'Available':'Unavailable'))
        row.append(summary,element('p',(provider.permissions || []).join(' · ')))
        if(provider.limitation)row.append(element('p',provider.limitation))
        connectionActions({provider,row,request,isCurrent:()=>run===panelEpoch,onStatus:message=>{if(run===panelEpoch)status.textContent=message},onRefresh:()=>{if(run===panelEpoch)connections.click()},getSource:async()=>{
          const app=appWorkspace?.currentApplication
          if(applicationMode){if(!app?.id)throw Error('Open a completed application first.');return appWorkspace.getSource()}
          const project=getProject(),html=project?.revisions.at(-1)?.render?.html
          if(!html)throw Error('Open a completed project first.')
          return {files:[{path:'index.html',content:html}]}
        }})
        content.append(row)
      }
    }catch(error){if(run===panelEpoch)status.textContent=error.message}
  })
  const checkoutRequests=new Map()
  billing.addEventListener('click',async()=>{
    const run=panelView('Billing')
    try {
      const data=await request('billing'),config=data.status || data
      if(run!==panelEpoch)return
      status.textContent=config.billingEnabled?'Stripe test mode · no live charges.':'Payments are not enabled.'
      if(data.account?.available!=null)content.append(element('p','Available credits: '+data.account.available))
      for(const offer of config.offers || [])content.append(action(offer.id+' · test checkout',async()=>{
        if(!checkoutRequests.has(offer.id))checkoutRequests.set(offer.id,crypto.randomUUID())
        const result=await request('billing/checkout',{method:'POST',body:JSON.stringify({offerId:offer.id,requestKey:checkoutRequests.get(offer.id)})});
        if(run!==panelEpoch)return
        const url=new URL(result.url);if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com')throw Error('Checkout URL was refused.');location.assign(url.href)
      }))
      if(config.billingEnabled)content.append(action('Manage test billing',async()=>{
        const result=await request('billing/portal',{method:'POST',body:'{}'});if(run!==panelEpoch)return;const url=new URL(result.url);if(url.protocol!=='https:' || url.hostname!=='billing.stripe.com')throw Error('Billing URL was refused.');location.assign(url.href)
      }))
      if(data.account?.transactions?.length){const list=element('ul');for(const transaction of data.account.transactions)list.append(element('li',[transaction.kind,transaction.credits,transaction.createdAt].filter(v=>v!=null).join(' · ')));content.append(list)}
    }catch(error){if(run===panelEpoch)status.textContent=error.message}
  })
  async function showPublications() {
    const run=panelView('Publish a website')
    try {
      const data=await request('publications');if(run!==panelEpoch)return;status.textContent='A public link shares the saved page. Preview hosting is temporary.'
      if(cloudId)content.append(action('Publish current saved website',async()=>{
        if(!confirm('Publish the last saved version? Anyone with the link can view it. Unsaved changes are excluded.'))return
        await request('publications',{method:'POST',body:JSON.stringify({projectId:cloudId})});if(run===panelEpoch)await showPublications()
      }))
      else content.append(element('p','Save a website to your preview account first.'))
      for(const publication of data.publications || []) {
        const row=element('div',null,'account-project-row'),link=element('a',publication.title);link.href=publication.path;link.target='_blank';link.rel='noopener noreferrer'
        row.append(link,action('Unpublish',async()=>{await request('publications/'+publication.id,{method:'DELETE'});if(run===panelEpoch)await showPublications()}));content.append(row)
      }
    }catch(error){if(run===panelEpoch)status.textContent=error.message}
  }
  publishing.addEventListener('click',()=>{selectMode(false);void showPublications()})
  admin.addEventListener('click',async()=>{
    const run=panelView('Operations')
    try {const data=await request('admin');if(run!==panelEpoch)return;status.textContent='Private operational summary';const pre=element('pre',JSON.stringify(data,null,2));pre.tabIndex=0;content.append(pre)}
    catch(error){if(run===panelEpoch)status.textContent=error.message}
  })
  let preferences={}
  try {
    const [profile,config]=await Promise.all([request('profile'),request('capabilities')])
    preferences=profile.preferences || {}
    if(profile.preferences?.workspaceLayout)document.body.dataset.workspaceLayout=profile.preferences.workspaceLayout
    admin.hidden=config.admin!==true
  }catch{/* Optional discovery does not block the working builder. */}
  appWorkspace=await mountApplicationWorkspace({container:appContainer,request,requestRaw,userId:mountedOwner,onMessage,initialDraft:api.handlesDraft?initialDraft:null,onDraftBuilt,preferences})
  appContainer.querySelector('[data-aw=input]').id='application-prompt'
  selectMode(api.handlesDraft || !initialDraft?.ready)
  logout.addEventListener('click',async()=>{
    logout.disabled=true
    try {
      const result=await fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json','x-compass-user':mountedOwner},body:'{}'})
      if(!result.ok){const data=await result.json().catch(()=>({}));if(data.error==='account_changed'){onClear({accountChanged:true});location.replace('/create');return}throw new Error('Sign out could not finish. Try again.')}
      onClear({accountChanged:true}); location.replace('/create?signin=1')
    } catch(error) { onMessage(error.message); logout.disabled=false }
  })
  return api
}
