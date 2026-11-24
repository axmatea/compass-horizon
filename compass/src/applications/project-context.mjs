const NOTE_FIELDS = {
  goal: 'Goal',
  architecture: 'Architecture',
  preferences: 'Preferences',
  dependencies: 'Dependencies',
  problems: 'Open problems',
}
const noteKeys = Object.keys(NOTE_FIELDS)
const entryKeys = ['context-decision','context-replacement','context-task']
const ITEM_LIMIT = 20
const TASK_LABELS = {active:'Active',done:'Done',cancelled:'Cancelled'}

export const projectContextMarkup = [
  '<details class="aw-context" data-aw="project-context" hidden>',
  '<summary>Project context</summary>',
  '<p class="aw-context-description">Active context is included in AI requests.</p>',
  '<p class="aw-context-status" data-aw="context-status" role="status"></p>',
  '<button type="button" data-aw="context-refresh">Refresh context</button>',
  '<div class="aw-context-body" data-aw="context-body" hidden>',
  '<details data-aw="context-note-conflicts" class="aw-context-conflicts" hidden><summary>Saved values for edited notes</summary><ul data-aw="context-note-conflict-list"></ul></details>',
  '<form class="aw-context-notes" data-aw="context-notes" aria-label="Project notes">',
  ...noteKeys.map(key =>
    '<label>' + NOTE_FIELDS[key] + '<textarea data-aw="context-note-' + key + '" rows="2" maxlength="300"></textarea></label>'),
  '<button type="submit" data-aw="context-save">Save notes</button></form>',
  '<section class="aw-context-section"><h3>Decisions</h3>',
  '<ul data-aw="context-decisions" aria-label="Project decisions"></ul>',
  '<p class="aw-context-empty" data-aw="context-no-decisions">No decisions yet.</p>',
  '<form data-aw="context-decision-form"><label>New decision<input data-aw="context-decision" maxlength="220" required></label>',
  '<button type="submit" data-aw="context-add-decision">Add decision</button></form>',
  '<form data-aw="context-replace-form" hidden><p data-aw="context-replace-target"></p>',
  '<label>Replacement decision<input data-aw="context-replacement" maxlength="220" required></label>',
  '<div class="aw-context-actions"><button type="submit" data-aw="context-replace">Save replacement</button>',
  '<button type="button" data-aw="context-cancel-replace">Cancel</button></div></form></section>',
  '<section class="aw-context-section"><h3>Tasks</h3>',
  '<ul data-aw="context-tasks" aria-label="Project tasks"></ul>',
  '<p class="aw-context-empty" data-aw="context-no-tasks">No tasks yet.</p>',
  '<form data-aw="context-task-form"><label>New task<input data-aw="context-task" maxlength="220" required></label>',
  '<button type="submit" data-aw="context-add-task">Add task</button></form></section>',
  '<section class="aw-context-section"><h3>Recent changes</h3>',
  '<ol data-aw="context-changes" aria-label="Recent changes"></ol>',
  '<p class="aw-context-empty" data-aw="context-no-changes">No changes yet.</p></section></div></details>',
].join('')

const node = (tag, text, className) => {
  const item = document.createElement(tag)
  if (text) item.textContent = text
  if (className) item.className = className
  return item
}

