import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import Orb from '../voice/Orb'
import { isBusy, useCompassAgent } from '../voice/useCompassAgent'
import type { ActionView, PlanView, RenderView } from '../voice/useCompassAgent'
import { t } from '../voice/i18n'
import type { CopyResult, PatchOp } from '../voice/types'
import '../components/compass-demo.css'
import './site-demo.css'

/** Prepared lines are content (what a presenter might say), not UI labels. */
const LINES = [
  'Build me a premium website for an AI company. Make it minimal, dark and cinematic.',
  'Actually, make it warmer. Make the hero more ambitious, and add a pricing section.',
  'Now make it lighter, and add a testimonials section.',
]
const FIELDS: { key: string; label: string }[] = [
  { key: 'business', label: 'Name' }, { key: 'kind', label: 'What' }, { key: 'audience', label: 'For' }, { key: 'tone', label: 'Tone' },
  { key: 'theme', label: 'Theme' }, { key: 'accent', label: 'Accent' }, { key: 'font', label: 'Type' }, { key: 'hero', label: 'Hero' },
  { key: 'headline', label: 'Headline' }, { key: 'cta', label: 'Button' }, { key: 'sections', label: 'Sections' },
]
const SECTION_NAMES: Record<string, string> = { hero: 'Hero', features: 'Features', products: 'Products', gallery: 'Gallery', testimonials: 'Testimonials', pricing: 'Pricing', faq: 'FAQ', contact: 'Contact', signup: 'Signup' }
const S = { disclosure: 'Proof of COMPASS: change your intent while the agent is acting · The page is only the visible example · Rendered for this session, nothing is published', empty: 'Say what you want to build.', emptyHint: 'Then change your mind mid-action. COMPASS keeps what holds and adapts the next step.', writing: 'Writing', placeholder: 'placeholder copy', preview: 'Preview', open: 'Open page', brief: 'The brief', build: 'Build', updated: 'Updated' }

function Mic() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.4" /><path d="M6 11a6 6 0 0 0 12 0m-6 6v4m-3 0h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg> }
function Arrow() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function Restart() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg> }

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)
const show = (key: string, v: unknown): string => (Array.isArray(v) ? v.map(x => SECTION_NAMES[String(x)] ?? String(x)).join(' · ') : key === 'business' || key === 'headline' || key === 'cta' ? String(v) : cap(String(v)))

function status(op: PatchOp | undefined, revision: boolean): string {
  if (op?.status === 'kept') return 'kept'
  if (op?.status === 'active') return op.change === 'updated' ? 'changed' : op.change === 'removed' ? 'removed' : revision ? 'added' : 'new'
  return 'plain'
}

