import { mountPlatformTour } from '../help/platform-tour.mjs'
import './public-navigation.css'

// Opening help is explicit. This layer never reads identity, project content or
// provider configuration, and it leaves all navigation to ordinary links.
export function mountPublicNavigation({document:doc=globalThis.document,pathname=globalThis.location?.pathname || '/',mountTour=mountPlatformTour}={}) {
  const accountWorkspace=pathname.replace(/\/$/,'')==='/workspace'
  const tours=[]
  for(const link of doc.querySelectorAll('[data-public-account]'))link.hidden=accountWorkspace
  for(const trigger of doc.querySelectorAll('[data-platform-tour-trigger]')) {
    trigger.hidden=true
    // The authenticated sidebar owns its own launch control.
    if(accountWorkspace)continue
    tours.push(mountTour({trigger}))
    trigger.hidden=false
  }
  return {destroy(){for(const tour of tours)tour.destroy()}}
}

if(typeof window!=='undefined' && typeof document!=='undefined')mountPublicNavigation()
