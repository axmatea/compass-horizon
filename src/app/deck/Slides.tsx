import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './deck.module.css';
import { DEMO_BEATS, PROVEN, SLIDES, TAGLINE, TEAM, URL_PLACEHOLDER } from './content';

/* The Horizon: Day 0 to Day 30 on one fixed baseline, shared by every slide. */
export const W = 1920;
export const H = 1080;
const X0 = 120;
const X1 = 1800;
const Y = 940;
const dx = (day: number) => X0 + (day / 30) * (X1 - X0);

const GOLD = 'var(--lv-gold)';
const GOLD_DIM = 'var(--lv-gold-dim)';
const STONE = 'var(--lv-a)';
const BG = 'var(--lv-bg)';

function Svg({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg
      className={s.svg}
      viewBox={`0 0 ${W} ${H}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

/** Static frame: the horizon line and folio. Persists between slides in present mode. */
export function Frame({ index }: { index: number }) {
  const n = index + 1;
  return (
    <>
      <Svg>
        <line x1={X0} y1={Y} x2={X1} y2={Y} stroke={GOLD} strokeWidth={2} />
        {[7, 14, 21].map((d) => (
          <line key={d} x1={dx(d)} x2={dx(d)} y1={Y - 7} y2={Y + 7} stroke={GOLD_DIM} strokeWidth={1.5} />
        ))}
        <circle cx={X0} cy={Y} r={7} fill={GOLD} />
        <circle cx={X1} cy={Y} r={8} fill={BG} stroke={GOLD} strokeWidth={2} />
        <text className={s.tDay} x={X0} y={Y + 50}>
          DAY 0
        </text>
        <text className={s.tDay} x={X1} y={Y + 50} textAnchor="end">
          DAY 30
        </text>
      </Svg>
      {n > 1 && (
        <div className={s.folio}>
          LONGVIEW<b>{String(n).padStart(2, '0')} / {SLIDES.length}</b>
        </div>
      )}
    </>
  );
}

function Eyebrow({ index }: { index: number }) {
  return <p className={`${s.eyebrow} ${s.enter}`}>{SLIDES[index].eyebrow}</p>;
}

/* ---------------- 1. Title ---------------- */
function Title() {
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 112, top: 214 }}>
        <h1 className={s.wordmark}>LONGVIEW</h1>
      </div>
      <p className={`${s.abs} ${s.tagline} ${s.enter2}`} style={{ left: 120, top: 470 }}>
        {TAGLINE}
      </p>
      <div className={`${s.abs} ${s.enter3}`} style={{ left: 120, top: 650 }}>
        <p className={s.lead} style={{ color: 'var(--lv-cream)' }}>
          {TEAM}
        </p>
        <p className={s.small} style={{ marginTop: 10 }}>
          Built with Nimble, Liquid AI and Tinybird
        </p>
      </div>
      <Svg>
        <g className={s.fade}>
          <text className={`${s.tSerif} ${s.italic}`} x={X0} y={Y - 30} fontSize={36} style={{ fill: 'var(--lv-muted)' }}>
            the click
          </text>
          <text className={`${s.tSerif} ${s.italic}`} x={X1} y={Y - 30} fontSize={36} textAnchor="end" style={{ fill: GOLD }}>
            the truth
          </text>
        </g>
      </Svg>
    </>
  );
}

/* ---------------- 2. Problem ---------------- */
const A_LEADS = Array.from({ length: 12 }, (_, i) => 0.22 + i * 0.36);
const B_LEADS = [0.55, 1.6, 2.7, 5.6, 8.3, 11.2];

function Problem() {
  const a1 = dx(1);
  const b21 = dx(21);
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 186, width: 1680 }}>
        <h2 className={s.hXL}>Ads are judged on day one.</h2>
        <h2 className={`${s.hXL} ${s.gold}`}>Customers arrive on day thirty.</h2>
      </div>
      <Svg label="Horizon: cost per lead favors A on day 1, revenue favors B on day 21">
        <g className={s.fade}>
          {A_LEADS.map((d, i) => (
            <circle key={`a${i}`} cx={dx(d)} cy={Y - 30} r={6} fill={STONE} />
          ))}
          {B_LEADS.map((d, i) => (
            <circle key={`b${i}`} cx={dx(d)} cy={Y - 58} r={7} fill={GOLD} />
          ))}
          <circle cx={b21} cy={Y - 58} r={13} fill={GOLD} />
        </g>
        <line className={s.draw} pathLength={1} x1={a1} y1={Y - 44} x2={a1} y2={566} stroke={STONE} strokeWidth={2} />
        <line className={s.drawLate} pathLength={1} x1={b21} y1={Y - 76} x2={b21} y2={566} stroke={GOLD} strokeWidth={2} />
        <g className={s.fade}>
          <text className={s.tCaps} x={a1 + 22} y={588}>
            DAY 1
          </text>
          <text className={s.tSerif} x={a1 + 22} y={652} fontSize={60} style={{ fill: STONE }}>
            CPL says A
          </text>
          <text className={s.tCaps} x={b21 + 22} y={588}>
            DAY 21
          </text>
          <text className={s.tSerif} x={b21 + 22} y={652} fontSize={60} style={{ fill: GOLD }}>
            Revenue says B
          </text>
          <text className={s.tSmall} x={dx(5.4)} y={Y - 26}>
            A leads
          </text>
          <text className={s.tSmall} x={dx(12.1)} y={Y - 52}>
            B leads
          </text>
        </g>
      </Svg>
    </>
  );
}

/* ---------------- 3. Insight ---------------- */
function curve(f: (d: number) => number, height: number, from = 0.02, to = 30, step = 0.05) {
  const pts: [number, number][] = [];
  let max = 0;
  for (let d = from; d <= to; d += step) {
    const v = f(d);
    if (v > max) max = v;
    pts.push([d, v]);
  }
  const xy = pts.map(([d, v]) => [dx(d), Y - (v / max) * height] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${dx(to).toFixed(1)} ${Y} L${dx(from).toFixed(1)} ${Y} Z`;
  return { line, area };
}

const fastReplies = (d: number) => Math.exp(-(Math.log(d / 0.8) ** 2) / (2 * 0.55 * 0.55)) / d;
const lateReplies = (d: number) => Math.pow(d, 2.2) * Math.exp(-d / 3);
const A_CURVE = curve(fastReplies, 330);
const B_CURVE = curve(lateReplies, 170);

function Insight() {
  const d3 = dx(3);
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 186, width: 1680 }}>
        <h2 className={s.hXL}>Busy buyers answer late.</h2>
      </div>
      <p className={`${s.abs} ${s.lead} ${s.enter2}`} style={{ left: 120, top: 330, width: 1240, color: 'var(--lv-muted)' }}>
        Fast responders dominate early data, so dashboards and naive agents learn the wrong lesson.
      </p>
      <Svg label="Reply time: campaign A replies within hours, campaign B replies over days">
        <rect x={X0} y={520} width={d3 - X0} height={Y - 520} fill={GOLD} opacity={0.07} />
        <g className={s.fade}>
          <path d={B_CURVE.area} fill={GOLD} fillOpacity={0.14} />
          <path d={A_CURVE.area} fill={STONE} fillOpacity={0.18} />
          <line x1={166} y1={612} x2={d3 + 8} y2={612} stroke={STONE} strokeWidth={1.5} strokeDasharray="2 5" />
        </g>
        <path className={s.draw} pathLength={1} d={A_CURVE.line} fill="none" stroke={STONE} strokeWidth={3} />
        <path className={s.drawLate} pathLength={1} d={B_CURVE.line} fill="none" stroke={GOLD} strokeWidth={3} />
        <line x1={d3} y1={Y} x2={d3} y2={520} stroke={GOLD} strokeWidth={2} strokeDasharray="6 8" />
        <g className={s.fade}>
          <text className={s.tCaps} x={d3 + 20} y={548} style={{ fill: GOLD }}>
            DAY 3: WHAT THE DASHBOARD SEES
          </text>
          <text className={s.tSerif} x={d3 + 20} y={632} fontSize={44} style={{ fill: STONE }}>
            A: fast responders
          </text>
          <text className={s.tSerif} x={dx(7.4)} y={742} fontSize={44} style={{ fill: GOLD }}>
            B: busy buyers
          </text>
          <text className={s.tSmall} x={X1} y={Y - 22} textAnchor="end">
            Illustration: time to first reply, demo scenario
          </text>
        </g>
      </Svg>
    </>
  );
}

