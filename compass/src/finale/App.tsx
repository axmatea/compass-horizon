import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './finale.css';

const scenes = [
  { name: 'One shared direction', time: '0:00 - 0:18', action: 'Hold the opening. Introduce both founders.', notes: "We are NAYL and Vincent, building COMPASS. Small teams don't need another place to have an isolated conversation. They need one shared direction: the context behind the work, the person responsible, and the decision that moves it forward." },
  { name: 'The context gap', time: '0:18 - 0:38', action: 'Point to the Sunday studio fragments, then the unanswered question.', notes: "Sunday studio is planning a neighborhood gathering. Leo's venue conversation says the courtyard is available, but booking must wait for Maya's accessibility check. The task alone doesn't tell that whole story. The challenge is keeping the original context beside the work, so the team knows what must happen before anyone commits." },
  { name: 'The human loop', time: '0:38 - 1:03', action: 'Select Update, Inspect source, Owner approval, then Shared plan. This is a local illustration, not a save.', notes: "Start with Leo's update. Open the original Venue conversation: do not confirm the booking until the accessibility check is complete. Maya reviews the proposed next step, then the plan includes her access check. This is a scripted, source-linked proposal concept. The slide makes no persistent change, no booking, and no AI call." },
  { name: 'A real foundation', time: '1:03 - 1:26', action: 'Read the local versus production boundary. Do not attempt a live sign-in.', notes: "The human workspace retains original context beside persistent tasks, with audit history and owner and member permissions. Per-task source links are not implemented. PostgreSQL and authentication were tested locally, including two signed-in sessions and a process restart. That is local evidence, not deployed authentication. Production database and authentication are not yet configured." },
  { name: 'The long horizon', time: '1:26 - 1:55', action: 'Use Horizon Back or the scrubber once. Keep disclosure visible. Do not start voice or paid models.', notes: "Horizon makes the longer view visible: events accumulate, late evidence arrives, and a belief can be revised. You can inspect the browser simulation here, or in two dimensions, three dimensions, and phone view. Its A/B percentages and eighteen-thousand-dollar figure are illustrative, not actual revenue or measured results. It is not a connected agent learning from this team's work." },
  { name: 'The integration boundary', time: '1:55 - 2:17', action: 'Point to the broken connection and the NOT CONNECTED label.', notes: "These pieces belong in one product story, but they are not one connected AI system today. The human workspace is the foundation. Horizon is a simulation of a possible long-horizon experience. The team AI runtime is not connected. Our separate existing voice demo shows a voice interaction, not proof of team AI integration." },
  { name: 'What we are designing for', time: '2:17 - 2:40', action: 'Let the three design goals land. Do not frame them as proven market advantages.', notes: "Our design goal is a workspace where evidence stays beside decisions, approval remains with people, and context survives beyond a single conversation. That is the differentiation we want to earn, not a claim that we have proven something nobody else can do. The next gate is production collaboration, then a verified, permissioned AI integration." },
  { name: 'Inspect the work', time: '2:40 - 3:00', action: 'Show the links. Open only the requested demo; voice may call a provider when activated.', notes: "You can inspect the synthetic workspace demo, explore Horizon, or open the separate voice demo. The private workspace entry is also listed, with its production gate clearly marked. COMPASS is our direction: a shared plan with an inspectable reason behind it. Built by NAYL and Vincent." },
] as const;

const loop = [
  { label: 'Update', title: 'A constraint enters the room.', meta: 'Sunday studio / update from Leo', body: 'The courtyard is available October 18. Booking is paused pending Maya\'s accessibility check.', detail: 'Fictional public demo. Original context retained beside tasks.' },
  { label: 'Inspect source', title: 'Read the reason, not just the summary.', meta: 'Original / Venue conversation / Leo', body: '“Do not confirm the booking until that check is complete.”', detail: 'The source asks Maya to review the step-free entrance and accessible restroom.' },
  { label: 'Owner approval', title: 'The decision stays human.', meta: 'Scripted proposal / Maya reviews', body: 'Proposed next step: ask Maya to verify accessibility before anyone confirms the venue.', detail: 'Source-linked proposal concept only. No implemented per-task source links.' },
  { label: 'Shared plan', title: 'One direction. Clear responsibility.', meta: 'Illustrated task / assigned to Maya', body: 'Verify step-free access before booking. The venue remains unconfirmed until the check is complete.', detail: 'Illustrated approval. This slide saves no task and makes no booking.' },
] as const;

