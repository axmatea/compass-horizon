import './workspace.css'
import {validateApplicationManifest} from '../../generation/templates/lib/schema.mjs'
import {validateApplicationBridgeMessage} from './bridge.mjs'
import {createDictation} from '../demo/voice.mjs'
import {draftCanAutoBuild,disarmDraft} from '../create/draft.mjs'
import {applicationResultOutcome,requireApplicationVersion} from './result.mjs'
import {mountPaneLayout} from '../builder/pane-layout.mjs'
export {validateApplicationBridgeMessage} from './bridge.mjs'

const APP_ID = /^[A-Za-z0-9_-]{1,80}$/
const element = (tag,text,className) => {const node = document.createElement(tag);if (text != null) node.textContent = String(text);if (className) node.className = className;return node}

export async function mountApplicationWorkspace({container,request,requestRaw,userId,onMessage = () => {},onDraftBuilt = () => {},initialDraft,preferences = {}} = {}) {
  if (!container || typeof request !== 'function' || !APP_ID.test(userId || '')) throw TypeError('An authenticated application workspace is required.')
  container.classList.add('application-workspace')
  container.dataset.layout = ['balanced','preview','conversation'].includes(preferences.workspaceLayout) ? preferences.workspaceLayout : 'balanced'
  container.innerHTML = `<div class="aw-heading"><h2>Projects</h2><button type="button" data-aw="new">New application</button></div>
<div class="aw-layout"><aside class="aw-projects" aria-label="Your applications"><div class="aw-section-heading"><h3>Applications</h3><button type="button" data-aw="refresh-projects" aria-label="Refresh projects">↻</button></div><ul data-aw="projects"></ul><p data-aw="project-status" role="status"></p></aside><div class="aw-resize" data-resize-pane="projects" aria-label="Resize projects panel"></div>
<section class="aw-canvas" aria-label="Application preview"><div class="aw-toolbar"><div><h3 data-aw="title">Your next application</h3><p data-aw="source"></p></div><div class="aw-tabs" role="group" aria-label="Application view"><button type="button" data-aw="preview-tab" aria-pressed="true">Preview</button><button type="button" data-aw="code-tab" aria-pressed="false" disabled>Code</button></div></div>
<div class="aw-actions"><div class="aw-tabs" role="group" aria-label="Preview width"><button type="button" data-aw="desktop" aria-pressed="true">Desktop</button><button type="button" data-aw="tablet" aria-pressed="false">Tablet</button><button type="button" data-aw="mobile" aria-pressed="false">Mobile</button></div><div class="aw-tabs"><button type="button" data-aw="undo" disabled>Undo</button><button type="button" data-aw="assets-tab" aria-pressed="false" disabled>Assets</button><button type="button" data-aw="download" disabled>Export</button></div></div>
<details class="aw-design" data-aw="design"><summary>Design</summary><form data-aw="design-form"><label>Theme<select name="mode"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Accent<select name="accent"><option value="indigo">Indigo</option><option value="blue">Blue</option><option value="slate">Slate</option><option value="rose">Rose</option><option value="amber">Amber</option></select></label><label>Type<select name="font"><option value="sans">Sans</option><option value="serif">Serif</option></select></label><label>Spacing<select name="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button type="submit" data-aw="apply-design" disabled>Apply design</button></form></details>
<div class="aw-preview" data-aw="preview"><p class="aw-empty" data-aw="empty">Describe the application you want to work with.</p></div>
<section class="aw-code" data-aw="code" aria-label="Application source" hidden><div class="aw-file-toolbar"><label>File<select data-aw="file"></select></label><button type="button" data-aw="copy-file">Copy</button></div><p data-aw="file-meta" class="aw-file-meta"></p><pre data-aw="read-only-source" tabindex="0"><code data-aw="file-content"></code></pre><label class="aw-editor-label" data-aw="editor-label" hidden><span class="sr">Edit manifest.json</span><textarea data-aw="manifest-editor" spellcheck="false" aria-label="Edit manifest.json"></textarea></label><div class="aw-editor-actions" data-aw="editor-actions" hidden><p data-aw="editor-status" role="status"></p><button type="button" data-aw="reload-manifest">Discard edits</button><button type="button" data-aw="apply-manifest" disabled>Apply manifest</button></div></section>
<section class="aw-assets" data-aw="assets" aria-label="Project images" hidden><div data-aw="dropzone" class="aw-dropzone"><label>Drop an image here<input data-aw="upload-asset" type="file" accept="image/png,image/jpeg"></label><p>PNG or JPEG · up to 512 KB</p></div><p data-aw="asset-quota" class="aw-file-meta"></p><div data-aw="asset-list" class="aw-asset-list"></div></section>
<details class="aw-history"><summary>History</summary><p>Restore a revision. Records stay intact.</p><ol data-aw="history"></ol></details></section><div class="aw-resize" data-resize-pane="conversation" aria-label="Resize conversation panel"></div>
<aside class="aw-conversation" aria-label="Build your application"><form data-aw="composer"><label data-aw="composer-label">What would you like to build?<textarea data-aw="input" rows="5" maxlength="2000" placeholder="A CRM for my studio…" required></textarea></label><div class="aw-compose-actions"><button type="button" data-aw="voice" aria-pressed="false">Speak</button><span data-aw="count">0/2000</span><button type="submit" data-aw="submit">Build</button></div><button type="button" data-aw="cancel-build" class="aw-cancel" hidden>Cancel</button></form><p data-aw="voice-status" class="aw-status" role="status"></p><p data-aw="status" class="aw-status" role="status" aria-live="polite"></p><ol data-aw="conversation" class="aw-messages"></ol><details class="aw-runtime-details"><summary>Project settings</summary><p data-aw="settings-meta"></p><button type="button" data-aw="download-data" disabled>Export records</button><button type="button" data-aw="delete-current" disabled>Delete application</button><details><summary>Runtime &amp; shortcuts</summary><p>Trusted application runtime. The isolated preview has no account token or network access.</p><p>⌘ / Ctrl + Enter: apply or build<br>⌘ / Ctrl + Shift + F: files<br>Escape: cancel or stop voice</p><p>Voice uses your browser’s speech service. Only submitted text reaches COMPASS.</p></details></details></aside></div>`
  const $ = key => container.querySelector(`[data-aw="${key}"]`)
  const state = {current:null,epoch:0,busy:false,frame:null,frameApplication:null,frameEpoch:0,disposed:false,pending:null,source:null,viewport:'desktop',view:'preview',cancelController:null,editor:null,revisions:[],assets:[],assetEpoch:0,assetUrls:new Set()}
  const paneLayout=mountPaneLayout({root:container.querySelector('.aw-layout'),owner:userId,defaults:{conversation:preferences.workspaceLayout==='preview'?260:preferences.workspaceLayout==='conversation'?380:310}})
  const bridgeRequests = new Map()
  let undoTargets=null,undoRestoring=false
  let bridgeInFlight = 0
  let listEpoch = 0
  let voiceSelection = {prefix:'',suffix:''}
  const raw = requestRaw || (async (path,options = {}) => {
    const response = await fetch('/api/account/' + path,{...options,credentials:'same-origin',cache:'no-store',headers:{...options.headers,'x-compass-user':userId}})
    if (!response.ok) throw Error('This request could not finish. Sign in again if your session expired.')
    return response
  })
  const status = (message,error = false) => { $('status').textContent = message; $('status').dataset.error = String(error); if (error) onMessage(message) }
  const path = suffix => 'apps/' + encodeURIComponent(state.current.id) + (suffix ? '/' + suffix : '')
  const validApplication = value => value && APP_ID.test(value.id || '') && Number.isSafeInteger(value.version) && value.version > 0 && validateApplicationManifest(value.manifest)
  const applicationFrom = result => {const app = result?.application || result;if (!validApplication(app)) throw Error('The application response was incomplete.');return app}
  function lock(value) {
    state.busy = value;container.setAttribute('aria-busy',String(value))
    for (const node of container.querySelectorAll('button,select,textarea,input')) node.disabled = value
    $('download-data').disabled=value || !state.current;$('code-tab').disabled = value || !state.current;$('download').disabled = value || !state.current;$('apply-design').disabled = value || !state.current
    $('delete-current').disabled = value || !state.current
    $('assets-tab').disabled=value || !state.current
    $('upload-asset').disabled=value || !state.current
    $('undo').disabled=value || (undoTargets ? !undoTargets.length : !state.revisions.some(revision=>revision.version<state.current?.version))
    if(!value){for(const button of container.querySelectorAll('[data-asset-selected]'))button.disabled=button.dataset.assetSelected==='true';$('copy-file').disabled=state.source?.files.find(file=>file.path===$('file').value)?.encoding==='base64'}
    $('voice').disabled = value || !dictation
    $('cancel-build').hidden = !value || !state.cancelController
    $('cancel-build').disabled = false
    if (!value) container.querySelectorAll('[data-restore-version]').forEach(button => {button.disabled = Number(button.dataset.restoreVersion) === state.current?.version})
    $('submit').textContent = value ? 'Working…' : state.current ? 'Update' : 'Build'
    updateEditorStatus()
    if (state.frame) state.frame.inert = value
  }
  function fillDesign() {
    if (!state.current) return
    for (const [key,value] of Object.entries(state.current.manifest.theme)) $('design-form').elements[key].value = value
  }
  function message(prompt,reply) {
    const item = element('li');item.append(element('p',prompt,'aw-message-user'),element('p',reply,'aw-message-reply'));$('conversation').prepend(item)
    while ($('conversation').children.length > 8) $('conversation').lastChild.remove()
  }
  function showView(view) {
    state.view=view
    for(const name of ['preview','code','assets']){$(name).hidden=name!==view;$(name+'-tab').setAttribute('aria-pressed',String(name===view))}
  }
  function replaceFrame(html,appId) {
    state.frame?.remove();bridgeRequests.clear()
    const frame = element('iframe');frame.title = state.current.manifest.title + ' application';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy = 'no-referrer';frame.className = 'aw-frame';frame.dataset.viewport=state.viewport
    state.frame = frame;state.frameApplication = appId;state.frameEpoch++
    $('empty').hidden = true;$('preview').append(frame);frame.srcdoc = html
  }
  async function paint(app,run,expectedId) {
    if (expectedId && app.id !== expectedId) throw Error('The application response did not match this project.')
    if (state.current?.id === app.id && app.version < state.current.version) throw Error('This result is older than your current application. Reopen the project to continue.')
    const response = await raw('apps/' + encodeURIComponent(app.id) + '/preview',{signal:state.cancelController?.signal})
    requireApplicationVersion(response,app.version)
    const html = await response.text()
    if (state.disposed || run !== state.epoch) return
    if (!html.startsWith('<!doctype html>') || html.length > 300000) throw Error('The application preview was incomplete.')
    if(!undoRestoring)undoTargets=null
    state.current = app;state.source = null;state.assetEpoch++;clearAssetUrls();state.assets=[];$('asset-list').replaceChildren()
    $('title').textContent = app.manifest.title
    $('source').textContent = app.source === 'model' ? 'AI build' : 'Prepared build'
    $('settings-meta').textContent = `${app.manifest.kind.toUpperCase()} · Version ${app.version}`
    $('delete-current').textContent = 'Delete this application';delete $('delete-current').dataset.confirm
    $('composer-label').firstChild.textContent = 'What would you change?'
    fillDesign();replaceFrame(html,app.id);showView('preview')
  }
  async function refresh() {
    const run = ++listEpoch
    $('project-status').textContent = 'Loading…'
    try {
      const result = await request('apps')
      if (state.disposed || run !== listEpoch) return
      if (!Array.isArray(result.applications) || result.applications.length > 100) throw Error('Application list was incomplete.')
      $('projects').replaceChildren()
      for (const app of result.applications) {
        if (!validApplication(app)) continue
        const row = element('li'), open = element('button',app.manifest.title), remove = element('button','×','aw-delete')
        open.title=app.manifest.title;open.type = remove.type = 'button';open.setAttribute('aria-current',app.id === state.current?.id ? 'true' : 'false');remove.setAttribute('aria-label','Delete application ' + app.manifest.title)
        open.addEventListener('click',() => openApplication(app.id))
        remove.addEventListener('click',() => removeApplication(app.id,remove))
        row.append(open,remove);$('projects').append(row)
      }
      $('project-status').textContent = result.applications.length ? '' : 'No applications yet.'
    } catch(error) {if (!state.disposed && run === listEpoch) $('project-status').textContent = error.message || 'Couldn’t load applications. Try again.'}
  }
  async function history() {
    if (!state.current) return
    const id = state.current.id, version = state.current.version, run = state.epoch, result = await request(path('revisions'))
    if (state.current?.id !== id || state.current.version !== version || run !== state.epoch || state.disposed) return
    if (!Array.isArray(result.revisions) || result.revisions.length > 100) throw Error('History was incomplete.')
    state.revisions=result.revisions.filter(revision=>Number.isSafeInteger(revision.version) && revision.version>0)
    $('history').replaceChildren()
    for (const revision of result.revisions) {
      if (!Number.isSafeInteger(revision.version) || revision.version < 1) continue
      const row = element('li'), label = element('span','Version ' + revision.version), restore = element('button','Restore')
      restore.dataset.restoreVersion = revision.version
      restore.type = 'button';restore.disabled = revision.version === state.current.version
      restore.addEventListener('click',()=>restoreRevision(revision.version))
      const heading=element('div',null,'aw-revision-heading');heading.append(label,restore);row.append(heading)
      if(Array.isArray(revision.changes) && revision.changes.length){const changes=element('details'),summary=element('summary',revision.changes.length+' file changes'),list=element('ul');changes.append(summary,list);for(const file of revision.changes.slice(0,40)){if(typeof file.path!=='string')continue;const item=element('li',`${file.type} · ${file.path}`);if(file.sha256)item.title='SHA-256 '+file.sha256;list.append(item)}row.append(changes)}
      $('history').append(row)
    }
    if(undoTargets)undoTargets=undoTargets.filter(version=>state.revisions.some(item=>item.version===version))
    $('undo').disabled=state.busy || (undoTargets ? !undoTargets.length : !state.revisions.some(revision=>revision.version<state.current?.version))
  }
  async function restoreRevision(version,{undo=false}={}) {
    if(!state.current || state.busy || !discardEditor())return
    const id=state.current.id,run=++state.epoch;undoRestoring=undo;if(!undo)undoTargets=null;lock(true);status('Restoring revision…')
    try{const result=await request(path('restore'),{method:'POST',body:JSON.stringify({version})});await paint(applicationFrom(result),run,id);if(run!==state.epoch)return;state.editor=null;await Promise.allSettled([history(),refresh()]);status('Revision restored. Records kept.')}
    catch(error){if(run===state.epoch){if(undo)undoTargets?.unshift(version);status(error.message || 'Couldn’t restore. Your current application is kept.',true)}}
    finally{undoRestoring=false;if(run===state.epoch)lock(false)}
  }
  async function openApplication(id) {
    if (state.busy || !APP_ID.test(id) || !discardEditor()) return
    const run = ++state.epoch;lock(true);status('Opening application…')
    try {const result = await request('apps/' + encodeURIComponent(id));await paint(applicationFrom(result),run,id);if (run !== state.epoch) return;state.editor=null;$('conversation').replaceChildren();await history();await refresh();status('')}
    catch(error) {if (run === state.epoch) status(error.message || 'Couldn’t open. Try again.',true)}
    finally {if (run === state.epoch) lock(false)}
  }
  async function removeApplication(id,button) {
    if (state.busy || !APP_ID.test(id)) return
    if (button.dataset.confirm !== 'yes') {button.dataset.confirm = 'yes';button.textContent = 'Confirm deletion';return}
    const run = ++state.epoch;lock(true);status('Deleting application…')
    try {
      await request('apps/' + encodeURIComponent(id),{method:'DELETE'})
      if (state.disposed || run !== state.epoch) return
      lock(false)
      if (state.current?.id === id) reset()
      await refresh();status('Application deleted.')
    } catch(error) {if (!state.disposed && run === state.epoch) status(error.message || 'Couldn’t delete. Try again.',true)}
    finally {if (!state.disposed && run === state.epoch) lock(false)}
  }
  function operation(text,creating) {
    const context = (creating ? 'new' : state.current.id + ':' + state.current.version) + ':' + text
    if (state.pending?.context !== context) state.pending = {context,key:creating && initialDraft?.ready && initialDraft.prompt === text ? 'application_draft_' + initialDraft.id : 'application_' + crypto.randomUUID()}
    return state.pending.key
  }
  async function build(text) {
    if (state.busy || typeof text !== 'string' || text.trim().length < 3 || text.length > 2000) {status('Describe your application in 3–2000 characters.',true);return}
    if(!discardEditor())return
    dictation?.stop()
    const creating = !state.current, targetId = state.current?.id, endpoint = creating ? 'apps' : path('refine'), key = operation(text,creating)
    const run = ++state.epoch;state.cancelController = new AbortController();lock(true);status(creating ? 'Creating application…' : 'Updating application…')
    try {
      const result = await request(endpoint,{method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({text}),signal:state.cancelController.signal})
      if (run !== state.epoch) return
      const outcome = applicationResultOutcome(result,{creating})
      if (!outcome.changed && !creating) {
        // A completed no-op is not a revision. Keep its idempotency receipt,
        // current frame, source label, history and editable instruction intact.
        state.cancelController = null;$('cancel-build').hidden = true
        message(text,outcome.message);status(outcome.message)
        return
      }
      const app = applicationFrom(result);await paint(app,run,targetId)
      if (run !== state.epoch) return
      state.editor=null;state.pending = null;state.cancelController = null;$('cancel-build').hidden = true;$('input').value = '';$('count').textContent = '0/2000'
      message(text,outcome.message)
      if (creating && initialDraft?.ready && initialDraft.prompt === text) {const id = initialDraft.id;initialDraft = null;onDraftBuilt(id)}
      await Promise.allSettled([history(),refresh()]);status('Saved to your account.')
    } catch(error) {if (run === state.epoch) status(error.message || 'Couldn’t finish. Your last application and instruction are kept.',true)}
    finally {if (run === state.epoch) {state.cancelController = null;lock(false)}}
  }
  function reset() {
    if (state.busy || !discardEditor()) return
    state.epoch++;state.current = null;state.source = null;state.editor=null;state.revisions=[];state.assets=[];state.assetEpoch++;clearAssetUrls();$('asset-list').replaceChildren();state.pending = null;state.frame?.remove();state.frame = null;state.frameApplication = null;bridgeRequests.clear()
    dictation?.stop();$('settings-meta').textContent = '';$('empty').hidden = false;$('title').textContent = 'Your next application';$('source').textContent = '';$('conversation').replaceChildren();$('history').replaceChildren();$('file-content').textContent = '';$('file').replaceChildren();$('input').value = '';$('count').textContent = '0/2000';$('composer-label').firstChild.textContent = 'What would you like to build?';showView('preview');lock(false);status('');$('input').focus()
  }
  async function loadSourceBundle() {
    if (!state.current) throw Error('Open a completed application first.')
    const app = state.current, id = app.id, version = app.version
    const response = await raw(path('source'))
    requireApplicationVersion(response,version)
    const result = await response.json()
    if (state.current?.id !== id || state.current.version !== version || state.disposed) throw Error('The project changed. Review the source again.')
    const manifest = validateApplicationManifest(result.manifest)
    if (!manifest || JSON.stringify(manifest) !== JSON.stringify(validateApplicationManifest(app.manifest))) throw Error('The project changed. Reopen it before continuing.')
    if (!Array.isArray(result.files) || result.files.length > 50 || result.files.some(file => typeof file.path !== 'string' || file.path.length > 160 || typeof file.content !== 'string' || (file.encoding!=null && file.encoding!=='base64')) || JSON.stringify(result.files).length > 8 * 1024 * 1024) throw Error('Source export was incomplete.')
    return result
  }
  async function source() {
    const result = await loadSourceBundle()
    state.source = result;$('file').replaceChildren()
    for (const file of result.files) {const option = element('option',file.path);option.value = file.path;$('file').append(option)}
    $('file').value=result.files.find(file=>file.path==='manifest.json')?.path || result.files[0]?.path || ''
    paintFile();showView('code')
  }
  function discardEditor() {
    return !state.editor?.dirty || confirm('Discard unapplied manifest edits? Your saved application and records are kept.')
  }
  function updateEditorStatus() {
    const editor=state.editor,stale=editor && (editor.id!==state.current?.id || editor.version!==state.current?.version)
    $('apply-manifest').disabled=state.busy || !editor?.dirty || stale
    $('reload-manifest').disabled=state.busy || !editor?.dirty
    $('editor-status').textContent=stale?'Project changed. Copy your edits before discarding.':editor?.dirty?'Unapplied edits':'Saved manifest'
  }
  async function paintFile() {
    const app=state.current,file=state.source?.files.find(file=>file.path===$('file').value)
    if(!app || !file)return
    const editable=file.path==='manifest.json' && !file.encoding
    $('read-only-source').hidden=editable;$('editor-label').hidden=!editable;$('editor-actions').hidden=!editable
    $('copy-file').disabled=state.busy || file.encoding==='base64'
    if(editable){
      if(!state.editor || (!state.editor.dirty && (state.editor.id!==app.id || state.editor.version!==app.version)))state.editor={id:app.id,version:app.version,text:JSON.stringify(app.manifest,null,2),dirty:false}
      $('manifest-editor').value=state.editor.text
    }else $('file-content').textContent=file.encoding==='base64'?`Binary image · ${file.path}\nUse Assets to preview or download it.`:file.content
    updateEditorStatus()
    const label=editable?'Editable manifest':file.encoding==='base64'?'Binary image':'Read-only runtime file'
    $('file-meta').textContent=label
    try{
      const bytes=file.encoding==='base64'?Uint8Array.from(atob(file.content),char=>char.charCodeAt(0)):new TextEncoder().encode(file.content)
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('')
      if(state.current?.id!==app.id || state.current.version!==app.version || $('file').value!==file.path)return
      $('file-meta').textContent=`${label} · SHA-256 ${hash.slice(0,16)}`;$('file-meta').title='SHA-256 '+hash
    }catch{/* Source is still readable without Web Crypto. */}
  }
  async function saveManifest(manifest,{fromEditor=false}={}) {
    if(!state.current || state.busy)return
    const checked=validateApplicationManifest(manifest)
    if(!checked){status('Manifest is invalid. Keep the supported schema, fields and design values.',true);return}
    const id=state.current.id,version=fromEditor?state.editor?.version:state.current.version,run=++state.epoch,previousView=state.view
    lock(true);status('Applying manifest…')
    try{
      const result=await request(path('manifest'),{method:'PUT',body:JSON.stringify({manifest:checked,version})})
      if(run!==state.epoch)return
      if(result.changed===false){if(fromEditor){state.editor.dirty=false;updateEditorStatus()}status('No changes.');return}
      await paint(applicationFrom(result),run,id)
      if(run!==state.epoch)return
      state.editor=null
      await Promise.allSettled([history(),refresh()])
      if(previousView==='code')await source()
      else if(previousView==='assets'){showView('assets');await loadAssets()}
      status('Manifest saved. Records kept.')
    }catch(error){if(run===state.epoch)status(error.message || 'Couldn’t apply. Your edits and last preview are kept.',true)}
    finally{if(run===state.epoch)lock(false)}
  }
  function clearAssetUrls() {for(const url of state.assetUrls)URL.revokeObjectURL(url);state.assetUrls.clear()}
  function downloadBlob(blob,name) {
    const url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)
  }
  async function imageBlob(asset,app=state.current) {
    const response=await raw('apps/'+encodeURIComponent(app.id)+'/assets/'+encodeURIComponent(asset.id),{headers:{'x-compass-app-version':String(app.version)}})
    requireApplicationVersion(response,app.version)
    const blob=await response.blob()
    if(blob.size>524288 || !['image/png','image/jpeg'].includes(blob.type))throw Error('Image response was refused.')
    return blob
  }
  async function loadAssets() {
    if(!state.current)return
    const app=state.current,run=++state.assetEpoch
    $('asset-quota').textContent='Loading images…'
    try{
      const result=await request(path('assets'))
      if(state.disposed || run!==state.assetEpoch || state.current?.id!==app.id || state.current.version!==app.version)return
      if(!Array.isArray(result.assets) || result.assets.length>8)throw Error('Image list was incomplete.')
      clearAssetUrls();state.assets=result.assets.filter(asset=>APP_ID.test(asset.id || '') && ['image/png','image/jpeg'].includes(asset.mime) && Number.isSafeInteger(asset.bytes) && asset.bytes<=524288)
      $('asset-list').replaceChildren()
      const retained=result.quota?.applicationBytes
      $('asset-quota').textContent=state.assets.length?`${state.assets.length} ${state.assets.length===1?'image':'images'}${Number.isFinite(retained)?' · '+Math.ceil(retained/1024)+' KB including revision history':''}`:'No images yet.'
      for(const asset of state.assets){
        const row=element('article',null,'aw-asset'),image=element('img'),info=element('p',`${asset.width} × ${asset.height} · ${Math.ceil(asset.bytes/1024)} KB`),actions=element('div',null,'aw-asset-actions')
        image.alt='Project image';image.loading='lazy';row.append(image,info,actions)
        for(const role of ['logo','hero']){const selected=app.manifest.assets?.[role]===asset.id,button=element('button',selected?'Remove '+role:'Use as '+role);button.type='button';button.setAttribute('aria-pressed',String(selected));button.addEventListener('click',()=>{if(state.busy || !discardEditor())return;const manifest=structuredClone(state.current.manifest);manifest.assets={...manifest.assets};if(selected)delete manifest.assets[role];else manifest.assets[role]=asset.id;void saveManifest(manifest)});actions.append(button)}
        const download=element('button','Download'),remove=element('button','Delete');download.type=remove.type='button'
        download.addEventListener('click',async()=>{try{const blob=await imageBlob(asset,app);if(state.current?.id!==app.id || state.current.version!==app.version)return;downloadBlob(blob,asset.id+(asset.mime==='image/png'?'.png':'.jpg'));status('Image download started.')}catch(error){status(error.message,true)}})
        remove.disabled=Object.values(app.manifest.assets || {}).includes(asset.id);remove.dataset.assetSelected=String(remove.disabled);remove.title=remove.disabled?'Remove its logo or hero selection first.':'Delete image'
        remove.addEventListener('click',()=>mutateAsset(asset,'DELETE'))
        actions.append(download,remove);$('asset-list').append(row)
        void imageBlob(asset,app).then(blob=>{if(state.disposed || run!==state.assetEpoch || state.current?.id!==app.id || state.current.version!==app.version)return;const url=URL.createObjectURL(blob);state.assetUrls.add(url);image.src=url}).catch(()=>{image.alt='Image preview unavailable'})
      }
    }catch(error){if(run===state.assetEpoch)$('asset-quota').textContent=error.message || 'Couldn’t load images. Reopen Assets to retry.'}
  }
  async function mutateAsset(value,method='POST') {
    if(!state.current || state.busy || !discardEditor())return
    if(method==='POST' && (!['image/png','image/jpeg'].includes(value?.type) || value.size>524288 || value.size<1)){status('Choose a PNG or JPEG up to 512 KB.',true);return}
    const app=state.current,run=++state.epoch;lock(true);status(method==='POST'?'Uploading image…':'Deleting image…')
    try{
      const endpoint=path('assets')+(method==='DELETE'?'/'+encodeURIComponent(value.id):'')
      const response=await raw(endpoint,{method,headers:{'x-compass-app-version':String(app.version),...(method==='POST'?{'content-type':value.type}:{})},...(method==='POST'?{body:value}:{})})
      const result=await response.json();await paint(applicationFrom(result),run,app.id)
      if(run!==state.epoch)return
      state.editor=null;await Promise.allSettled([history(),refresh()]);showView('assets');await loadAssets();status(method==='POST'?'Image saved. Choose logo or hero to use it.':'Image removed. Revision history is kept.')
    }catch(error){if(run===state.epoch)status(error.message || 'Couldn’t finish. Your current project is kept.',true)}
    finally{if(run===state.epoch){$('upload-asset').value='';lock(false)}}
  }
  async function bridge(event) {
    const frame = state.frame, app = state.current, frameEpoch = state.frameEpoch
    if (!frame || !app || state.disposed || event.source !== frame.contentWindow || state.frameApplication !== app.id) return
    const input = validateApplicationBridgeMessage(event.data,app.manifest)
    if (!input) return
    const reply = data => {if (!state.disposed && state.frame === frame && state.current?.id === app.id && state.frameEpoch === frameEpoch) frame.contentWindow.postMessage({type:'compass-app-response',requestId:input.requestId,...data},'*')}
    if ((state.busy && !['list','asset'].includes(input.action)) || bridgeInFlight >= 8) {reply({ok:false,error:'The application is updating. Try again in a moment.'});return}
    if (bridgeRequests.has(input.requestId)) {const saved = bridgeRequests.get(input.requestId);if (saved) reply(saved);return}
    if (bridgeRequests.size >= 500) {reply({ok:false,error:'Reopen this application to continue.'});return}
    bridgeRequests.set(input.requestId,null)
    bridgeInFlight++
    try {
      if(input.action==='asset'){
        const blob=await imageBlob({id:input.assetId},app)
        const dataUri=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Image unavailable.'));reader.readAsDataURL(blob)})
        const response={ok:true,asset:{id:input.assetId,mime:blob.type,dataUri}}
        // Do not retain full image bytes for hundreds of replay IDs.
        bridgeRequests.set(input.requestId,{ok:false,error:'Request the image with a new request ID.'});reply(response);return
      }
      const endpoint = 'apps/' + encodeURIComponent(app.id) + '/records' + (input.id ? '/' + encodeURIComponent(input.id) : '')
      const options = {method:{list:'GET',create:'POST',update:'PUT',delete:'DELETE'}[input.action]}
      if (['create','update'].includes(input.action)) options.body = JSON.stringify({data:input.data})
      const result = await request(endpoint,options), response = {ok:true,...(input.action === 'list' ? {records:result.records} : result.record ? {record:result.record} : {})}
      bridgeRequests.set(input.requestId,JSON.stringify(response).length <= 8192 ? response : {ok:false,error:'This request completed. Refresh to see the result.'});reply(response)
    } catch {const response = {ok:false,error:'This request could not finish. Try again.'};bridgeRequests.set(input.requestId,response);reply(response)}
    finally {bridgeInFlight--}
  }
  window.addEventListener('message',bridge)
  const dictation = createDictation(window,{
    onState(value) {$('voice').setAttribute('aria-pressed',String(value !== 'idle'));$('voice').textContent = value === 'idle' ? 'Speak' : 'Stop';$('voice-status').textContent = value === 'starting' ? 'Waiting for microphone…' : value === 'listening' ? 'Listening…' : ''},
    onTranscript(text) {
      const left = voiceSelection.prefix && !/\s$/.test(voiceSelection.prefix) && text ? voiceSelection.prefix + ' ' : voiceSelection.prefix
      const right = voiceSelection.suffix && !/^\s/.test(voiceSelection.suffix) && text ? ' ' + voiceSelection.suffix : voiceSelection.suffix
      $('input').value = (left + text + right).slice(0,2000);$('count').textContent = $('input').value.length + '/2000'
    },
    onError(message) {$('voice-status').textContent = message},
    onEnd(reason,text) {if (text) $('voice-status').textContent = 'Edit your words, then build.'},
  },{max:2000,autoSubmit:false})
  $('voice').addEventListener('click',() => {if (state.busy || !dictation) return;if (dictation.active) dictation.stop();else {const input = $('input'), start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;voiceSelection = {prefix:input.value.slice(0,start),suffix:input.value.slice(end)};dictation.start()}})
  function cancelBuild(){if (!state.cancelController) return;state.epoch++;state.cancelController.abort();state.cancelController = null;lock(false);status('Stopped waiting. Instruction kept; retry to check the result.')}
  $('cancel-build').addEventListener('click',cancelBuild)
  $('composer').addEventListener('submit',event => {event.preventDefault();void build($('input').value)})
  $('input').addEventListener('input',() => {$('count').textContent = $('input').value.length + '/2000'})
  $('input').addEventListener('keydown',event => {if (event.key === 'Escape') dictation?.stop();if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {event.preventDefault();void build($('input').value)}})
  $('new').addEventListener('click',reset);$('refresh-projects').addEventListener('click',refresh)
  $('preview-tab').addEventListener('click',() => showView('preview'))
  $('code-tab').addEventListener('click',() => {if (state.source) showView('code');else void source().catch(error => status(error.message,true))})
  for (const mode of ['desktop','tablet','mobile']) $(mode).addEventListener('click',() => {state.viewport=mode;for(const name of ['desktop','tablet','mobile'])$(name).setAttribute('aria-pressed',String(name===mode));if(state.frame)state.frame.dataset.viewport=mode})
  $('file').addEventListener('change',paintFile)
  $('copy-file').addEventListener('click',async () => {try {await navigator.clipboard.writeText($('file').value==='manifest.json' ? $('manifest-editor').value : $('file-content').textContent);status('File copied.')}catch {status('Copy is unavailable here. Export the source instead.',true)}})
  $('manifest-editor').addEventListener('input',()=>{if(!state.editor)return;state.editor.text=$('manifest-editor').value;state.editor.dirty=state.editor.text!==JSON.stringify(state.current.manifest,null,2);updateEditorStatus()})
  $('apply-manifest').addEventListener('click',()=>{if(!state.editor?.dirty || $('apply-manifest').disabled)return;try{void saveManifest(JSON.parse(state.editor.text),{fromEditor:true})}catch{status('Invalid JSON. Your edits are kept.',true)}})
  $('reload-manifest').addEventListener('click',()=>{if(!discardEditor())return;state.editor=null;void paintFile()})
  $('assets-tab').addEventListener('click',()=>{showView('assets');void loadAssets()})
  $('upload-asset').addEventListener('change',()=>{const file=$('upload-asset').files?.[0];if(file)void mutateAsset(file)})
  for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,event=>{event.preventDefault();if(!state.busy && state.current)$('dropzone').classList.add('is-over')})
  for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,event=>{event.preventDefault();$('dropzone').classList.remove('is-over');if(type==='drop'){const files=[...(event.dataTransfer?.files || [])];if(files.length!==1){status('Drop one image at a time.',true);return}void mutateAsset(files[0])}})
  $('undo').addEventListener('click',()=>{if(state.busy)return;undoTargets ||= state.revisions.filter(revision=>revision.version<state.current?.version).map(item=>item.version).sort((a,b)=>b-a);const previous=undoTargets.shift();if(previous)void restoreRevision(previous,{undo:true})})
  const shortcuts=event=>{
    if(event.defaultPrevented || container.hidden)return
    if(event.key==='Escape'){dictation?.stop();if(state.cancelController){event.preventDefault();cancelBuild()}}
    if((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase()==='f' && state.current){event.preventDefault();if(!state.busy)void source().then(()=>$('file').focus()).catch(error=>status(error.message,true))}
    if((event.ctrlKey || event.metaKey) && event.key==='Enter' && event.target===$('manifest-editor')){event.preventDefault();$('apply-manifest').click()}
  }
  container.addEventListener('keydown',shortcuts)
  $('download-data').addEventListener('click',async()=>{
    const app=state.current,run=state.epoch;if(!app || state.busy)return
    try{
      const response=await raw(path('data'));requireApplicationVersion(response,app.version)
      const blob=await response.blob();if(run!==state.epoch || state.current?.id!==app.id)return
      if(blob.size>4*1024*1024)throw Error('Record export is too large.')
      downloadBlob(blob,'compass-records.json');status('Record download started. Keep it private.')
    }catch(error){if(run===state.epoch)status(error.message || 'Couldn’t export records. Try again.',true)}
  })
  $('download').addEventListener('click',async () => {
    if (!state.current || state.busy) return
    const app = state.current
    try {const response = await raw(path('export'));requireApplicationVersion(response,app.version);const blob = await response.blob();if (blob.size > 6 * 1024 * 1024) throw Error('Export too large.');if(state.current?.id!==app.id || state.current.version!==app.version)return;downloadBlob(blob,(app.manifest.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60) || 'compass-application')+'.zip');status('Source download started.')}
    catch(error) {status(error.message || 'Couldn’t download. Try again.',true)}
  })
  $('design-form').addEventListener('submit',async event => {
    event.preventDefault();if (!state.current || state.busy || !discardEditor()) return
    const id = state.current.id, theme = Object.fromEntries(new FormData($('design-form'))), run = ++state.epoch;lock(true);status('Applying design…')
    try {const result = await request(path('design'),{method:'PUT',body:JSON.stringify({theme,version:state.current.version})});await paint(applicationFrom(result),run,id);if (run !== state.epoch) return;state.editor=null;await history();status('Design updated.')}
    catch(error) {if (run === state.epoch) status(error.message || 'Couldn’t update design. Your current application is unchanged.',true)}
    finally {if (run === state.epoch) lock(false)}
  })
  $('delete-current').addEventListener('click',() => {if (state.current) void removeApplication(state.current.id,$('delete-current'))})
  const authorizedDraft = draftCanAutoBuild(initialDraft,{accountMode:true,userId})
  if (initialDraft?.ready && !authorizedDraft) {disarmDraft({id:initialDraft.id});initialDraft = null;status('Review your idea with this account before building.',true)}
  lock(false);await refresh()
  if (authorizedDraft && typeof initialDraft.prompt === 'string' && initialDraft.prompt.length <= 500 && APP_ID.test(initialDraft.id || '')) {$('input').value = initialDraft.prompt;$('count').textContent = initialDraft.prompt.length + '/2000';await build(initialDraft.prompt)}
  return {show() {container.hidden = false},hide() {dictation?.stop();container.hidden = true},refresh,open:openApplication,getSource:loadSourceBundle,destroy() {dictation?.stop();state.cancelController?.abort();state.disposed = true;state.epoch++;state.assetEpoch++;clearAssetUrls();paneLayout.destroy();container.removeEventListener('keydown',shortcuts);state.frame?.remove();window.removeEventListener('message',bridge);bridgeRequests.clear();container.replaceChildren()},get currentApplication() {return state.current}}
}