/* ---------------- 4. What Longview does ---------------- */
const DOES: [string, string][] = [
  ['Keeps every experiment open until the truth arrives.', 'Outcomes are tracked to day 30, not judged on day 1.'],
  ['Remembers what it believed, and why.', 'Every belief is versioned with its evidence.'],
  ['Changes its mind with receipts.', 'Each revision carries a diff against the last one.'],
  ['Corrects its own decision rules.', 'A lesson raises the policy version.'],
];

function What() {
  const cls = [s.enter, s.enter2, s.enter3, s.enter4];
  return (
    <ol className={s.rows}>
      {DOES.map(([main, note], i) => (
        <li key={main} className={`${s.row} ${cls[i]}`}>
          <span className={s.rowNum}>{String(i + 1).padStart(2, '0')}</span>
          <span className={s.rowMain}>
            {main}
            <span className={s.rowNote}>{note}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- 5. Primitives ---------------- */
const PRIMS: { name: string; tag: string; body: string }[] = [
  { name: 'Ledger', tag: 'Bitemporal, idempotent', body: 'Every event knows when it happened and when we learned it. Replays change nothing.' },
  { name: 'Commitments', tag: 'Promises across time', body: 'The agent schedules its own follow-ups, then wakes up to keep them.' },
  { name: 'Beliefs', tag: 'Versioned, gated, diffed', body: 'A gate decides when evidence is enough. No winner on thin samples.' },
  { name: 'Crash-safe runs', tag: 'Checkpoints, exactly-once', body: 'Kill it mid-run. It resumes from the last checkpoint, with no repeated effects.' },
];

function Primitives() {
  const handle = dx(9);
  const cls = [s.enter, s.enter2, s.enter3, s.enter4];
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 180, width: 1680 }}>
        <h2 className={s.hL}>Built for day thirty, not day one.</h2>
      </div>
      <ul className={s.cols}>
        {PRIMS.map((p, i) => (
          <li key={p.name} className={`${s.col} ${cls[i]}`}>
            <p className={s.colName}>{p.name}</p>
            <p className={s.colTag}>{p.tag}</p>
            <p className={s.colBody}>{p.body}</p>
          </li>
        ))}
      </ul>
      <Svg label="Time machine handle on the horizon">
        <g className={s.fade}>
          <rect x={X0} y={Y - 10} width={handle - X0} height={10} fill={GOLD} opacity={0.22} />
          <line x1={handle} y1={Y - 58} x2={handle} y2={Y + 16} stroke={GOLD} strokeWidth={3} />
          <rect x={handle - 16} y={Y - 74} width={32} height={22} rx={6} fill={GOLD} />
          <text className={s.tSerif} x={handle + 34} y={Y - 50} fontSize={36} style={{ fill: 'var(--lv-cream)' }}>
            Plus a time machine
          </text>
          <text className={s.tLabel} x={handle + 34} y={Y - 14} style={{ fill: 'var(--lv-muted)' }}>
            scrub to any day and see exactly what the agent knew then
          </text>
        </g>
      </Svg>
    </>
  );
}

/* ---------------- 6. Live demo ---------------- */
function Demo({ print }: { print: boolean }) {
  const beatDays = DEMO_BEATS.filter((b) => b.day !== null) as { day: number; title: string }[];
  const from = dx(21);
  const to = dx(3);
  const mid = (from + to) / 2;
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 180, width: 1680 }}>
        <h2 className={s.hXL}>Watch it change its mind.</h2>
      </div>
      <div className={`${s.abs} ${s.enter2}`} style={{ left: 120, top: 402 }}>
        <p className={s.caps}>Open the live demo</p>
        <p style={{ margin: '30px 0 0' }}>
          {print ? (
            <span className={s.demoLink}>/demo</span>
          ) : (
            <Link href="/demo" className={s.demoLink} onClick={(e) => e.stopPropagation()}>
              /demo
            </Link>
          )}
        </p>
        <p className={s.small} style={{ marginTop: 56, width: 820 }}>
          Stage bar: Next beat, Pull the plug, Resume, Replay webhook. Then drag the time machine.
        </p>
      </div>
      <ol className={`${s.beats} ${s.enter3}`}>
        {DEMO_BEATS.map((b, i) => (
          <li key={b.title} className={s.beat}>
            <span className={s.beatN}>{i + 1}</span>
            <span className={s.beatDay}>{b.day === null ? 'Any day' : `Day ${b.day}`}</span>
            <span>{b.title}</span>
          </li>
        ))}
      </ol>
      <Svg label="The eight demo beats on the horizon">
        <g className={s.fade}>
          {beatDays.map((b, i) => (
            <g key={b.day}>
              <circle cx={dx(b.day)} cy={Y} r={10} fill={i === 3 ? GOLD : BG} stroke={GOLD} strokeWidth={2.5} />
              <text className={s.tSerif} x={dx(b.day)} y={Y - 24} fontSize={26} textAnchor="middle" style={{ fill: GOLD }}>
                {i + 1}
              </text>
            </g>
          ))}
          <path
            d={`M${from} ${Y - 46} Q ${mid} ${Y - 190} ${to + 8} ${Y - 50}`}
            fill="none"
            stroke={GOLD_DIM}
            strokeWidth={2}
            strokeDasharray="4 8"
          />
          <path d={`M${to + 8} ${Y - 50} l 19.7 3.2 M${to + 8} ${Y - 50} l 15.1 -13.1`} stroke={GOLD_DIM} strokeWidth={2} fill="none" strokeLinecap="round" />
          <text className={s.tSerif} x={mid} y={Y - 136} fontSize={26} textAnchor="middle" style={{ fill: GOLD }}>
            8
          </text>
        </g>
      </Svg>
    </>
  );
}

