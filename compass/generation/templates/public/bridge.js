// Runs only in an opaque iframe. No token, cookie, fetch or network access.
(() => {
  const manifest = JSON.parse(document.body.dataset.manifest);
  const pending = new Map();
  let serial = 0;
  addEventListener('message',event => {
    if (event.source !== parent || !event.data || event.data.type !== 'compass-app-response' || typeof event.data.requestId !== 'string') return;
    const item = pending.get(event.data.requestId);
    if (!item) return;
    let size;
    try { size = JSON.stringify(event.data).length; } catch { return; }
    if (size > 4 * 1024 * 1024) return;
    pending.delete(event.data.requestId); clearTimeout(item.timer);
    if (event.data.ok === true) item.resolve(event.data);
    else item.reject(Error('Request failed'));
  });
  const request = (action,values) => new Promise((resolve,reject) => {
    if (!['list','create','update','delete'].includes(action) || pending.size >= 8) { reject(Error('Unavailable')); return; }
    const requestId = 'app_' + (++serial) + '_' + crypto.randomUUID();
    const message = {type:'compass-app-request',requestId,action,...values};
    if (JSON.stringify(message).length > 20000) { reject(Error('Request too large')); return; }
    const timer = setTimeout(() => {pending.delete(requestId);reject(Error('Timed out'));},15000);
    pending.set(requestId,{resolve,reject,timer});
    parent.postMessage(message,'*');
  });
  mountCrudApplication(manifest,request);
})();
