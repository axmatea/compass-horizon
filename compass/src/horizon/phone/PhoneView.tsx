import type { CSSProperties } from "react";
import NumberFlow from "@number-flow/react";
import type { WorldView } from "../contract";
import { readout } from "../ui/story";
import "./phone.css";

type PhoneProps = {
  frame: WorldView;
  day: number;
  lastDay: number;
  caption: string;
  playing: boolean;
  reducedMotion: boolean;
  onTogglePlay: () => void;
  onScrub: (d: number) => void;
};

/* Dial geometry in SVG user units (viewBox 0 0 220 220). */
const C = 110;
const R = 96;
const MAX_TILT = 60;
const rad = (deg: number) => (deg * Math.PI) / 180;
const px = (r: number, deg: number) => C + r * Math.sin(rad(deg));
const py = (r: number, deg: number) => C - r * Math.cos(rad(deg));

const TICKS = Array.from({ length: 36 }, (_, i) => {
  const deg = i * 10;
  const major = i % 3 === 0;
  const inner = R - (major ? 10 : 5);
  const accent = deg === 0 || deg === 60 || deg === 300;
  return { deg, x1: px(R, deg), y1: py(R, deg), x2: px(inner, deg), y2: py(inner, deg), major, accent };
});

const ARC = `M${px(84, -MAX_TILT)} ${py(84, -MAX_TILT)} A84 84 0 0 1 ${px(84, MAX_TILT)} ${py(84, MAX_TILT)}`;

/* Mini timeline geometry. */
const SW = 320;
const SH = 26;
const SPAD = 9;

function favoredKey(frame: WorldView): "A" | "B" | null {
  const f = frame.currentBelief?.favors ?? null;
  if (!f) return null;
  const k = frame.campaigns.find((c) => c.id === f)?.key ?? f;
  return k === "A" || k === "B" ? k : null;
}