/* ---------------- 7. Architecture ---------------- */
const STEPS = ['ingest', 'extract', 'qualify', 'commitments', 'metrics', 'decide', 'market'];
const SX = 380;
const SW = 170;
const SG = 31;
const SY = 566;
const SH = 110;
const stepX = (i: number) => SX + i * (SW + SG);
const stepC = (i: number) => stepX(i) + SW / 2;

const SPONSORS: { name: string; role: string[]; step: number; x: number }[] = [
  { name: 'Liquid LFM', role: ['Cheap cognition on every event.', 'Extraction with quotes,', 'schema validated.'], step: 1, x: 486 },
  { name: 'Tinybird', role: ['As-of metrics', 'with dedupe.'], step: 4, x: 1104 },
  { name: 'Nimble', role: ['Market evidence', 'with sources.'], step: 6, x: 1470 },
];

function Architecture() {
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 150, width: 1680 }}>
        <h2 className={s.hM}>One wake-up, seven checkpointed steps.</h2>
      </div>
      <Svg label="Architecture: browser, Next.js on Vercel running seven checkpointed steps, Neon Postgres ledger, sponsors as roles">
        <g className={s.fade}>
          {/* sponsors as roles */}
          {SPONSORS.map((sp) => (
            <g key={sp.name}>
              <rect x={sp.x} y={266} width={sp.name === 'Liquid LFM' ? 384 : 330} height={sp.role.length > 2 ? 164 : 132} rx={12} fill="var(--lv-panel)" stroke="var(--lv-line-strong)" />
              <text className={s.tSerif} x={sp.x + 24} y={308} fontSize={32} style={{ fill: GOLD }}>
                {sp.name}
              </text>
              {sp.role.map((r, i) => (
                <text key={r} className={s.tLabel} x={sp.x + 24} y={346 + i * 30} fontSize={24} style={{ fontSize: 24 }}>
                  {r}
                </text>
              ))}
              <line
                x1={stepC(sp.step)}
                y1={sp.role.length > 2 ? 430 : 398}
                x2={stepC(sp.step)}
                y2={SY}
                stroke={GOLD_DIM}
                strokeWidth={2}
                strokeDasharray="3 6"
              />
            </g>
          ))}

          {/* browser */}
          <rect x={120} y={582} width={176} height={78} rx={12} fill="none" stroke="var(--lv-line-strong)" strokeWidth={1.5} />
          <text className={s.tLabel} x={208} y={630} textAnchor="middle" style={{ fill: 'var(--lv-cream)' }}>
            Browser
          </text>
          <line x1={296} y1={621} x2={346} y2={621} stroke={GOLD_DIM} strokeWidth={2} />
          <path d="M346 621 l -10 -6 v 12 z" fill={GOLD_DIM} />

          {/* vercel frame */}
          <rect x={350} y={470} width={1450} height={300} rx={16} fill="none" stroke="var(--lv-line-strong)" strokeWidth={1.5} />
          <text className={s.tCaps} x={376} y={514}>
            NEXT.JS ON VERCEL
          </text>

          {/* steps */}
          <line x1={stepC(0)} y1={SY + SH / 2} x2={stepC(6)} y2={SY + SH / 2} stroke="var(--lv-line-strong)" strokeWidth={1.5} />
          {STEPS.map((name, i) => (
            <g key={name}>
              <rect x={stepX(i)} y={SY} width={SW} height={SH} rx={10} fill="var(--lv-panel-2)" stroke={i === 2 ? GOLD : GOLD_DIM} strokeWidth={i === 2 ? 2 : 1.25} />
              <text className={s.tSerif} x={stepX(i) + 18} y={SY + 44} fontSize={34} style={{ fill: GOLD }}>
                {i + 1}
              </text>
              <text className={s.tLabel} x={stepX(i) + 18} y={SY + 88} style={{ fontSize: 23, fill: 'var(--lv-cream)' }}>
                {name}
              </text>
              {i < 6 && <circle cx={stepX(i) + SW + SG / 2} cy={SY + SH / 2} r={5} fill={GOLD} />}
              <line x1={stepC(i)} y1={SY + SH} x2={stepC(i)} y2={806} stroke="var(--lv-line-strong)" strokeWidth={1.25} strokeDasharray="2 6" />
            </g>
          ))}
          <text className={s.tSerif} x={stepX(2)} y={728} fontSize={30} style={{ fill: GOLD, fontStyle: 'italic' }}>
            Rules decide qualification, not the model.
          </text>
          <text className={s.tSmall} x={1774} y={728} textAnchor="end">
            gold dots = checkpoints
          </text>

          {/* ledger */}
          <rect x={350} y={806} width={1450} height={84} rx={12} fill="var(--lv-panel)" stroke={GOLD_DIM} strokeWidth={1.5} />
          <text className={s.tSerif} x={376} y={860} fontSize={34} style={{ fill: 'var(--lv-cream)' }}>
            Neon Postgres ledger
          </text>
          <text className={s.tLabel} x={1774} y={858} textAnchor="end" style={{ fontSize: 24, fill: 'var(--lv-muted)' }}>
            one append-only bitemporal table, on-conflict idempotency
          </text>
        </g>
      </Svg>
    </>
  );
}

