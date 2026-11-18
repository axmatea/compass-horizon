// Load the reference planner only after a deliberate launch. The planner owns
// subsequent trigger clicks; mounting or opening never starts generation.
export function createReferenceLauncher({trigger,defaultTarget='website',beforeContinue,beforeOpen,onError=()=>{},load=()=>import('./start.mjs')}={}) {
  if(!trigger?.addEventListener)throw TypeError('A reference launch control is required')
  let planner=null,pending=null,disposed=false
  const launch=event=>{
    event?.preventDefault?.()
    if(disposed)return
    beforeOpen?.()
    if(planner || pending)return
    trigger.setAttribute('aria-busy','true')
    pending=(async()=>{
      try {
        const module=await load()
        if(disposed || trigger.isConnected===false)return
        planner=module.mountReferenceStart({trigger,defaultTarget,beforeContinue})
        onError('')
        await planner.open()
      } catch {
        planner?.destroy();planner=null
        if(!disposed)onError('The planner couldn’t open. Try again.')
      } finally {
        pending=null;trigger.removeAttribute('aria-busy')
      }
    })()
    return pending
  }
  trigger.addEventListener('click',launch)
  return {destroy(){disposed=true;trigger.removeEventListener('click',launch);planner?.destroy()}}
}
