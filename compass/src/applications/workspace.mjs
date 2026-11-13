import './workspace.css'
import {validateApplicationManifest} from '../../generation/templates/lib/schema.mjs'
import {validateApplicationBridgeMessage} from './bridge.mjs'
import {createDictation} from '../demo/voice.mjs'
import {draftCanAutoBuild,disarmDraft} from '../create/draft.mjs'
import {applicationResultOutcome,requireApplicationVersion} from './result.mjs'
export {validateApplicationBridgeMessage} from './bridge.mjs'

const APP_ID = /^[A-Za-z0-9_-]{1,80}$/
const element = (tag,text,className) => {const node = document.createElement(tag);if (text != null) node.textContent = String(text);if (className) node.className = className;return node}

export async function mountApplicationWorkspace({container,request,requestRaw,userId,onMessage = () => {},onDraftBuilt = () => {},initialDraft,preferences = {}} = {}) {
  if (!container || typeof request !== 'function' || !APP_ID.test(userId || '')) throw TypeError('An authenticated application workspace is required.')
  container.classList.add('application-workspace')
  container.dataset.layout = ['balanced','preview','conversation'].includes(preferences.workspaceLayout) ? preferences.workspaceLayout : 'balanced'
  container.innerHTML = `<div class="aw-heading"><h2>Applications</h2><button type="button" data-aw="new">New application</button></div>
<div class="aw-layout"><aside class="aw-projects" aria-label="Your applications"><div class="aw-section-heading"><h3>Projects</h3><button type="button" data-aw="refresh-projects">Refresh</button></div><ul data-aw="projects"></ul><p data-aw="project-status" role="status"></p></aside>
<section class="aw-canvas" aria-label="Application preview"><div class="aw-toolbar"><div><h3 data-aw="title">Your next application</h3><p data-aw="source"></p></div><div class="aw-tabs" role="group" aria-label="Application view"><button type="button" data-aw="preview-tab" aria-pressed="true">Preview</button><button type="button" data-aw="code-tab" aria-pressed="false" disabled>Code</button></div></div>
<div class="aw-actions"><div class="aw-tabs" role="group" aria-label="Preview width"><button type="button" data-aw="desktop" aria-pressed="true">Desktop</button><button type="button" data-aw="mobile" aria-pressed="false">Mobile</button></div><button type="button" data-aw="download" disabled>Download source</button></div>
<details class="aw-design" data-aw="design"><summary>Design</summary><form data-aw="design-form"><label>Theme<select name="mode"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Accent<select name="accent"><option value="indigo">Indigo</option><option value="blue">Blue</option><option value="slate">Slate</option><option value="rose">Rose</option><option value="amber">Amber</option></select></label><label>Type<select name="font"><option value="sans">Sans</option><option value="serif">Serif</option></select></label><label>Spacing<select name="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button type="submit" data-aw="apply-design" disabled>Apply design</button></form></details>
<div class="aw-preview" data-aw="preview"><p class="aw-empty" data-aw="empty">Describe the application you want to work with.</p></div>
<section class="aw-code" data-aw="code" aria-label="Application source" hidden><div><label>File<select data-aw="file"></select></label><button type="button" data-aw="copy-file">Copy file</button></div><pre tabindex="0"><code data-aw="file-content"></code></pre></section>
<details class="aw-history"><summary>History</summary><p>Restore a design revision. Your records stay intact.</p><ol data-aw="history"></ol></details></section>
<aside class="aw-conversation" aria-label="Build your application"><form data-aw="composer"><label data-aw="composer-label">What would you like to build?<textarea data-aw="input" rows="5" maxlength="2000" placeholder="A CRM for my studio, with contacts, companies and follow-up status…" required></textarea></label><div class="aw-compose-actions"><button type="button" data-aw="voice" aria-pressed="false">Speak</button><span data-aw="count">0/2000</span><button type="submit" data-aw="submit">Build application</button></div><button type="button" data-aw="cancel-build" class="aw-cancel" hidden>Cancel</button></form><p data-aw="voice-status" class="aw-status" role="status"></p><p data-aw="status" class="aw-status" role="status" aria-live="polite"></p><ol data-aw="conversation" class="aw-messages"></ol><details class="aw-runtime-details"><summary>Details</summary><p>Working data apps use a trusted runtime. The frame has no account token or network access. Records are checked by the account API.</p><p>Voice uses your browser’s speech service. COMPASS receives only submitted text. Dictation stays editable.</p><p data-aw="settings-meta"></p><button type="button" data-aw="download-data" disabled>Download records</button><button type="button" data-aw="delete-current" disabled>Delete this application</button></details></aside></div>`
  const $ = key => container.querySelector(`[data-aw="${key}"]`)
  const state = {current:null,epoch:0,busy:false,frame:null,frameApplication:null,frameEpoch:0,disposed:false,pending:null,source:null,mobile:false,cancelController:null}
  const bridgeRequests = new Map()
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
    for (const node of container.querySelectorAll('button,select,textarea')) node.disabled = value
    $('download-data').disabled=value || !state.current;$('code-tab').disabled = value || !state.current;$('download').disabled = value || !state.current;$('apply-design').disabled = value || !state.current
    $('delete-current').disabled = value || !state.current
    $('voice').disabled = value || !dictation
    $('cancel-build').hidden = !value || !state.cancelController
    $('cancel-build').disabled = false
    if (!value) container.querySelectorAll('[data-restore-version]').forEach(button => {button.disabled = Number(button.dataset.restoreVersion) === state.current?.version})
    $('submit').textContent = value ? 'Building…' : state.current ? 'Update application' : 'Build application'
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
    $('preview').hidden = view === 'code';$('code').hidden = view !== 'code'
    $('preview-tab').setAttribute('aria-pressed',String(view !== 'code'));$('code-tab').setAttribute('aria-pressed',String(view === 'code'))
  }
  function replaceFrame(html,appId) {
    state.frame?.remove();bridgeRequests.clear()
    const frame = element('iframe');frame.title = state.current.manifest.title + ' application';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy = 'no-referrer';frame.className = state.mobile ? 'aw-frame is-mobile' : 'aw-frame'
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
    state.current = app;state.source = null
    $('title').textContent = app.manifest.title
    $('source').textContent = app.source === 'model' ? 'AI build' : 'Prepared build'
    $('settings-meta').textContent = `${app.manifest.kind.toUpperCase()} · Version ${app.version} · Source export available above.`
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
    $('history').replaceChildren()
    for (const revision of result.revisions) {
      if (!Number.isSafeInteger(revision.version) || revision.version < 1) continue
      const row = element('li'), label = element('span','Version ' + revision.version), restore = element('button','Restore')
      restore.dataset.restoreVersion = revision.version
      restore.type = 'button';restore.disabled = revision.version === state.current.version
      restore.addEventListener('click',async () => {
        if (state.busy) return
        const run = ++state.epoch;lock(true);status('Restoring revision…')
        try {const result = await request(path('restore'),{method:'POST',body:JSON.stringify({version:revision.version})});await paint(applicationFrom(result),run,id);if (run !== state.epoch) return;await history();status('Revision restored. Records are unchanged.')}
        catch(error) {if (run === state.epoch) status(error.message || 'Couldn’t restore. Your current application is unchanged.',true)}
        finally {if (run === state.epoch) lock(false)}
      })
      row.append(label,restore);$('history').append(row)
    }
  }
  async function openApplication(id) {
    if (state.busy || !APP_ID.test(id)) return
    const run = ++state.epoch;lock(true);status('Opening application…')
    try {const result = await request('apps/' + encodeURIComponent(id));await paint(applicationFrom(result),run,id);if (run !== state.epoch) return;$('conversation').replaceChildren();await history();await refresh();status('')}
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
      state.pending = null;state.cancelController = null;$('cancel-build').hidden = true;$('input').value = '';$('count').textContent = '0/2000'
      message(text,outcome.message)
      if (creating && initialDraft?.ready && initialDraft.prompt === text) {const id = initialDraft.id;initialDraft = null;onDraftBuilt(id)}
      await Promise.allSettled([history(),refresh()]);status('Saved to your account.')
    } catch(error) {if (run === state.epoch) status(error.message || 'Couldn’t finish. Your last application and instruction are kept.',true)}
    finally {if (run === state.epoch) {state.cancelController = null;lock(false)}}
  }
  function reset() {
    if (state.busy) return
    state.epoch++;state.current = null;state.source = null;state.pending = null;state.frame?.remove();state.frame = null;state.frameApplication = null;bridgeRequests.clear()
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
    if (!Array.isArray(result.files) || result.files.length > 30 || result.files.some(file => typeof file.path !== 'string' || file.path.length > 160 || typeof file.content !== 'string') || JSON.stringify(result.files).length > 2 * 1024 * 1024) throw Error('Source export was incomplete.')
    return result
  }
  async function source() {
    const result = await loadSourceBundle()
    state.source = result;$('file').replaceChildren()
    for (const file of result.files) {const option = element('option',file.path);option.value = file.path;$('file').append(option)}
    $('file-content').textContent = result.files[0]?.content || '';showView('code')
  }
  async function bridge(event) {
    const frame = state.frame, app = state.current, frameEpoch = state.frameEpoch
    if (!frame || !app || state.disposed || event.source !== frame.contentWindow || state.frameApplication !== app.id) return
    const input = validateApplicationBridgeMessage(event.data,app.manifest)
    if (!input) return
    const reply = data => {if (!state.disposed && state.frame === frame && state.current?.id === app.id && state.frameEpoch === frameEpoch) frame.contentWindow.postMessage({type:'compass-app-response',requestId:input.requestId,...data},'*')}
    if ((state.busy && input.action !== 'list') || bridgeInFlight >= 8) {reply({ok:false,error:'The application is updating. Try again in a moment.'});return}
    if (bridgeRequests.has(input.requestId)) {const saved = bridgeRequests.get(input.requestId);if (saved) reply(saved);return}
    if (bridgeRequests.size >= 500) {reply({ok:false,error:'Reopen this application to continue.'});return}
    bridgeRequests.set(input.requestId,null)
    bridgeInFlight++
    try {
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
  $('cancel-build').addEventListener('click',() => {if (!state.cancelController) return;state.epoch++;state.cancelController.abort();state.cancelController = null;lock(false);status('Stopped waiting. Your instruction is kept; retry to check the result.')})
  $('composer').addEventListener('submit',event => {event.preventDefault();void build($('input').value)})
  $('input').addEventListener('input',() => {$('count').textContent = $('input').value.length + '/2000'})
  $('input').addEventListener('keydown',event => {if (event.key === 'Escape') dictation?.stop();if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {event.preventDefault();void build($('input').value)}})
  $('new').addEventListener('click',reset);$('refresh-projects').addEventListener('click',refresh)
  $('preview-tab').addEventListener('click',() => showView('preview'))
  $('code-tab').addEventListener('click',() => {if (state.source) showView('code');else void source().catch(error => status(error.message,true))})
  for (const mode of ['desktop','mobile']) $(mode).addEventListener('click',() => {state.mobile = mode === 'mobile';$('desktop').setAttribute('aria-pressed',String(!state.mobile));$('mobile').setAttribute('aria-pressed',String(state.mobile));state.frame?.classList.toggle('is-mobile',state.mobile)})
  $('file').addEventListener('change',() => {$('file-content').textContent = state.source?.files.find(file => file.path === $('file').value)?.content || ''})
  $('copy-file').addEventListener('click',async () => {try {await navigator.clipboard.writeText($('file-content').textContent);status('File copied.')}catch {status('Copy is unavailable here. Download the source instead.',true)}})
  $('download-data').addEventListener('click',async()=>{
    const app=state.current,run=state.epoch;if(!app || state.busy)return
    try{
      const response=await raw(path('data'));requireApplicationVersion(response,app.version)
      const blob=await response.blob();if(run!==state.epoch || state.current?.id!==app.id)return
      if(blob.size>4*1024*1024)throw Error('Record export is too large.')
      const url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download='compass-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);status('Records downloaded. Keep this file private.')
    }catch(error){if(run===state.epoch)status(error.message || 'Couldn’t export records. Try again.',true)}
  })
  $('download').addEventListener('click',async () => {
    if (!state.current || state.busy) return
    const app = state.current
    try {const response = await raw(path('export'));requireApplicationVersion(response,app.version);const blob = await response.blob();if (blob.size > 2 * 1024 * 1024) throw Error('Export too large.');const url = URL.createObjectURL(blob), link = element('a');link.href = url;link.download = (app.manifest.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60) || 'compass-application') + '.zip';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);status('Source downloaded.')}
    catch(error) {status(error.message || 'Couldn’t download. Try again.',true)}
  })
  $('design-form').addEventListener('submit',async event => {
    event.preventDefault();if (!state.current || state.busy) return
    const id = state.current.id, theme = Object.fromEntries(new FormData($('design-form'))), run = ++state.epoch;lock(true);status('Applying design…')
    try {const result = await request(path('design'),{method:'PUT',body:JSON.stringify({theme,version:state.current.version})});await paint(applicationFrom(result),run,id);if (run !== state.epoch) return;await history();status('Design updated.')}
    catch(error) {if (run === state.epoch) status(error.message || 'Couldn’t update design. Your current application is unchanged.',true)}
    finally {if (run === state.epoch) lock(false)}
  })
  $('delete-current').addEventListener('click',() => {if (state.current) void removeApplication(state.current.id,$('delete-current'))})
  const authorizedDraft = draftCanAutoBuild(initialDraft,{accountMode:true,userId})
  if (initialDraft?.ready && !authorizedDraft) {disarmDraft({id:initialDraft.id});initialDraft = null;status('Review your idea with this account before building.',true)}
  lock(false);await refresh()
  if (authorizedDraft && typeof initialDraft.prompt === 'string' && initialDraft.prompt.length <= 500 && APP_ID.test(initialDraft.id || '')) {$('input').value = initialDraft.prompt;$('count').textContent = initialDraft.prompt.length + '/2000';await build(initialDraft.prompt)}
  return {show() {container.hidden = false},hide() {dictation?.stop();container.hidden = true},refresh,open:openApplication,getSource:loadSourceBundle,destroy() {dictation?.stop();state.cancelController?.abort();state.disposed = true;state.epoch++;state.frame?.remove();window.removeEventListener('message',bridge);bridgeRequests.clear();container.replaceChildren()},get currentApplication() {return state.current}}
}
