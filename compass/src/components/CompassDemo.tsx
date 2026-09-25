import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import Orb from '../voice/Orb'
import { isBusy, useCompassAgent } from '../voice/useCompassAgent'
import type { ActionView, PlanView } from '../voice/useCompassAgent'
import { FIELD_ORDER, formatValue, labelFor, time12 } from '../voice/format'
import { t } from '../voice/i18n'
import type { FieldValue, PatchOp, SearchResult } from '../voice/types'
import './compass-demo.css'

/** Prepared example lines are content (what a user might say), not UI labels. */
const LINE_START = 'Schedule dinner tomorrow at 7 and find an Italian restaurant.'
const LINE_CHANGE = 'Actually make it 8. Somewhere near Palo Alto.'

function Mic() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.4" /><path d="M6 11a6 6 0 0 0 12 0m-6 6v4m-3 0h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
}
function Arrow() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function Speaker({ on }: { on: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5 6 9H3v6l5 4V5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />{on ? <path d="M15 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}</svg>
}
function Restart() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

/** v1 patch op -> render class only: kept | active+updated | active+added | active+removed. */
function slotStatus(op: PatchOp | undefined, value: FieldValue, revision: boolean): string {
  if (op?.status === 'kept') return 'kept'
  if (op?.status === 'active') return op.change === 'updated' ? 'changed' : op.change === 'removed' ? 'removed' : revision ? 'added' : 'new'
  return value == null ? 'empty' : 'plain'
}

function Plan({ plan }: { plan: PlanView }) {
  const fields = FIELD_ORDER.filter(f => plan.intent[f] != null || plan.patch.some(op => op.field === f) || f === 'location')
  return <ul className="cv-slots">{fields.map(f => {
    const op = plan.patch.find(o => o.field === f)
    const status = slotStatus(op, plan.intent[f], plan.revision)
    const previous = op && op.status === 'active' && (op.change === 'updated' || op.change === 'removed') ? formatValue(f, op.from) : null
    const value = formatValue(f, plan.intent[f])
    return (
      <li key={f} className={'cv-slot is-' + status}>
        <span className="cv-slot-label">{labelFor(f)}</span>
        <span className="cv-slot-values" key={f + '-' + plan.version}>
          {previous && <span className="cv-old"><s dir="auto">{previous}</s><em>{t.superseded}</em></span>}
          <span className="cv-val" dir="auto">{value ?? (f === 'location' ? t.anywhere : t.notSet)}</span>
        </span>
        {t.tag[status] && status !== 'kept' && <span className="cv-tag" key={'t' + plan.version}>{t.tag[status]}</span>}
        {status === 'kept' && <span className="cv-kept" key={'k' + plan.version}>{t.tag.kept}</span>}
      </li>
    )
  })}</ul>
}

function argsLine(args: Record<string, unknown>) {
  return [args.cuisine, args.location ?? t.act.currentArea, args.date, time12((args.time as FieldValue) ?? null)].filter(Boolean).map(v => formatValue('x', v as FieldValue)).join(' · ')
}

function ActionRow({ a, current, holding }: { a: ActionView; current: boolean; holding: boolean }) {
  const phase = a.status === 'running' && holding ? 'paused' : a.status
  const search = a.result as SearchResult | undefined
  const status = phase === 'running' ? t.act.running : phase === 'paused' ? t.act.paused : phase === 'done' ? t.act.results(search?.results.length ?? 0) : phase === 'invalidated' ? t.act.invalidated((a.changedFields ?? []).map(f => labelFor(f).toLocaleLowerCase())) : t.act.stopped
  return (
    <div className={'cv-act is-' + phase + (current ? ' is-current' : '')}>
      <div className="cv-act-head"><span className="cv-act-args" dir="auto">{argsLine(a.args)}</span><span className="cv-act-status">{status}</span></div>
      <div className="cv-progress"><span key={a.run} /></div>
      {current && a.status === 'done' && search && <ul className="cv-results">{search.results.map((r, i) => <li key={a.id + i} style={{ animationDelay: i * 90 + 'ms' }}><b dir="auto">{r.name}</b><span dir="auto">{r.area ?? t.act.nearby} · {t.act.km(r.distanceKm)}</span><small>{time12(r.availableAt) ?? ''}</small></li>)}</ul>}
    </div>
  )
}

function Caption({ text, msPerWord }: { text: string; msPerWord: number }) {
  return <p className="cv-caption" dir="auto">{text.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} style={{ animationDelay: (i / 2) * msPerWord + 'ms' }}>{w}</span>))}</p>
}

