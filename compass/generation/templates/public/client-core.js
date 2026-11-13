// Engineer-authored UI. The manifest supplies bounded labels/data, never code.
function mountCrudApplication(manifest,request) {
  const $ = id => document.getElementById(id);
  document.title = manifest.title;
  document.body.dataset.mode = manifest.theme.mode;
  document.body.dataset.accent = manifest.theme.accent;
  document.body.dataset.font = manifest.theme.font;
  document.body.dataset.density = manifest.theme.density;
  $('app-title').textContent = manifest.title;
  $('app-description').textContent = manifest.description;
  $('entity-title').textContent = manifest.entity.plural;
  $('form-title').textContent = 'New ' + manifest.entity.singular.toLowerCase();
  for(const [slot,assetId]of Object.entries(manifest.assets||{})){
    const image=document.createElement('img');image.className='app-image app-image-'+slot;image.alt=slot==='logo'?manifest.title+' logo':'';image.decoding='async';
    if(slot==='logo')document.querySelector('.app-header').firstElementChild.prepend(image);else document.querySelector('.app-header').after(image);
    request('asset',{assetId}).then(result=>{
      const asset=result.asset;if(asset?.id!==assetId||!['image/png','image/jpeg'].includes(asset.mime)||typeof asset.dataUri!=='string'||asset.dataUri.length>720000||!new RegExp('^data:'+asset.mime+';base64,[A-Za-z0-9+/]+={0,2}$').test(asset.dataUri))throw Error('Invalid image');
      image.src=asset.dataUri;
    }).catch(()=>{image.remove()});
  }
  const inputs = new Map();
  let records = [], editing = null, busy = false;
  const node = (tag,text,className) => { const element = document.createElement(tag); if (text != null) element.textContent = String(text); if (className) element.className = className; return element; };
  const status = (text,error = false) => { $('app-status').textContent = text; $('app-status').dataset.error = String(error); };
  const lock = value => { busy = value; document.querySelectorAll('#record-form button,#record-form input,#record-form textarea,#record-form select,#records button,#refresh').forEach(element => {element.disabled = value;}); };
  for (const field of manifest.entity.fields) {
    const label = node('label',field.label), id = 'field-' + field.key;
    label.htmlFor = id;
    const input = node(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
    input.id = id; input.name = field.key; input.required = field.required;
    if (field.type === 'select') {
      input.append(node('option','Choose…'));
      input.firstChild.value = '';
      for (const option of field.options) { const item = node('option',option); item.value = option; input.append(item); }
    } else {
      input.type = field.type === 'date' || field.type === 'number' ? field.type : 'text';
      if (field.type === 'number') { input.step = 'any'; input.min = '-1000000000'; input.max = '1000000000'; }
      else input.maxLength = field.type === 'textarea' ? 2000 : 500;
    }
    inputs.set(field.key,input);
    const wrapper = node('div',null,'field'); wrapper.append(label,input); $('record-fields').append(wrapper);
  }
  function reset() {
    editing = null; $('record-form').reset(); $('cancel-edit').hidden = true;
    $('form-title').textContent = 'New ' + manifest.entity.singular.toLowerCase();
    $('save-record').textContent = 'Create ' + manifest.entity.singular.toLowerCase();
  }
  function render() {
    $('records').replaceChildren(); $('record-count').textContent = String(records.length);
    $('empty-state').hidden = records.length > 0;
    for (const record of records) {
      const card = node('article',null,'record');
      const fields = node('dl');
      for (const field of manifest.entity.fields) {
        const value = record.data?.[field.key];
        if (value === undefined || value === '') continue;
        const row = node('div'); row.append(node('dt',field.label),node('dd',value)); fields.append(row);
      }
      const actions = node('div',null,'record-actions');
      const edit = node('button','Edit'), remove = node('button','Delete'); edit.type = remove.type = 'button';
      edit.addEventListener('click',() => {
        if (busy) return; editing = record.id;
        for (const [key,input] of inputs) input.value = record.data?.[key] ?? '';
        $('form-title').textContent = 'Edit ' + manifest.entity.singular.toLowerCase();
        $('save-record').textContent = 'Save changes'; $('cancel-edit').hidden = false;
        inputs.values().next().value?.focus();
      });
      remove.addEventListener('click',async () => {
        if (busy) return;
        if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; remove.textContent = 'Confirm delete'; return; }
        lock(true); status('Deleting…');
        try { await request('delete',{id:record.id}); if (editing === record.id) reset(); await load(); }
        catch { status('Couldn’t delete. Your records are unchanged. Try again.',true); }
        finally { lock(false); }
      });
      actions.append(edit,remove); card.append(fields,actions); $('records').append(card);
    }
  }
  async function load() {
    const result = await request('list',{});
    if (!Array.isArray(result.records) || result.records.length > 200) throw Error('Invalid records');
    records = result.records; render(); status(records.length ? '' : 'No records yet. Add your first one.');
  }
  async function saveRecord() {
    if (busy || !$('record-form').reportValidity()) return;
    const data = {};
    for (const field of manifest.entity.fields) {
      const value = inputs.get(field.key).value;
      if (value !== '') data[field.key] = field.type === 'number' ? Number(value) : value;
    }
    lock(true); status('Saving…');
    try { await request(editing ? 'update' : 'create',{...(editing ? {id:editing} : {}),data}); reset(); await load(); }
    catch { status('Couldn’t save. Your entries are kept. Check the fields and try again.',true); }
    finally { lock(false); }
  }
  // Opaque allow-scripts frames deliberately have no allow-forms permission.
  // Use an explicit action, not the browser's native form submission algorithm.
  $('save-record').addEventListener('click',saveRecord);
  $('record-form').addEventListener('submit',event => {event.preventDefault();void saveRecord();});
  $('record-form').addEventListener('keydown',event => {
    if (event.key === 'Enter' && (event.target.tagName !== 'TEXTAREA' || event.ctrlKey || event.metaKey)) {
      event.preventDefault();void saveRecord();
    }
  });
  $('cancel-edit').addEventListener('click',reset);
  $('refresh').addEventListener('click',async () => {
    if (busy) return; lock(true); status('Loading…');
    try { await load(); } catch { status('Couldn’t load records. Try again.',true); } finally { lock(false); }
  });
  $('auth-panel').hidden = true; $('workspace').hidden = false; reset();
  lock(true); status('Loading…');
  load().catch(() => status('Couldn’t load records. Try Refresh.',true)).finally(() => lock(false));
}