function CompassDrawing() {
  return <div className="finale-compass" aria-hidden="true">
    <svg viewBox="0 0 600 600" fill="none">
      <defs><radialGradient id="finale-glow"><stop stopColor="#d4b876" stopOpacity=".12" /><stop offset="1" stopColor="#d4b876" stopOpacity="0" /></radialGradient></defs>
      <circle cx="300" cy="300" r="298" fill="url(#finale-glow)" />
      <g stroke="currentColor"><circle cx="300" cy="300" r="227" opacity=".22" /><circle cx="300" cy="300" r="180" opacity=".12" /><circle cx="300" cy="300" r="93" opacity=".24" />
        <path d="M300 38V80M300 520v42M38 300h42M520 300h42M140 140l17 17M443 443l17 17M140 460l17-17M443 157l17-17" opacity=".5" />
        <path d="M80 300h440M300 80v440" strokeDasharray="2 8" opacity=".16" />
        <path d="m300 108 30 191-30 193-30-193Z" transform="rotate(32 300 300)" opacity=".8" />
      </g>
      <path d="m300 108 30 191-30 1Z" transform="rotate(32 300 300)" fill="currentColor" />
      <circle cx="300" cy="300" r="5" fill="#efe7d6" />
    </svg>
    <span className="finale-north">A shared direction</span>
    <span className="finale-coordinate">CONTEXT / PEOPLE / TIME</span>
  </div>;
}

function HorizonLinks() {
  return <nav className="finale-view-links" aria-label="Horizon demo views">
    <a href="/horizon" target="_blank" rel="noreferrer">2D <span className="finale-sr">(new tab)</span><span aria-hidden="true">↗</span></a>
    <a href="/horizon?view=3d" target="_blank" rel="noreferrer">3D <span className="finale-sr">(new tab)</span><span aria-hidden="true">↗</span></a>
    <a href="/horizon?view=phone" target="_blank" rel="noreferrer">Phone <span className="finale-sr">(new tab)</span><span aria-hidden="true">↗</span></a>
  </nav>;
}