export default function CompassDemo() {
  const a = useCompassAgent()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
  const planRef = useRef<HTMLDivElement>(null)
  const busy = isBusy(a.orb)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [a.turns.length])

  // Phones: keep the plan in view at the moments that matter (first plan, replanning).
  const planVersion = a.plan?.version ?? 0
  useEffect(() => {
    const el = planRef.current
    if (!el || !planVersion || window.innerWidth > 860) return
    const r = el.getBoundingClientRect()
    if (r.top < 60 || r.top > window.innerHeight * 0.45) el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [planVersion])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && isBusy(a.orb)) { e.preventDefault(); a.interrupt() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [a])

  function send(e?: FormEvent) {
    e?.preventDefault()
    if (!draft.trim()) return
    a.submit(draft); setDraft('')
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  const nextLine = a.hasPlan ? LINE_CHANGE : LINE_START
  const current = a.actions[a.actions.length - 1]
  const hint = a.orb === 'interrupted' ? t.hint.interrupted : a.orb === 'thinking' ? t.hint.thinking : a.orb === 'replanning' ? t.hint.replanning : a.orb === 'acting' ? t.hint.acting : a.hasPlan ? t.hint.idleWithPlan : t.hint.idle

  return (
    <div className="compass-demo cv">
      <div className={'cv-shell' + (a.hasPlan ? ' has-plan' : '')} data-state={a.orb}>
        <div className="cv-corner">
          {a.voiceSource !== 'boson' && a.voiceSource !== 'gradium' && <button type="button" className={'cv-icon-btn' + (a.voiceOn ? ' is-on' : '')} onClick={() => a.setVoiceOn(!a.voiceOn)} disabled={!a.voiceSupported} aria-pressed={a.voiceOn} title={t.voiceTitle}><Speaker on={a.voiceOn} /><span className="cv-sr">{a.voiceOn ? t.voiceOn : t.voiceOff}</span></button>}
          <button type="button" className="cv-icon-btn" onClick={a.reset} title={t.reset}><Restart /><span className="cv-sr">{t.reset}</span></button>
        </div>

        <div className="cv-stage">
          <div className="cv-voice">
            <div className="cv-orb-wrap">
              <Orb state={a.orb} />
              <p className="cv-orb-label" aria-live="polite">{t.orb[a.orb]}</p>
            </div>
            <div className="cv-live" aria-live="polite">
              {a.interim ? <p className="cv-interim" dir="auto">“{a.interim}”</p>
                : a.orb === 'speaking' && a.caption ? <Caption key={a.caption.key} text={a.caption.text} msPerWord={a.caption.msPerWord} />
                : <p className="cv-hint">{hint}</p>}
            </div>

            <div className="cv-dock">
              <div className="cv-controls">
                <button type="button" className={'cv-mic' + (a.micOn ? ' is-on' : '')} onClick={a.toggleMic} disabled={!a.micSupported} aria-pressed={a.micOn} title={a.micSupported ? t.micTitle : t.micUnsupported}>
                  <Mic /><span>{a.micOn ? t.listening : t.talk}</span>
                </button>
                {busy && <button type="button" className="cv-stop" onClick={() => a.interrupt()} title={t.interruptTitle}>{t.interrupt}</button>}
              </div>
              <div className="cv-script">
                {busy && a.hasPlan && <span className="cv-script-label">{t.interruptLabel}</span>}
                <button type="button" className={'cv-line' + (busy && a.hasPlan ? ' is-urgent' : '')} onClick={() => a.submit(nextLine)}>
                  <span>“{nextLine}”</span><Arrow />
                </button>
              </div>
              <form className="cv-composer" onSubmit={send}>
                <label htmlFor="cv-input" className="cv-sr">{t.typeLabel}</label>
                <input id="cv-input" dir="auto" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder={busy ? t.typeToInterrupt : t.typePlaceholder} maxLength={500} autoComplete="off" />
                <button type="submit" disabled={!draft.trim()} aria-label={t.send}><Arrow /></button>
              </form>
            </div>

            {a.turns.length > 0 && <ol className="cv-log" ref={logRef} aria-label={t.transcript}>
              {a.turns.slice(-2).map(x => <li key={x.id} className={'cv-turn is-' + x.who + (x.interrupted ? ' is-cut' : '')}><span>{x.who === 'user' ? t.you : t.compass}</span><p dir="auto">{x.text}{x.interrupted && <em> · {t.cutOff}</em>}</p></li>)}
            </ol>}
            <p className="cv-notice" role="status">{a.notice}</p>
          </div>

          <div className="cv-plan-col" ref={planRef} aria-hidden={!a.hasPlan}>
            {a.plan && <section className={'cv-plan' + (a.orb === 'replanning' ? ' is-replanning' : '')} aria-label={t.plan} aria-live="polite">
              <header><span className="cv-eyebrow">{t.plan}</span>{a.revisions > 0 && <span className="cv-rev" key={a.plan.version}>{t.updated}</span>}</header>
              <Plan plan={a.plan} />
            </section>}
            {current && <section className="cv-action" aria-label={t.action}>
              <header><span className="cv-eyebrow">{t.action}</span>{current.mock && <span className="cv-tool-name">{t.sampleData}</span>}</header>
              {a.actions.slice(-2).map(x => <ActionRow key={x.id} a={x} current={x === current} holding={a.holding} />)}
            </section>}
          </div>
        </div>
      </div>
      {a.servedBy && <p className="cd-disclosure"><span className="cd-disclosure-dot" />{a.servedBy === 'live' ? t.disclosure.live : t.disclosure.recorded}{a.voiceSource && <span className="cd-voice-src"> · {t.voiceSource[a.voiceSource]}</span>}</p>}
    </div>
  )
}
