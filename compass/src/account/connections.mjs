const element=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node}
const field=(form,name,label,placeholder,required=true)=>{const wrapper=element('label',label),input=element('input');input.name=name;input.placeholder=placeholder;input.required=required;input.maxLength=250;wrapper.append(input);form.append(wrapper);return input}

// Tool data stays in this explicit read panel. It is never sent to a model.
export function connectionActions({provider,row,request,onStatus,onRefresh,getSource,isCurrent=()=>true}) {
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
  if(provider.provider!=='github' || provider.publicRepositoryExport!==true)return
  const details=element('details'),summary=element('summary','Export source to GitHub'),form=element('form');form.className='connection-form';details.append(summary,form)
  const repository=field(form,'repository','Public repository','owner/repository'),branch=field(form,'branch','Existing feature branch','compass/my-project'),head=field(form,'expectedHeadSha','Current branch commit','40-character Git SHA')
  const review=element('button','Review files');review.type='submit';review.className='button';const listing=element('pre');listing.tabIndex=0;listing.hidden=true
  let prepared=null
  const publish=button('Confirm public export',async()=>{
    if(!prepared)return
    if(repository.value.trim()!==prepared.repository || branch.value.trim()!==prepared.branch || head.value.trim()!==prepared.expectedHeadSha){prepared=null;publish.hidden=true;throw Error('Destination changed. Review the files again.')}
    const result=await request('integrations/github/export',{method:'POST',body:JSON.stringify(prepared)})
    onStatus('Source committed to '+result.branch+'.');prepared=null;publish.hidden=true
  });publish.hidden=true;form.append(review,listing,publish)
  form.addEventListener('submit',async event=>{
    event.preventDefault();review.disabled=true;publish.hidden=true;prepared=null
    try{
      const source=await getSource()
      if(!isCurrent())return
      if(source.files?.some(file=>file.encoding==='base64'))throw Error('This project includes images. Download the complete source ZIP from Projects; GitHub export currently supports text files only.')
      const files=source.files.filter(file=>!/(?:^|\/)(?:Dockerfile|package-lock\.json|\.gitignore|\.dockerignore|\.env[^/]*|railway\.json|vercel\.json)$/i.test(file.path))
      if(!files.length)throw Error('Open a completed application or website first.')
      prepared={repository:repository.value.trim(),branch:branch.value.trim(),expectedHeadSha:head.value.trim(),files,requestKey:crypto.randomUUID()}
      listing.textContent='Public repository: '+prepared.repository+'\nBranch: '+prepared.branch+'\nExpected commit: '+prepared.expectedHeadSha+'\n\n'+files.map(file=>file.path+' · '+new TextEncoder().encode(file.content).length+' bytes').join('\n')+'\n\nDeployment files and lockfile are excluded. This creates a commit; it does not deploy.'
      listing.hidden=false;publish.hidden=false
    }catch(error){onStatus(error.message)}finally{review.disabled=false}
  });row.append(details)
}
