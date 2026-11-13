const ranges = {projects:[150,280],conversation:[260,460]}
const clamp = (value,min,max) => Math.min(max,Math.max(min,value))

export function normalizePaneSizes(value = {}, defaults = {}) {
  return Object.fromEntries(Object.entries(ranges).map(([name,[min,max]]) => {
    const size = Number(value?.[name])
    return [name,clamp(Number.isFinite(size) ? size : (defaults[name] || (name === 'projects' ? 180 : 310)),min,max)]
  }))
}

export function resizedPaneSizes(sizes,name,value,width = Infinity) {
  const next = normalizePaneSizes(sizes), other = name === 'projects' ? 'conversation' : 'projects'
  if (!ranges[name]) return next
  const [min,max] = ranges[name]
  // Keep room for the canvas and both 10px separators on a desktop workspace.
  next[name] = clamp(value,min,Math.max(min,Math.min(max,width-next[other]-380)))
  return next
}

export function mountPaneLayout({root,owner,scope='applications',defaults={},storage,window:win=globalThis.window} = {}) {
  if (!root || typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(owner)) return {destroy(){}}
  const key = `compass:pane-layout:1:${owner}:${scope}`
  let sizes = normalizePaneSizes({},defaults), active = null
  try {storage ||= win.localStorage;const saved=JSON.parse(storage.getItem(key) || 'null');if(saved)sizes=normalizePaneSizes(saved,defaults)} catch {/* Storage is optional. */}
  const handles = [...root.querySelectorAll('[data-resize-pane]')]
  function paint(save=false) {
    for (const [name,size] of Object.entries(sizes)) root.style.setProperty(`--pane-${name}`,`${Math.round(size)}px`)
    for (const handle of handles) {const name=handle.dataset.resizePane;handle.setAttribute('aria-valuenow',String(Math.round(sizes[name])));handle.setAttribute('aria-valuetext',`${Math.round(sizes[name])} pixels`)}
    if(save)try{storage.setItem(key,JSON.stringify(sizes))}catch{/* Continue without saved layout. */}
  }
  const cleanups=[]
  for (const handle of handles) {
    const name=handle.dataset.resizePane
    if(!ranges[name])continue
    handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.tabIndex=0
    handle.setAttribute('aria-valuemin',String(ranges[name][0]));handle.setAttribute('aria-valuemax',String(ranges[name][1]))
    const width=()=>root.getBoundingClientRect().width
    const move=event=>{if(active?.handle!==handle || (event.pointerId!=null && event.pointerId!==active.pointerId))return;const delta=(event.clientX-active.x)*(name==='conversation'?-1:1);sizes=resizedPaneSizes(sizes,name,active.size+delta,width());paint()}
    const end=event=>{if(active?.handle!==handle || (event.pointerId!=null && event.pointerId!==active.pointerId))return;active=null;root.classList.remove('is-resizing');paint(true)}
    const start=event=>{if(event.button!==0)return;event.preventDefault();active={handle,pointerId:event.pointerId,x:event.clientX,size:sizes[name]};handle.setPointerCapture?.(event.pointerId);root.classList.add('is-resizing')}
    const keyboard=event=>{let value;if(event.key==='Home')value=ranges[name][0];else if(event.key==='End')value=ranges[name][1];else if(['ArrowLeft','ArrowRight'].includes(event.key))value=sizes[name]+(event.key==='ArrowRight'?1:-1)*(name==='conversation'?-1:1)*(event.shiftKey?40:10);else return;event.preventDefault();sizes=resizedPaneSizes(sizes,name,value,width());paint(true)}
    for(const [type,listener] of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end],['keydown',keyboard]]){handle.addEventListener(type,listener);cleanups.push(()=>handle.removeEventListener(type,listener))}
  }
  paint()
  return {destroy(){for(const cleanup of cleanups)cleanup();active=null;root.classList.remove('is-resizing')}}
}