export default function App() {
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState(false);
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const notesButton = useRef<HTMLButtonElement>(null);
  const previousScene = useRef(active);
  const scene = scenes[active];

  useEffect(() => {
    if (previousScene.current !== active) {
      scroller.current?.scrollTo({ top: 0, behavior: 'instant' });
      heading.current?.focus({ preventScroll: true });
      previousScene.current = active;
    }
  }, [active]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setActive(value => Math.max(0, Math.min(scenes.length - 1, value + (event.key === 'ArrowRight' ? 1 : -1))));
      } else if (event.key === 'Escape' && notes) {
        setNotes(false);
        notesButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notes]);

  const title = (children: ReactNode) => <h1 id="finale-title" ref={heading} tabIndex={-1}>{children}</h1>;

  return <div className="finale" data-scene={active + 1}>
    <a className="finale-skip" href="#finale-controls">Skip to presentation controls</a>
    <header className="finale-header">
      <span className="finale-wordmark">COMPASS<span className="finale-mark" aria-hidden="true"> / </span></span>
      <span className="finale-header-note">A human workspace. A longer view.</span>
      <span className="finale-founders">NAYL &amp; Vincent</span>
    </header>

    <main className="finale-main" ref={scroller} aria-labelledby="finale-title">
      <section className={`finale-scene finale-scene-${active + 1}`} key={active} aria-label={`Scene ${active + 1} of ${scenes.length}`}>
        <div className="finale-eyebrow"><span>{String(active + 1).padStart(2, '0')}</span> / {scene.name}</div>

        {active === 0 && <div className="finale-hero-layout">
          <div className="finale-hero-copy">{title(<>Many moving parts.<br />One <em>shared</em><br />direction.</>)}
            <p className="finale-lede">Your team's context, tasks and decisions.<br />Together, with a reason behind every next step.</p>
            <div className="finale-signature"><span className="finale-fine-line" />Built by NAYL &amp; Vincent</div>
          </div><CompassDrawing />
        </div>}

        {active === 1 && <>
          {title(<>The team is small.<br />The context <em>is scattered.</em></>)}
          <div className="finale-fragments">
            <article><span className="finale-tag">01 / Leo's update</span><p>“The courtyard<br />is available.”</p><small>The opportunity is here.</small></article>
            <article><span className="finale-tag">02 / Original context</span><p>Venue conversation<br /><em>Check access first.</em></p><small>Booking waits for Maya's check.</small></article>
            <article><span className="finale-tag">03 / A task</span><p>Find a space<br /><span className="finale-muted">that feels like home.</span></p><small>The task alone isn't the whole story.</small></article>
          </div>
          <div className="finale-bottom-thought"><span>Sunday studio / fictional demo</span><p>Who knows the constraint, <em>and who decides?</em></p></div>
        </>}

        {active === 2 && <>
          {title(<>From an update<br />to a plan <em>people approve.</em></>)}
          <div className="finale-workflow">
            <div className="finale-steps" role="group" aria-label="Explore the illustrated human workflow">
              {loop.map((item, index) => <button key={item.label} type="button" aria-pressed={step === index} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}<span aria-hidden="true">↗</span></button>)}
            </div>
            <article className="finale-source-card" aria-live="polite" aria-atomic="true">
              <span className="finale-tag">{loop[step].meta}</span><h2>{loop[step].title}</h2><p>{loop[step].body}</p><div className="finale-source-foot">{loop[step].detail}</div>
            </article>
          </div>
          <p className="finale-caption">Interactive story illustration only. No AI call, approval, or persistent write occurs here.</p>
        </>}

        {active === 3 && <>
          {title(<>Not just a conversation.<br />A <em>working foundation.</em></>)}
          <div className="finale-foundation">
            <div className="finale-records" aria-label="Implemented workspace data model, schematic">
              <div><span className="finale-tag">Retained material</span><strong>Original context</strong><small>Author / original text / retained beside tasks</small></div>
              <div><span className="finale-tag">Shared task</span><strong>Persistent state</strong><small>Assignee / status / version</small></div>
              <div><span className="finale-tag">Access &amp; history</span><strong>Accountable changes</strong><small>Permissions / invitations / audit records</small></div>
            </div>
            <div className="finale-evidence"><span className="finale-status">LOCAL VERIFICATION</span><h2>Real PostgreSQL.<br />Real auth tests.</h2><p>Two signed-in sessions, shared edits, conflict handling and process-restart persistence tested locally. Original context sits beside tasks; per-task source links are not implemented.</p><div className="finale-boundary"><strong>Production is not configured.</strong><p>Database and authentication still require production setup and verification. Local tests are not deployed-auth evidence.</p></div></div>
          </div>
        </>}

        {active === 4 && <>
          <div className="finale-horizon-heading">{title(<>Context has <em>a horizon.</em></>)}<HorizonLinks /></div>
          <p className="finale-horizon-intro">Events accumulate. Late evidence arrives. A belief can change.</p>
          <div className="finale-disclosure" id="finale-horizon-disclosure"><strong>Browser simulation.</strong> A/B percentages and $18k are illustrative, not actual revenue or measured results. No connected team AI.</div>
          <div className="finale-embed"><iframe src="/horizon?embed=1" title="Interactive Horizon browser simulation, illustrative data only" aria-describedby="finale-horizon-disclosure" /></div>
          <p className="finale-caption">Use the simulation's controls to inspect time. Arrow keys inside the frame control Horizon; use Previous / Next below to change scenes. If it does not load, use the 2D link.</p>
        </>}

        {active === 5 && <>
          {title(<>One product direction.<br /><em>Clear boundaries today.</em></>)}
          <div className="finale-system-map">
            <article><span className="finale-tag">01 / The foundation</span><h2>Human<br />workspace</h2><p>Original context beside tasks.<br />Persistent state and audit history.<br />People own the decision.</p><span className="finale-status">LOCALLY TESTED</span></article>
            <div className="finale-unconnected" aria-label="No runtime connection"><span /><b>NOT<br />CONNECTED</b><span /></div>
            <article><span className="finale-tag">02 / The next integration</span><h2>Team<br /><em>AI runtime</em></h2><p>Not connected to the workspace.<br />No live team learning or<br />autonomous execution claimed.</p><span className="finale-status finale-status-outline">NOT CONNECTED</span></article>
          </div>
          <div className="finale-separate"><p><strong>Horizon</strong>Browser-only simulation.</p><p><strong>Existing voice demo</strong>Separate experience at /voice-demo. Not proof of team AI integration.</p></div>
        </>}

        {active === 6 && <>
          {title(<>The difference<br />we intend <em>to earn.</em></>)}
          <p className="finale-lede">A design goal, not a proven novelty claim.</p>
          <div className="finale-principles">
            <article><span>01</span><h2>Evidence<br />beside decisions.</h2><p>Inspect the source behind the next step, without starting the conversation over.</p></article>
            <article><span>02</span><h2>People<br />keep authority.</h2><p>A workspace built around responsibility and owner approval, not invisible execution.</p></article>
            <article><span>03</span><h2>Context<br />beyond the chat.</h2><p>A longer view of how a plan changes, and the evidence that changed it.</p></article>
          </div>
          <div className="finale-next-gate"><span className="finale-tag">Next gate</span><p>Production collaboration. Then verified, permissioned AI integration.</p></div>
        </>}

        {active === 7 && <>
          <div className="finale-close-layout"><div>{title(<>A shared plan.<br /><em>An inspectable reason.</em></>)}<p className="finale-lede">Explore what exists.<br />See exactly where the next chapter begins.</p><div className="finale-signature">COMPASS / NAYL &amp; Vincent</div></div>
            <nav className="finale-demo-links" aria-label="Demo and workspace links">
              <a href="/demo/workspace" target="_blank" rel="noreferrer"><span className="finale-tag">01 / Public workspace demo</span><strong>/demo/workspace <span aria-hidden="true">↗</span></strong><small>Synthetic data. Local demo changes reset.<span className="finale-sr"> Opens in a new tab.</span></small></a>
              <a href="/horizon" target="_blank" rel="noreferrer"><span className="finale-tag">02 / Horizon</span><strong>/horizon <span aria-hidden="true">↗</span></strong><small>Browser simulation. Illustrative results only.<span className="finale-sr"> Opens in a new tab.</span></small></a>
              <a href="/voice-demo" target="_blank" rel="noreferrer"><span className="finale-tag">03 / Separate voice demo</span><strong>/voice-demo <span aria-hidden="true">↗</span></strong><small>Not team AI integration. Activation may use a provider.<span className="finale-sr"> Opens in a new tab.</span></small></a>
              <a href="/app" target="_blank" rel="noreferrer"><span className="finale-tag">04 / Private workspace entry</span><strong>/app <span aria-hidden="true">↗</span></strong><small>Production DB/auth not configured. Not a live-auth demo.<span className="finale-sr"> Opens in a new tab.</span></small></a>
            </nav>
          </div>
        </>}
      </section>
    </main>

    {notes && <aside className="finale-notes" id="finale-notes" aria-label="Speaker notes"><div><span className="finale-tag">{scene.time} / {scene.name}</span><button type="button" onClick={() => { setNotes(false); notesButton.current?.focus(); }} aria-label="Close speaker notes">Close</button></div><p>{scene.notes}</p><small><strong>On stage:</strong> {scene.action}</small></aside>}

    <footer className="finale-footer" id="finale-controls" tabIndex={-1}>
      <div className="finale-progress" role="progressbar" aria-label="Presentation progress" aria-valuemin={1} aria-valuemax={scenes.length} aria-valuenow={active + 1} aria-valuetext={`Scene ${active + 1} of ${scenes.length}: ${scene.name}`}><span style={{ width: `${((active + 1) / scenes.length) * 100}%` }} /></div>
      <button className="finale-notes-toggle" ref={notesButton} type="button" aria-expanded={notes} aria-controls="finale-notes" onClick={() => setNotes(value => !value)}>Speaker notes</button>
      <span className="finale-page" aria-live="polite" aria-atomic="true">{String(active + 1).padStart(2, '0')} <span>/ 08</span></span>
      <nav className="finale-navigation" aria-label="Presentation scenes"><button type="button" disabled={active === 0} onClick={() => setActive(value => value - 1)}><span aria-hidden="true">←</span> Previous</button><button type="button" disabled={active === scenes.length - 1} onClick={() => setActive(value => value + 1)}>Next <span aria-hidden="true">→</span></button></nav>
    </footer>
  </div>;
}
