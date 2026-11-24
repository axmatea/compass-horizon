const element=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node}
const field=(form,name,label,placeholder,required=true)=>{const wrapper=element('label',label),input=element('input');input.name=name;input.placeholder=placeholder;input.required=required;input.maxLength=250;wrapper.append(input);form.append(wrapper);return input}
const importMessages = {
  project_context_conflict:'Project context changed. Review the manifest again.',
  integration_branch_changed:'The GitHub branch changed. Review the manifest again.',
  integration_import_review_required:'Review the GitHub manifest again.',
  integration_manifest_required:'The branch needs a root manifest.json from a COMPASS application export.',
  integration_manifest_invalid:'This manifest is incompatible with COMPASS.',
  integration_manifest_incompatible:'This manifest changes the app type or makes saved records incompatible.',
  integration_public_repository_required:'Choose a public GitHub repository.',
  integration_invalid_branch:'Enter a branch name such as main or compass/my-project.',
}

function manifestImportControls({row, button, request, onStatus, getImportTarget, isCurrent}) {
  if (!getImportTarget?.()) return
  const details = element('details'), form = element('form')
  form.className = 'connection-form'
  const repository = field(form, 'repository', 'Public repository', 'owner/repository')
  const branch = field(form, 'branch', 'Branch', 'main')
  const reviewButton = element('button', 'Review manifest'); reviewButton.type = 'submit'; reviewButton.className = 'button'
  const comparison = element('section'); comparison.className = 'connection-comparison'; comparison.hidden = true
  const label = element('p'), before = element('pre'), after = element('pre')
  before.tabIndex = after.tabIndex = 0
  comparison.append(label, element('h4', 'Current manifest'), before, element('h4', 'GitHub manifest'), after)
  let reviewed = null
  function clearReview() { reviewed = null; comparison.hidden = true; applyButton.hidden = true }
  const selection = () => ({repository:repository.value.trim(), branch:branch.value.trim()})
  const route = (id, action) => `apps/${encodeURIComponent(id)}/github-import/${action}`
  const applyButton = button('Apply manifest', async () => {
    if (!reviewed || !isCurrent()) return
    const current = getImportTarget(), next = selection(), pending = reviewed
    if (current?.id !== pending.id || current.version !== pending.version || next.repository !== pending.repository || next.branch !== pending.branch) {
      clearReview()
      throw Error('The project or destination changed. Review the manifest again.')
    }
    try {
      const result = await request(route(pending.id, 'apply'), {method:'POST', body:JSON.stringify({ticket:pending.ticket})})
      if (!isCurrent()) return
      clearReview()
      onStatus(`Imported version ${result.application.version}. Reopen the application to view it.`)
    } catch (error) {
      if (error.code === 'version_conflict' || Object.hasOwn(importMessages,error.code)) clearReview()
      onStatus(importMessages[error.code] || error.message)
    }
  })
  applyButton.hidden = true
  form.append(reviewButton, comparison, applyButton)
  details.append(element('summary', 'Import app manifest'), form)
  row.append(details)
  form.addEventListener('input', clearReview)
  form.addEventListener('submit', async event => {
    event.preventDefault()
    clearReview()
    const app = getImportTarget(), selected = selection()
    if (!app || !isCurrent()) return
    reviewButton.disabled = true
    try {
      const result = await request(route(app.id, 'review'), {method:'POST', body:JSON.stringify({...selected, version:app.version})})
      if (!isCurrent()) return
      const current = getImportTarget(), destination = selection()
      if (current?.id !== app.id || current.version !== app.version || destination.repository !== selected.repository || destination.branch !== selected.branch) {
        throw Error('The project or destination changed. Review the manifest again.')
      }
      before.textContent = JSON.stringify(result.current, null, 2)
      after.textContent = JSON.stringify(result.manifest, null, 2)
      label.textContent = `${result.repository} · ${result.branch} · ${result.commitSha.slice(0, 12)}`
      comparison.hidden = false
      if (result.changed) {
        reviewed = {...selected, id:app.id, version:app.version, ticket:result.ticket}
        applyButton.hidden = false
      }
      onStatus(result.changed ? 'Review the change before applying.' : 'The manifests match.')
    } catch (error) { onStatus(importMessages[error.code] || error.message) }
    finally { reviewButton.disabled = false }
  })
}