function Brief({ plan }: { plan: PlanView }) {
  const rows = FIELDS.filter(f => plan.intent[f.key] != null && !(Array.isArray(plan.intent[f.key]) && !(plan.intent[f.key] as string[]).length))
  return (
    <ul className="sd-brief" aria-label={S.brief}>
      {rows.map(f => {
        const op = plan.patch.find(o => o.field === f.key)
        const st = status(op, plan.revision)
        const prev = op && op.status === 'active' && op.change === 'updated' && f.key !== 'sections' ? show(f.key, op.from) : null
        return (
          <li key={f.key} className={'sd-row is-' + st}>
            <span className="sd-k">{f.label}</span>
            <span className="sd-v" key={f.key + plan.version}>
              {prev && <s>{prev}</s>}
              {f.key === 'sections' && Array.isArray(plan.intent.sections)
                ? <span className="sd-chips">{(plan.intent.sections as string[]).map(s => <em key={s} className={op?.added?.includes(s) ? 'is-added' : ''}>{SECTION_NAMES[s] ?? s}</em>)}{op?.removed?.map(s => <em key={'r' + s} className="is-removed">{SECTION_NAMES[s] ?? s}</em>)}</span>
                : <b dir="auto">{show(f.key, plan.intent[f.key])}</b>}
            </span>
            {st !== 'plain' && st !== 'new' && <span className={'sd-tag is-' + st} key={'t' + plan.version}>{t.tag[st] ?? st}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function Build({ actions, render, thinking, holding }: { actions: ActionView[]; render: RenderView | null; thinking: boolean; holding: boolean }) {
  const copy = actions.filter(a => a.tool === 'write_copy').slice(-2)
  return (
    <ol className="sd-build" aria-label={S.build}>
      <li className={thinking ? 'is-run' : 'is-done'}>Understanding</li>
      {copy.map(a => {
        const r = a.result as CopyResult | undefined
        const names = (xs?: string[]) => (xs ?? []).map(s => SECTION_NAMES[s] ?? s).join(', ')
        const phase = a.status === 'running' && holding ? 'paused' : a.status
        const label = phase === 'running' ? `${S.writing} ${names(a.args.sections as string[] | undefined) ? '' : ''}copy…` : phase === 'paused' ? 'Writing copy · paused, listening' : phase === 'done' ? (r?.fallback ? 'Placeholder copy (writer unavailable)' : `Words in: ${names(r?.wrote) || 'nothing new'}${r?.reused?.length ? ` · kept ${names(r.reused)}` : ''}`) : phase === 'invalidated' ? `Rewriting: ${(a.changedFields ?? []).join(', ')} changed` : 'Writer failed'
        return <li key={a.id} className={'is-' + phase}>{label}</li>
      })}
      {render && <li className={render.pending.length ? 'is-run' : 'is-done'} key={render.key}>{render.pending.length ? `Rendered v${render.version} · ${render.pending.map(s => SECTION_NAMES[s] ?? s).join(', ')} pending` : `Rendered v${render.version}`}</li>}
    </ol>
  )
}

function Caption({ text, msPerWord }: { text: string; msPerWord: number }) {
  return <p className="cv-caption" dir="auto">{text.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} style={{ animationDelay: (i / 2) * msPerWord + 'ms' }}>{w}</span>))}</p>
}

export default function SiteDemo() {
  const a = useCompassAgent({ domain: 'site' })
  const [draft, setDraft] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const busy = isBusy(a.orb)
  const userTurns = a.turns.filter(x => x.who === 'user').length
  const nextLine = LINES[Math.min(userTurns, LINES.length - 1)]
  const thinking = a.orb === 'thinking'

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && isBusy(a.orb)) { e.preventDefault(); a.interrupt() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [a])

  // Bring a newly added section into view once the page has loaded (same-origin srcdoc, no scripts inside).
  const renderKey = a.render?.key
  useEffect(() => {
    const el = frame.current
    if (!el || !a.render) return
    const target = a.render.highlight.find(s => s !== 'hero')
    if (!target || a.render.stage === 'resume') return
    const onLoad = () => {
      try {
        const doc = el.contentDocument
        const node = doc?.getElementById(target)
        node?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
      } catch { /* opaque origin: skip */ }
    }
    el.addEventListener('load', onLoad, { once: true })
    return () => el.removeEventListener('load', onLoad)
  }, [renderKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function send(e?: FormEvent) { e?.preventDefault(); if (!draft.trim()) return; a.submit(draft); setDraft('') }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }

  const hint = a.orb === 'interrupted' ? t.hint.interrupted : thinking ? t.hint.thinking : a.orb === 'replanning' ? 'Updating only what changed.' : a.orb === 'acting' ? 'Working on it. Interrupt any time.' : a.hasPlan ? 'Change anything. It keeps what you liked.' : S.empty
  const pageUrl = a.sessionId ? `/api/site/session/${encodeURIComponent(a.sessionId)}/page` : null
  const theme = a.plan?.intent.theme === 'dark' ? 'dark' : 'light'

  return (
    <div className="compass-demo cv sd">
      <div className={'cv-shell sd-shell' + (a.hasPlan ? ' has-plan' : '')} data-state={a.orb}>
        <aside className="sd-side">
          <div className="sd-top">
            <div className="cv-orb-wrap"><Orb state={a.orb} size={118} /><p className="cv-orb-label" aria-live="polite">{t.orb[a.orb]}</p></div>
            <div className="sd-corner">
              {a.voiceSource !== 'boson' && a.voiceSource !== 'gradium' && <button type="button" className={'cv-icon-btn' + (a.voiceOn ? ' is-on' : '')} onClick={() => a.setVoiceOn(!a.voiceOn)} disabled={!a.voiceSupported} aria-pressed={a.voiceOn} title={t.voiceTitle}><span className="cv-sr">{a.voiceOn ? t.voiceOn : t.voiceOff}</span>{a.voiceOn ? '🔊' : '🔇'}</button>}
              <button type="button" className="cv-icon-btn" onClick={a.reset} title={t.reset}><Restart /><span className="cv-sr">{t.reset}</span></button>
            </div>
          </div>
          <div className="cv-live sd-live" aria-live="polite">
            {a.interim ? <p className="cv-interim" dir="auto">“{a.interim}”</p>
              : a.orb === 'speaking' && a.caption ? <Caption key={a.caption.key} text={a.caption.text} msPerWord={a.caption.msPerWord} />
              : <p className="cv-hint">{hint}</p>}
          </div>
          <div className="cv-controls sd-controls">
            <button type="button" className={'cv-mic' + (a.micOn ? ' is-on' : '')} onClick={a.toggleMic} disabled={!a.micSupported} aria-pressed={a.micOn} title={a.micSupported ? t.micTitle : t.micUnsupported}><Mic /><span>{a.micOn ? t.listening : t.talk}</span></button>
            {busy && <button type="button" className="cv-stop" onClick={() => a.interrupt()} title={t.interruptTitle}>{t.interrupt}</button>}
          </div>
          <div className="sd-script">
            <span className="cv-script-label">{busy && a.hasPlan ? t.interruptLabel : userTurns ? t.changeLabel : t.tryLabel}</span>
            <button type="button" className={'cv-line' + (busy && a.hasPlan ? ' is-urgent' : '')} onClick={() => a.submit(nextLine)}><span>“{nextLine}”</span><Arrow /></button>
          </div>
          <form className="cv-composer sd-composer" onSubmit={send}>
            <label htmlFor="sd-input" className="cv-sr">{t.typeLabel}</label>
            <input id="sd-input" dir="auto" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder={busy ? t.typeToInterrupt : t.typePlaceholder} maxLength={500} autoComplete="off" />
            <button type="submit" disabled={!draft.trim()} aria-label={t.send}><Arrow /></button>
          </form>
          {a.plan && <section className={'sd-card' + (a.orb === 'replanning' ? ' is-replanning' : '')} aria-live="polite">
            <header><span className="cv-eyebrow">{S.brief}</span>{a.revisions > 0 && <span className="cv-rev" key={a.plan.version}>{S.updated} · v{a.plan.version}</span>}</header>
            <Brief plan={a.plan} />
          </section>}
          {(a.actions.length > 0 || a.render) && <section className="sd-card sd-build-card"><header><span className="cv-eyebrow">{S.build}</span></header><Build actions={a.actions} render={a.render} thinking={thinking} holding={a.holding} /></section>}
          {a.turns.length > 0 && <ol className="cv-log sd-log" aria-label={t.transcript}>
            {a.turns.slice(-3).map(x => <li key={x.id} className={'cv-turn is-' + x.who + (x.interrupted ? ' is-cut' : '')}><span>{x.who === 'user' ? t.you : t.compass}</span><p dir="auto">{x.text}{x.interrupted && <em> · {t.cutOff}</em>}</p></li>)}
          </ol>}
          <p className="cv-notice sd-notice" role="status">{a.notice}</p>
        </aside>

        <main className="sd-stage" data-theme={theme}>
          <div className="sd-chrome">
            <span className="sd-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="sd-url">{a.plan?.intent.business ? String(a.plan.intent.business).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'untitled'} · {S.preview}{a.render ? ` · v${a.render.version}` : ''}</span>
            <span className="sd-pills">
              {a.render?.pending.length ? <span className="sd-pill is-run">{S.writing} {a.render.pending.map(s => SECTION_NAMES[s] ?? s).join(', ')}…</span> : null}
              {a.render?.placeholder && <span className="sd-pill is-warn">{S.placeholder}</span>}
              {pageUrl && a.render && <a className="sd-pill" href={pageUrl} target="_blank" rel="noreferrer">{S.open} ↗</a>}
            </span>
          </div>
          {a.render
            ? <iframe ref={frame} className="sd-frame" title="Generated page preview" sandbox="allow-same-origin" srcDoc={a.render.html} />
            : <div className="sd-empty"><div className="sd-wire" aria-hidden="true"><b /><b /><b /><b /><b /></div><p>{S.empty}</p><small>{S.emptyHint}</small></div>}
        </main>
      </div>
      <p className="cd-disclosure"><span className="cd-disclosure-dot" />{S.disclosure}{a.voiceSource && <span className="cd-voice-src"> · {t.voiceSource[a.voiceSource]}</span>}</p>
    </div>
  )
}
