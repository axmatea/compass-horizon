import type { OrbState } from './types'

import { t } from './i18n'

export const ORB_LABEL: Record<OrbState, string> = t.orb

/**
 * Same glass orb as the website (src/cinematic: aura, surface, core, edge), plus live-state layers.
 * One persistent element; state only shifts glow color and layer opacity, so transitions morph.
 */
export default function Orb({ state, size = 184 }: { state: OrbState; size?: number }) {
  return (
    <div className="cv-orb" data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <div className="cv-orb-halo" />
      <div className="cv-orb-ripple" />
      <div className="cv-orb-ring" />
      <div className="cv-orb-ring cv-orb-ring-b" />
      <div className="cv-orb-core"><div className="cv-orb-surface" /><div className="cv-orb-inner" /><div className="cv-orb-edge" /></div>
      <div className="cv-orb-arc" />
      <div className="cv-orb-wave">{[0, 1, 2, 3, 4].map(i => <span key={i} style={{ animationDelay: `${i * -0.17}s` }} />)}</div>
    </div>
  )
}