/* ---------------- 8. Proof ---------------- */
function Tick() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="18" fill="none" stroke={GOLD_DIM} strokeWidth="1.5" />
      <path d="M12 20.5 l5.5 5.5 L28.5 14" fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Proof() {
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 180, width: 1680 }}>
        <h2 className={s.hL}>Seven properties, each checked by a test.</h2>
      </div>
      <ol className={`${s.proofs} ${s.enter2}`}>
        {PROVEN.map((p) => (
          <li key={p} className={s.proof}>
            <Tick />
            <span>{p}</span>
          </li>
        ))}
      </ol>
      <p className={`${s.abs} ${s.small} ${s.enter3}`} style={{ left: 1340, top: 372, width: 460 }}>
        The engine is pure, deterministic TypeScript. The same code runs in the tests, on the server and in the browser.
      </p>
    </>
  );
}

/* ---------------- 9. Business ---------------- */
function Business() {
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 180, width: 1020 }}>
        <h2 className={s.hM}>For businesses whose buyers take their time.</h2>
      </div>
      <div className={`${s.abs} ${s.enter2}`} style={{ left: 120, top: 408, width: 1000 }}>
        <p className={s.caps}>First customers</p>
        <p className={s.lead} style={{ marginTop: 18 }}>
          Service businesses with considered purchases: AI implementation firms, agencies, B2B services.
        </p>
        <p className={`${s.serif} ${s.italic}`} style={{ margin: '34px 0 0', fontSize: 42, color: 'var(--lv-cream)' }}>
          We run it on our own pipeline first.
        </p>
      </div>
      <div className={`${s.priceCard} ${s.enter3}`}>
        <p className={s.caps}>Early access</p>
        <p className={s.price}>$299</p>
        <p className={s.body} style={{ color: 'var(--lv-cream)' }}>
          per month, per business
        </p>
        <p className={s.small} style={{ marginTop: 10 }}>
          Ad spend separate.
        </p>
      </div>
      <div className={`${s.abs} ${s.enter4}`} style={{ left: 120, top: 770, width: 1680 }}>
        <p className={s.caps} style={{ color: 'var(--lv-muted)' }}>
          What it does not do
        </p>
        <p className={s.lead} style={{ marginTop: 14 }}>
          It does not buy ads, send messages, or promise results.
        </p>
      </div>
    </>
  );
}

