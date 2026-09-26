'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import OfficeScene from '../scene/OfficeScene';
import '../tokens.css';
import './story.css';
import { Coordination, MemoryList, PlanTrace, SourceNote } from './StoryParts';
import { SLIDES, SOURCE_TEXT, STORY_PEOPLE } from './content';

export default function Presentation() {
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const notesToggle = useRef<HTMLButtonElement>(null);
  const previous = useRef(active);
  const selected = STORY_PEOPLE.find(person => person.id === selectedId);
  const slide = SLIDES[active];

  useEffect(() => {
    if (previous.current !== active) {
      main.current?.scrollTo({ top: 0, behavior: 'instant' });
      heading.current?.focus({ preventScroll: true });
      previous.current = active;
    }
  }, [active]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], .os-room')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        setActive(value => Math.max(0, Math.min(SLIDES.length - 1, value + (event.key === 'ArrowRight' ? 1 : -1))));
      } else if (event.key === 'Escape' && notes) {
        setNotes(false);
        notesToggle.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notes]);

  function title(children: ReactNode) { return <h1 ref={heading} tabIndex={-1} id="os-slide-title">{children}</h1>; }
  function room(layer: 'office' | 'memory') {
    return <div className="os-room"><OfficeScene people={STORY_PEOPLE} layer={layer} selectedId={selectedId} affectedIds={layer === 'memory' ? ['noa', 'leo'] : []} meetingIds={[]} onSelectPerson={setSelectedId} onSelectPlan={() => setActive(2)} onSelectMemory={() => setActive(4)} compact /></div>;
  }

  return <div className="office-universe office-story os-presentation" data-slide={active + 1}>
    <a className="os-skip" href="#os-presentation-controls">Skip to presentation controls</a>
    <header className="os-deck-header"><a href="/" aria-label="COMPASS home">COMPASS<span aria-hidden="true"> / </span></a><span className="os-deck-caption">The office is the interface.</span><span>NAYL &amp; Vincent</span></header>
    <main className="os-deck-main" ref={main} aria-labelledby="os-slide-title">
      <section key={active} className={`os-slide os-slide-${active + 1}`} aria-label={`Scene ${active + 1} of 6`}>
        <p className="of-kicker os-slide-kicker">0{active + 1} / {slide.label}</p>
        {active === 0 && <><div className="os-room-title">{title(<>Your own seat.<br /><em>Our shared plan.</em></>)}<p>Six people. One Harbor studio launch.<br />A room for independent work,<br />and the context that connects it.</p></div>{room('office')}<p className="os-seat-detail" aria-live="polite">{selected ? `${selected.name} / ${selected.role}: ${selected.objective}` : 'Select a seat to inspect its fictional context. The table opens the plan; the memory control opens the layer underneath.'}</p></>}
        {active === 1 && <div className="os-split"><div>{title(<>A small change.<br /><em>A shared consequence.</em></>)}<p className="os-body-copy">The supplier&apos;s date changes. The team needs to see what depends on it, not reconstruct the story six times.</p><p className="os-fine">Harbor studio / fictional supplier update / 2026</p></div><div className="os-letter"><span className="of-kicker">Original context / supplier delivery</span><blockquote>{SOURCE_TEXT}</blockquote><div className="os-date-change"><span>Wed<small>September 30</small></span><b aria-hidden="true">→</b><span>Thu<small>October 1</small></span></div><p className="os-fine">The source remains in history. No message has been imported or sent.</p></div></div>}
        {active === 2 && <>{title(<>Move the dependency.<br /><em>Keep the commitment.</em></>)}<p className="os-body-copy">Noa&apos;s supplier handover and Leo&apos;s installation and validation move in the proposal. The client preview does not.</p><PlanTrace /><div className="os-approval-line"><span className="os-attention">Maya&apos;s approval pending</span><p>Scripted local preview. Nothing is applied by this presentation.</p></div></>}
        {active === 3 && <>{title(<>Not another all-hands.<br /><em>The right two people.</em></>)}<p className="os-body-copy">Supplier handover meets installation readiness. A ten-minute check is proposed only for the people who share that dependency.</p><Coordination /><div className="os-meeting-note"><span className="of-kicker">A proposal, not a calendar event</span><p>No meeting booked. No notification sent. No live attendance or automatic coordination.</p></div></>}
        {active === 4 && <><div className="os-room-title">{title(<>Under every next step,<br /><em>keep the reason.</em></>)}<p>Focused context above.<br />Original source history underneath.</p></div><div className="os-memory-layout"><div>{room('memory')}<p className="os-fine" aria-live="polite">{selected ? `${selected.name}: ${selected.objective}` : 'A visual memory layer, not a connected AI runtime.'}</p></div><div><MemoryList /><SourceNote /></div></div></>}
        {active === 5 && <div className="os-outcome"><div>{title(<>Right context.<br /><em>Right person.</em></>)}<p className="os-outcome-line">Six seats. One plan.<br />Only the necessary coordination.</p></div><div className="os-outcome-summary"><p><span>Review the dependency</span><strong>Noa + Leo</strong></p><p><span>Keep the decision</span><strong>Maya</strong></p><p><span>Stay with their work</span><strong>Esra · Ravi · Sam</strong></p><p><span>Preserve the shared commitment</span><strong>Friday, October 2 · 15:00</strong></p><a href="/original" className="of-button of-button-primary">Explore the local office <span aria-hidden="true">↗</span></a><p className="os-fine">An intended outcome, not an approved or executed change.</p></div></div>}
        <p className="os-demo-label">Fictional local demo · No AI calls · No live presence · No automatic coordination or compression claims</p>
      </section>
    </main>
    {notes && <aside id="os-speaker-notes" className="os-speaker-notes" aria-label="Speaker notes"><div><span className="of-kicker">{slide.time} / {slide.label}</span><button className="of-text-button" type="button" onClick={() => { setNotes(false); notesToggle.current?.focus(); }}>Close notes</button></div><p>{slide.speech}</p><small><strong>Stage action:</strong> {slide.action}</small></aside>}
    <footer id="os-presentation-controls" className="os-deck-footer" tabIndex={-1}><div className="os-deck-progress" role="progressbar" aria-label="Presentation progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={active + 1} aria-valuetext={`Scene ${active + 1} of 6: ${slide.label}`}><span style={{ width: `${((active + 1) / 6) * 100}%` }} /></div><button className="of-text-button os-notes-toggle" type="button" ref={notesToggle} aria-expanded={notes} aria-controls="os-speaker-notes" onClick={() => setNotes(value => !value)}>Speaker notes</button><span className="os-page" aria-live="polite" aria-atomic="true">0{active + 1} / 06</span><nav aria-label="Presentation scenes"><button className="of-button" type="button" disabled={active === 0} onClick={() => setActive(value => Math.max(0, value - 1))}>Previous</button><button className="of-button of-button-primary" type="button" disabled={active === 5} onClick={() => setActive(value => Math.min(5, value + 1))}>Next <span aria-hidden="true">→</span></button></nav></footer>
  </div>;
}