export function mountProjectContext({find,request,isLocked,onVersionChange}) {
  const disclosure = find('project-context')
  const fields = Object.fromEntries(noteKeys.map(key => [key,find('context-note-' + key)]))
  let appId = null
  let snapshot = null
  let pending = null
  let needsRefresh = false
  let replacing = null
  let rowActions = []

  function showStatus(message, error = false) {
    const status = find('context-status')
    status.textContent = message
    status.dataset.error = String(error)
  }

  function changedNotes() {
    return noteKeys.filter(key => fields[key].value !== (snapshot?.notes[key] ?? ''))
  }

  function decisionsLimitReached() {
    return snapshot.decisions.length >= ITEM_LIMIT && snapshot.decisions.every(decision => !decision.supersededBy)
  }

  function tasksLimitReached() {
    return snapshot.tasks.length >= ITEM_LIMIT && snapshot.tasks.every(task => task.status === 'active')
  }

  function syncControls() {
    const locked = !appId || isLocked() || Boolean(pending)
    const readOnly = locked || !snapshot || needsRefresh
    for (const field of Object.values(fields)) field.disabled = locked
    find('context-refresh').disabled = locked
    find('context-save').disabled = readOnly || !changedNotes().length
    for (const key of entryKeys) find(key).disabled = locked
    find('context-cancel-replace').disabled = locked
    find('context-add-decision').disabled = readOnly || !find('context-decision').value.trim() || decisionsLimitReached()
    find('context-replace').disabled = readOnly || !find('context-replacement').value.trim() || !replacing || !snapshot.decisions.some(decision => decision.id === replacing && !decision.supersededBy)
    find('context-add-task').disabled = readOnly || !find('context-task').value.trim() || tasksLimitReached()
    for (const button of rowActions) button.disabled = readOnly
  }

  function action(label, click, description) {
    const button = node('button',label)
    button.type = 'button'
    button.setAttribute('aria-label',description)
    button.addEventListener('click',click)
    rowActions.push(button)
    return button
  }

  function replaceDecision(decision) {
    replacing = decision.id
    find('context-replace-target').textContent = decision.text
    find('context-replace-form').hidden = false
    find('context-replacement').focus()
    syncControls()
  }

  function clearReplacement() {
    replacing = null
    find('context-replacement').value = ''
    find('context-replace-form').hidden = true
  }

  function renderLists() {
    rowActions = []
    const {decisions,tasks,recentChanges} = snapshot
    const decisionRows = decisions.map(decision => {
      const replaced = Boolean(decision.supersededBy)
      const row = node('li',null,'aw-context-item')
      row.append(node('p',decision.text),node('span',replaced ? 'Superseded' : 'Active','aw-context-state'))
      if (!replaced) row.append(action('Replace',() => replaceDecision(decision),'Replace decision ' + decision.text))
      return row
    })
    const taskRows = tasks.map(task => {
      const row = node('li',null,'aw-context-item')
      row.append(node('p',task.text),node('span',TASK_LABELS[task.status],'aw-context-state'))
      const controls = node('div',null,'aw-context-actions')
      const change = (label,status) => action(label,() => {
        void changeContext('POST',{action:'task-status',id:task.id,status},'Task updated.')
      },label + ' task ' + task.text)
      if (task.status === 'active') controls.append(change('Complete','done'),change('Cancel','cancelled'))
      else controls.append(change('Reopen','active'))
      row.append(controls)
      return row
    })
    const changeRows = recentChanges.map(change => {
      const row = node('li',null,'aw-context-item')
      row.append(node('span','Version ' + change.version,'aw-context-state'))
      if (change.prompt) row.append(node('p',change.prompt))
      return row
    })
    find('context-decisions').replaceChildren(...decisionRows)
    find('context-tasks').replaceChildren(...taskRows)
    find('context-changes').replaceChildren(...changeRows)
    find('context-no-decisions').hidden = Boolean(decisionRows.length)
    find('context-no-tasks').hidden = Boolean(taskRows.length)
    find('context-no-changes').hidden = Boolean(changeRows.length)
    if (replacing && !decisions.some(decision => decision.id === replacing && !decision.supersededBy)) {
      find('context-replace-target').textContent = 'Choose an active decision to replace.'
    }
  }

  function showNoteConflicts(keys, savedNotes = {}) {
    const list = find('context-note-conflict-list')
    list.replaceChildren(...keys.map(key => {
      const row = node('li')
      row.append(node('strong',NOTE_FIELDS[key]), node('p',savedNotes[key] || 'Empty'))
      return row
    }))
    find('context-note-conflicts').hidden = !keys.length
    find('context-note-conflicts').open = Boolean(keys.length)
  }

  function acceptContext(value, preserveNotes) {
    if (!Number.isSafeInteger(value?.version) || value.version < 0 ||
        !value.notes || !Array.isArray(value.decisions) || !Array.isArray(value.tasks) || !Array.isArray(value.recentChanges)) {
      throw Error('Couldn’t read project context. Your edits are kept.')
    }
    const localEdits = preserveNotes ? changedNotes() : []
    const conflicts = localEdits.filter(key => (value.notes[key] ?? '') !== (snapshot?.notes[key] ?? '') && value.notes[key] !== fields[key].value)
    if (conflicts.length || !localEdits.length) showNoteConflicts(conflicts,value.notes)
    for (const key of noteKeys) if (!localEdits.includes(key)) fields[key].value = value.notes[key] ?? ''
    snapshot = value
    needsRefresh = false
    find('context-body').hidden = false
    renderLists()
    onVersionChange()
  }

  async function changeContext(method = 'GET', data, success, onSaved) {
    if (!appId || pending || (method !== 'GET' && (isLocked() || !snapshot || needsRefresh))) return
    const controller = new AbortController()
    pending = controller
    syncControls()
    const refreshingConflict = method === 'GET' && needsRefresh
    showStatus(method === 'GET' ? 'Loading context…' : 'Saving context…')
    try {
      const response = await request('apps/' + encodeURIComponent(appId) + '/context', {
        method,
        signal:controller.signal,
        ...(data ? {body:JSON.stringify({version:snapshot.version,...data})} : {}),
      })
      if (pending !== controller) return
      acceptContext(response.context,method !== 'PUT')
      onSaved?.()
      const notices = [refreshingConflict ? 'Context refreshed. Review your edits before saving.' : success]
      if (decisionsLimitReached()) notices.push('Replace a decision to update the 20 active decisions.')
      if (tasksLimitReached()) notices.push('Complete or cancel a task to add another.')
      showStatus(notices.filter(Boolean).join(' '))
    } catch (error) {
      if (pending !== controller) return
      if (error.code === 'project_context_conflict') {
        needsRefresh = true
        showStatus('Context changed. Refresh to review the latest version. Your edits are kept.',true)
      } else if (error.code === 'project_context_limit') {
        showStatus('Context is full. Replace a decision or close a task. Your edits are kept.',true)
      } else {
        showStatus(error.message || 'Couldn’t update context. Try again.',true)
      }
    } finally {
      if (pending === controller) {
        pending = null
        syncControls()
      }
    }
  }

  function selectProject(id) {
    if (appId === id) {
      if (disclosure.open && !needsRefresh) void changeContext()
      return
    }
    pending?.abort()
    pending = null
    appId = id
    snapshot = null
    needsRefresh = false
    disclosure.open = false
    disclosure.hidden = !id
    find('context-body').hidden = true
    clearReplacement()
    for (const key of entryKeys) find(key).value = ''
    showNoteConflicts([])
    for (const field of Object.values(fields)) field.value = ''
    for (const list of ['decisions','tasks','changes']) find('context-' + list).replaceChildren()
    rowActions = []
    showStatus('')
    syncControls()
  }

  disclosure.addEventListener('toggle',() => {if (disclosure.open && !needsRefresh) void changeContext()})
  find('context-refresh').addEventListener('click',() => {if (!isLocked()) void changeContext()})
  for (const field of [...Object.values(fields),...entryKeys.map(find)]) {
    field.addEventListener('input',syncControls)
  }
  find('context-notes').addEventListener('submit',event => {
    event.preventDefault()
    if (find('context-save').disabled) return
    const notes = Object.fromEntries(noteKeys.map(key => [key,fields[key].value.trim()]))
    void changeContext('PUT',{notes},'Notes saved.')
  })
  find('context-decision-form').addEventListener('submit',event => {
    event.preventDefault()
    if (find('context-add-decision').disabled) return
    const input = find('context-decision')
    void changeContext('POST',{action:'decision',text:input.value.trim()},'Decision saved.',() => {input.value = ''})
  })
  find('context-replace-form').addEventListener('submit',event => {
    event.preventDefault()
    if (find('context-replace').disabled) return
    void changeContext('POST',{action:'supersede',id:replacing,text:find('context-replacement').value.trim()},'Decision replaced.',clearReplacement)
  })
  find('context-cancel-replace').addEventListener('click',() => {
    clearReplacement()
    find('context-decision').focus()
  })
  find('context-task-form').addEventListener('submit',event => {
    event.preventDefault()
    if (find('context-add-task').disabled) return
    const input = find('context-task')
    void changeContext('POST',{action:'task',text:input.value.trim()},'Task added.',() => {input.value = ''})
  })

  return {
    selectProject,
    syncControls,
    get version() {return snapshot?.version ?? null},
    get dirty() {return changedNotes().length > 0 || entryKeys.some(key => find(key).value.trim())},
  }
}