export default function PhoneView(props: PhoneProps) {
  const { frame, day, lastDay, caption, playing, reducedMotion, onTogglePlay, onScrub } = props;

  const r = readout(frame);
  const belief = frame.currentBelief;
  const p = r.num !== null && belief && belief.probability !== null && Number.isFinite(belief.probability) ? belief.probability : null;
  const k = r.num !== null ? favoredKey(frame) : null;

  // 0 = undecided; +-60 = fully convinced. Scaled by how far past a coin flip the belief is.
  const t = p === null ? 0.5 : Math.min(1, Math.max(0.15, (p - 0.5) * 2));
  const angle = k === null ? 0 : (k === "A" ? -1 : 1) * MAX_TILT * t;

  const n = Math.max(0, lastDay);
  const sx = (d: number) => (n === 0 ? SW / 2 : SPAD + (d * (SW - 2 * SPAD)) / n);
  const keyDays = new Set<number>(frame.beliefs.map((b) => b.day));
  if (frame.curves.flipDay !== null) keyDays.add(frame.curves.flipDay);
  const fill = n > 0 ? Math.min(100, Math.max(0, (day / n) * 100)) : 0;

  const cleanCaption = caption.replace(/\s*[—–]\s*/g, ", ").trim();

  return (
    <div className={reducedMotion ? "ph-page ph-still" : "ph-page"}>
      <div className="ph-device">
        <div className="ph-bezel">
          <main className="ph-screen" aria-label="COMPASS phone view">
            <div className="ph-island" aria-hidden="true" />

            <header className="ph-top">
              <span className="ph-mark">COMPASS</span>
              <span className="ph-day" aria-live="polite">Day {day}</span>
            </header>

            <section className="ph-hero">
              <svg className="ph-dial" viewBox="0 0 220 220" role="img" aria-label={k ? `Needle toward ${k}` : "Needle centered, undecided"}>
                <circle cx={C} cy={C} r={R} fill="none" stroke="var(--ph-gold)" strokeWidth={1} />
                <circle cx={C} cy={C} r={R - 16} fill="none" stroke="var(--ph-faint)" strokeWidth={0.75} />
                {TICKS.map((tk) => (
                  <line
                    key={tk.deg}
                    x1={tk.x1}
                    y1={tk.y1}
                    x2={tk.x2}
                    y2={tk.y2}
                    stroke={tk.accent ? "var(--ph-gold)" : "var(--ph-tick)"}
                    strokeWidth={tk.major ? 1.2 : 0.8}
                    strokeLinecap="round"
                  />
                ))}
                <path d={ARC} fill="none" stroke="var(--ph-gold)" strokeOpacity={0.28} strokeWidth={1} />
                <text x={px(70, -90)} y={C} className="ph-letter" fill={k === "A" ? "var(--ph-gold)" : "var(--ph-muted)"}>A</text>
                <text x={px(70, 90)} y={C} className="ph-letter" fill={k === "B" ? "var(--ph-gold)" : "var(--ph-muted)"}>B</text>
                <g className="ph-needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${C}px ${C}px` }}>
                  <path d={`M${C} ${C - 64} L${C + 3.2} ${C} L${C - 3.2} ${C} Z`} fill="var(--ph-gold)" />
                  <path d={`M${C - 3.2} ${C} L${C + 3.2} ${C} L${C} ${C + 16} Z`} fill="var(--ph-cream)" fillOpacity={0.3} />
                </g>
                <circle cx={C} cy={C} r={4.5} fill="var(--ph-bg)" stroke="var(--ph-gold)" strokeWidth={1.2} />
              </svg>

              <div className="ph-num" aria-live="polite">
                {p !== null ? (
                  <NumberFlow value={Math.round(p * 100)} suffix="%" animated={!reducedMotion} />
                ) : (
                  <span className="ph-num-text">{r.status}</span>
                )}
              </div>
              {p !== null && <div className="ph-status">{r.status}</div>}
              {cleanCaption && <p className="ph-caption">{cleanCaption}</p>}
            </section>

            <section className="ph-time" aria-label="Timeline">
              <svg className="ph-strip" viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true">
                <line x1={SPAD} y1={SH / 2} x2={SW - SPAD} y2={SH / 2} stroke="var(--ph-faint)" strokeWidth={1} />
                <line x1={SPAD} y1={SH / 2} x2={sx(Math.min(day, n))} y2={SH / 2} stroke="var(--ph-gold)" strokeOpacity={0.45} strokeWidth={1} />
                {Array.from({ length: n + 1 }, (_, d) => {
                  const lit = d <= day;
                  const big = keyDays.has(d);
                  return (
                    <circle
                      key={d}
                      cx={sx(d)}
                      cy={SH / 2}
                      r={big ? 3.4 : 2}
                      fill={lit ? "var(--ph-gold)" : "var(--ph-bg)"}
                      stroke={lit ? "var(--ph-gold)" : "var(--ph-tick)"}
                      strokeWidth={0.8}
                    />
                  );
                })}
                {n > 0 && <circle cx={sx(Math.min(day, n))} cy={SH / 2} r={6.5} fill="none" stroke="var(--ph-gold)" strokeWidth={1} />}
              </svg>
              <input
                className="ph-range"
                type="range"
                min={0}
                max={n}
                step={1}
                value={Math.min(day, n)}
                onChange={(e) => onScrub(Number(e.currentTarget.value))}
                aria-label="Day"
                aria-valuetext={`Day ${day} of ${n}`}
                style={{ "--ph-fill": `${fill}%` } as CSSProperties}
              />
            </section>

            <footer className="ph-foot">
              <button type="button" className="ph-play" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"} aria-pressed={playing}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {playing ? (
                    <>
                      <rect x="7" y="6" width="3.4" height="12" rx="1" />
                      <rect x="13.6" y="6" width="3.4" height="12" rx="1" />
                    </>
                  ) : (
                    <path d="M8.5 5.9v12.2a.8.8 0 0 0 1.2.7l9.4-6.1a.8.8 0 0 0 0-1.4L9.7 5.2a.8.8 0 0 0-1.2.7z" />
                  )}
                </svg>
              </button>
              <span className="ph-honest">{frame.clock.simulated ? "Simulation · not real revenue" : "Live data"}</span>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