// Tool data stays in this explicit read panel. It is never sent to a model.
export function connectionActions({provider,row,request,onStatus,onRefresh,getSource,getImportTarget,isCurrent=()=>true}) {
  const button=(label,run)=>{const node=element('button',label);node.type='button';node.className='button';node.addEventListener('click',async()=>{node.disabled=true;try{await run()}catch(error){onStatus(error.message)}finally{node.disabled=false}});return node}
  if(!provider.configured)return
  if(!provider.connected){
    let exportGrant=null
    if(provider.provider==='github'){
      const label=element('label','Allow reviewed exports to public repositories'),checkbox=element('input');checkbox.type='checkbox';label.prepend(checkbox);row.append(label);exportGrant=checkbox
      row.append(element('p','Optional public_repo permission can write public repositories. COMPASS exports only to a selected feature branch.'))
    }
    row.append(button('Connect',async()=>{
      const result=await request('integrations/'+provider.provider+'/connect',{method:'POST',body:JSON.stringify(exportGrant?.checked?{publicRepositoryExport:true}:{})})
      if(!isCurrent())return
      const destination=new URL(result.authorizationUrl);if(destination.protocol!=='https:')throw Error('Connection URL was refused.');location.assign(destination.href)
    }))
    return
  }
  row.append(button('Disconnect',async()=>{await request('integrations/'+provider.provider,{method:'DELETE'});onRefresh()}))
  const readForm=element('form');readForm.className='connection-form'
  const inputs={}
  const fields={
    github:[['repository','Public repository (optional)','owner/repository',false]],
    'google-sheets':[['spreadsheetId','Spreadsheet ID','Explicit spreadsheet ID'],['range','Cell range','Sheet1!A1:D20']],
    gmail:[['messageId','Message ID (optional)','Metadata only',false]],
    'google-calendar':[['calendarId','Calendar','primary'],['timeMin','From (UTC)','2026-11-01T00:00:00Z'],['timeMax','Until (UTC)','2026-11-15T00:00:00Z']],
    notion:[['pageId','Page ID','Selected accessible page ID']],
  }
  for(const [name,label,placeholder,required] of fields[provider.provider] || [])inputs[name]=field(readForm,name,label,placeholder,required)
  const read=element('button','Read selected data');read.type='submit';read.className='button'
  const output=element('pre');output.tabIndex=0;output.hidden=true;readForm.append(read,output)
  readForm.addEventListener('submit',async event=>{
    event.preventDefault();read.disabled=true;output.hidden=true
    try{
      const input=Object.fromEntries(Object.entries(inputs).filter(([,node])=>node.value.trim()).map(([key,node])=>[key,node.value.trim()]))
      const result=await request('integrations/'+provider.provider+'/read',{method:'POST',body:JSON.stringify(input)})
      output.textContent=JSON.stringify(result,null,2).slice(0,50000);output.hidden=false;onStatus('Selected data loaded. It is not sent to AI.')
    }catch(error){onStatus(error.message)}finally{read.disabled=false}
  });row.append(readForm)
  if (provider.provider === 'github' && provider.manifestImport === true) {
    manifestImportControls({row, button, request, onStatus, getImportTarget, isCurrent})
  }
  if(provider.provider!=='github' || provider.publicRepositoryExport!==true)return
  const details=element('details'),summary=element('summary','Export source to GitHub'),form=element('form');form.className='connection-form';details.append(summary,form)
  const repository=field(form,'repository','Public repository','owner/repository'),branch=field(form,'branch','Existing feature branch','compass/my-project'),head=field(form,'expectedHeadSha','Current branch commit','40-character Git SHA')
  const review=element('button','Review files');review.type='submit';review.className='button'
  const listing=element('section');listing.className='connection-comparison';listing.hidden=true
  let prepared=null
  const publish=button('Confirm public export',async()=>{
    if(!prepared)return
    if(repository.value.trim()!==prepared.repository || branch.value.trim()!==prepared.branch || head.value.trim()!==prepared.expectedHeadSha){prepared=null;publish.hidden=true;throw Error('Destination changed. Review the files again.')}
    const result=await request('integrations/github/export',{method:'POST',body:JSON.stringify(prepared)})
    onStatus('Source committed to '+result.branch+'.');prepared=null;publish.hidden=true
  });publish.hidden=true;form.append(review,listing,publish)
  form.addEventListener('submit',async event=>{
    event.preventDefault();review.disabled=true;publish.hidden=true;listing.hidden=true;prepared=null
    try{
      const source=await getSource()
      if(!isCurrent())return
      if(source.files?.some(file=>file.encoding==='base64'))throw Error('This project includes images. Download the complete source ZIP from Projects; GitHub export currently supports text files only.')
      const files=source.files.filter(file=>!/(?:^|\/)(?:Dockerfile|package-lock\.json|\.gitignore|\.dockerignore|\.env[^/]*|railway\.json|vercel\.json)$/i.test(file.path))
      if(!files.length)throw Error('Open a completed application or website first.')
      prepared={repository:repository.value.trim(),branch:branch.value.trim(),expectedHeadSha:head.value.trim(),files,requestKey:crypto.randomUUID()}
      listing.replaceChildren(element('p', `${prepared.repository} · ${prepared.branch} · ${prepared.expectedHeadSha}`))
      const encoder = new TextEncoder()
      for (const file of files) {
        const fileDetails = element('details'), source = element('pre', file.content)
        source.tabIndex = 0
        fileDetails.append(element('summary', `${file.path} · ${encoder.encode(file.content).length} bytes`), source)
        listing.append(fileDetails)
      }
      listing.hidden=false;publish.hidden=false
    }catch(error){onStatus(error.message)}finally{review.disabled=false}
  });row.append(details)
}