/* ---------------- 10. Close ---------------- */
function Close() {
  return (
    <>
      <div className={`${s.abs} ${s.enter}`} style={{ left: 120, top: 250, width: 1680 }}>
        <h2 className={s.hL} style={{ fontSize: 86 }}>
          Your dashboard remembers the click.
        </h2>
        <h2 className={`${s.hL} ${s.gold}`} style={{ fontSize: 86 }}>
          Longview remembers what happened next.
        </h2>
      </div>
      <div className={`${s.abs} ${s.enter2}`} style={{ left: 120, top: 560 }}>
        <p className={s.caps}>Try it</p>
        <p className={s.serif} style={{ margin: '16px 0 0', fontSize: 48, color: 'var(--lv-cream)' }}>
          {URL_PLACEHOLDER}
        </p>
        <p className={s.small} style={{ marginTop: 26 }}>
          {TEAM}
        </p>
      </div>
      <Svg>
        <g className={s.fade}>
          <text className={`${s.tSerif}`} x={X0} y={Y - 30} fontSize={36} style={{ fill: 'var(--lv-muted)', fontStyle: 'italic' }}>
            the click
          </text>
          <text className={`${s.tSerif}`} x={X1} y={Y - 30} fontSize={36} textAnchor="end" style={{ fill: GOLD, fontStyle: 'italic' }}>
            what happened next
          </text>
        </g>
      </Svg>
    </>
  );
}

/** The content of one slide (animates on enter in present mode). */
export function SlideContent({ index, print = false }: { index: number; print?: boolean }) {
  const key = SLIDES[index]?.key;
  let body: ReactNode = null;
  switch (key) {
    case 'title':
      body = <Title />;
      break;
    case 'problem':
      body = <Problem />;
      break;
    case 'insight':
      body = <Insight />;
      break;
    case 'what':
      body = <What />;
      break;
    case 'primitives':
      body = <Primitives />;
      break;
    case 'demo':
      body = <Demo print={print} />;
      break;
    case 'architecture':
      body = <Architecture />;
      break;
    case 'proof':
      body = <Proof />;
      break;
    case 'business':
      body = <Business />;
      break;
    case 'close':
      body = <Close />;
      break;
  }
  return (
    <>
      <Eyebrow index={index} />
      {body}
    </>
  );
}
