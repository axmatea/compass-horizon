"use client";

/**
 * The Horizon, hero edition. Hand-rolled SVG drawn in real pixels (the
 * container is measured), so labels stay crisp and unclipped from 390px to
 * 1920px. Motion is pure CSS and only declared under
 * prefers-reduced-motion: no-preference; the default render is the settled,
 * static picture. Illustrative only: synthetic demo scenario shape.
 */

import { useEffect, useRef, useState } from "react";

type Lane = "A" | "B";
type Kind = "lead" | "late" | "won" | "ghost";

interface HzDot {
  lane: Lane;
  day: number; // occurred day (x position)
  learned: number; // day the agent learned it (appearance time)
  j: number; // beeswarm offset, in rows
  kind: Kind;
}

const HORIZON = 30;
const NOW = 21;

function lead(lane: Lane, day: number, j = 0): HzDot {
  return { lane, day, learned: day, j, kind: "lead" };
}

const DOTS: HzDot[] = [
  // A: cheap, fast responders pile up in the first three days.
  lead("A", 0.2, 0),
  lead("A", 0.5, -1),
  lead("A", 0.8, 1),
  lead("A", 1.1, 0),
  lead("A", 1.4, -1),
  lead("A", 1.7, 1),
  lead("A", 2.0, 0),
  lead("A", 2.3, -1),
  lead("A", 2.5, 1),
  lead("A", 2.8, 0),
  lead("A", 3.0, -1),
  lead("A", 3.1, 1),
  lead("A", 4.3, 0),
  lead("A", 5.6, 0),
  lead("A", 12.6, 0),
  { lane: "A", day: 16, learned: 16, j: 0, kind: "ghost" },
  // B: busy buyers, fewer and slower.
  lead("B", 1.6, 0),
  lead("B", 2.5, -1),
  lead("B", 3.1, 1),
  lead("B", 6.2, 0),
  lead("B", 7.4, -1),
  lead("B", 8.3, 1),
  lead("B", 9.6, 0),
  lead("B", 12.9, 0),
  // A call booked on day 5 that nobody heard about until day 11.
  { lane: "B", day: 5, learned: 11, j: 0, kind: "late" },
  { lane: "B", day: 21, learned: 21, j: 0, kind: "won" },
];

/* ---------- timing (seconds) ---------- */
const LOOP = 21.2;
const T0 = 0.8; // handle appears on day 0
const PER_DAY = 0.5; // handle speed
const ARRIVE = T0 + NOW * PER_DAY; // handle reaches NOW
const HOLD_END = 19.4; // everything starts fading out
const FADE_END = 20.6;
const RISE = 0.8;

const pct = (s: number) => `${((s / LOOP) * 100).toFixed(2)}%`;
const at = (day: number) => T0 + day * PER_DAY;
const EASE = "animation-timing-function:cubic-bezier(0.2,0.7,0.2,1)";

function appearFrames(name: string, start: number): string {
  return (
    `@keyframes ${name}{` +
    `0%,${pct(start)}{opacity:0;transform:translateY(12px);${EASE}}` +
    `${pct(start + RISE)},${pct(HOLD_END)}{opacity:1;transform:translateY(0)}` +
    `${pct(FADE_END)},100%{opacity:0;transform:translateY(0)}}`
  );
}

function groupKey(learned: number): string {
  return `ld-hz-t${Math.round(learned * 10)}`;
}

function buildCss(): string {
  const groups = Array.from(new Set(DOTS.map((d) => d.learned)));
  const frames: string[] = [];
  const rules: string[] = [];
  const anim = (name: string) => `animation:${name} ${LOOP}s linear infinite both`;
  for (const learned of groups) {
    const name = groupKey(learned);
    frames.push(appearFrames(name, at(learned)));
    rules.push(`.ld-hz--live .${name}{${anim(name)}}`);
  }
  // Handle travels day 0 to NOW, holds, fades, loops.
  frames.push(
    `@keyframes ld-hz-handle{` +
      `0%{opacity:0;transform:translateX(0)}` +
      `${pct(T0)}{opacity:1;transform:translateX(0)}` +
      `${pct(ARRIVE)},${pct(HOLD_END)}{opacity:1;transform:translateX(var(--hz-travel))}` +
      `${pct(FADE_END)},100%{opacity:0;transform:translateX(var(--hz-travel))}}`,
  );
  frames.push(
    `@keyframes ld-hz-known{` +
      `0%,${pct(T0)}{opacity:1;transform:scaleX(0)}` +
      `${pct(ARRIVE)},${pct(HOLD_END)}{opacity:1;transform:scaleX(1)}` +
      `${pct(FADE_END)},100%{opacity:0;transform:scaleX(1)}}`,
  );
  frames.push(
    `@keyframes ld-hz-arc{` +
      `0%,${pct(at(11))}{opacity:1;stroke-dashoffset:1;${EASE}}` +
      `${pct(at(11) + 1.4)},${pct(HOLD_END)}{opacity:1;stroke-dashoffset:0}` +
      `${pct(FADE_END)},100%{opacity:0;stroke-dashoffset:0}}`,
  );
  frames.push(appearFrames("ld-hz-arrive", ARRIVE + 0.2));
  frames.push(appearFrames("ld-hz-note", at(11) + 1.0));
  rules.push(`.ld-hz--live .ld-hz-handle{${anim("ld-hz-handle")}}`);
  rules.push(`.ld-hz--live .ld-hz-known{${anim("ld-hz-known")}}`);
  rules.push(`.ld-hz--live .ld-hz-arc{${anim("ld-hz-arc")}}`);
  rules.push(`.ld-hz--live .ld-hz-asof{${anim("ld-hz-arrive")}}`);
  rules.push(`.ld-hz--live .ld-hz-note{${anim("ld-hz-note")}}`);
  return `@media (prefers-reduced-motion: no-preference){${frames.join("")}${rules.join("")}}`;
}

const MOTION_CSS = buildCss();

interface Size {
  w: number;
  h: number;
}

function geometry({ w, h }: Size) {
  const compact = w < 640;
  // On wide screens day 0 and day 30 line up with the 1200px text column,
  // and the lane letters hang in the margin (the svg overflow is visible).
  const inset = Math.round((w - 1200) / 2);
  const aligned = !compact && inset >= 24;
  const x0 = aligned ? inset : compact ? 34 : 60;
  const x1 = w - (aligned ? inset : compact ? 24 : 40);
  const laneX = compact ? 4 : x0 - 44;
  const x = (d: number) => x0 + (d / HORIZON) * (x1 - x0);
  const yAxis = h - 46;
  const gap = Math.max(40, Math.min(compact ? 52 : 62, (yAxis - 84) / 2));
  const yA = yAxis - gap;
  const yB = yA - gap;
  const rise = compact ? 34 : 44;
  const r = compact ? 2.8 : 4;
  const jit = compact ? 6.5 : 8;
  return { compact, x0, x1, x, yAxis, yA, yB, rise, r, jit, laneX };
}

const MAJOR = [0, 7, 14, 21, 30];

export function HorizonHero() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (w < 10 || h < 10) return;
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`ld-hz${size ? " ld-hz--live" : ""}`}
      role="img"
      aria-label="The horizon, day 0 to day 30. Lane A fills with cheap early leads in the first three days. Lane B fills slowly. On day 11 a call booked on day 5 arrives late and is drawn as an arc back to day 5. By day 21 lane B holds a won deal and lane A's only call ghosted."
    >
      <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />
      {size ? <HorizonSvg size={size} /> : null}
    </div>
  );
}

function HorizonSvg({ size }: { size: Size }) {
  const g = geometry(size);
  const { x, x0, x1, yAxis, yA, yB, rise, r, jit, compact, laneX } = g;
  const laneY = (lane: Lane) => (lane === "A" ? yA : yB);
  const xNow = x(NOW);
  const travel = xNow - x0;
  const handleTop = yB - (compact ? 46 : 54);
  const arcFrom = x(11);
  const arcTo = x(5);
  const arcMid = (arcFrom + arcTo) / 2;
  const arcD = `M ${arcFrom} ${yB} Q ${arcMid} ${yB - rise * 2} ${arcTo} ${yB}`;

  return (
    <svg
      className="ld-hz-svg"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
      focusable="false"
      style={{ ["--hz-travel" as string]: `${travel}px` }}
    >
      {/* lane letters */}
      <text className="ld-hz-lane ld-hz-lane--b" x={laneX} y={yB + 5}>
        B
      </text>
      <text className="ld-hz-lane ld-hz-lane--a" x={laneX} y={yA + 5}>
        A
      </text>

      {/* lane guides */}
      <line className="ld-hz-guide" x1={x0} x2={x1} y1={yB} y2={yB} />
      <line className="ld-hz-guide" x1={x0} x2={x1} y1={yA} y2={yA} />

      {/* the horizon: dim ahead, gold where the agent has lived */}
      <rect className="ld-hz-base" x={x0} y={yAxis - 0.5} width={x1 - x0} height={1} />
      <rect className="ld-hz-known" x={x0} y={yAxis - 0.75} width={travel} height={1.5} />

      {/* ticks */}
      {Array.from({ length: HORIZON + 1 }, (_, d) => {
        const major = MAJOR.includes(d);
        return (
          <line
            key={d}
            className={major ? "ld-hz-tick ld-hz-tick--major" : "ld-hz-tick"}
            x1={x(d)}
            x2={x(d)}
            y1={major ? yAxis - 4 : yAxis + 2}
            y2={major ? yAxis + 8 : yAxis + 6}
          />
        );
      })}
      {MAJOR.map((d) => (
        <text key={d} className="ld-hz-daylabel" x={x(d)} y={yAxis + 26} textAnchor="middle">
          {d === 0 || d === HORIZON ? `Day ${d}` : d}
        </text>
      ))}

      {/* late arc: learned on day 11, reaches back to day 5 */}
      <path className="ld-hz-arc" d={arcD} pathLength={1} />
      <g className={groupKey(11)}>
        <circle className="ld-hz-landing" cx={arcFrom} cy={yB} r={compact ? 2.6 : 3} />
      </g>
      <g className="ld-hz-note">
        <text className="ld-hz-note-text" x={arcMid} y={yB - rise - 10} textAnchor="middle">
          learned late
        </text>
      </g>

      {/* ledger dots */}
      {DOTS.map((d, i) => {
        const cx = x(d.day);
        const cy = laneY(d.lane) + d.j * jit;
        const cls = `ld-hz-dot ld-hz-dot--${d.lane.toLowerCase()} ld-hz-dot--${d.kind}`;
        return (
          <g key={i} className={groupKey(d.learned)}>
            {d.kind === "won" ? (
              <>
                <circle className="ld-hz-won-ring" cx={cx} cy={cy} r={r + 5} />
                <circle className={cls} cx={cx} cy={cy} r={r + 1.5} />
                <text className="ld-hz-mark ld-hz-mark--won" x={cx + r + 12} y={cy + 4}>
                  won $18,000
                </text>
              </>
            ) : d.kind === "ghost" ? (
              <>
                <circle className={cls} cx={cx} cy={cy} r={r + 1.5} />
                <text className="ld-hz-mark" x={cx} y={cy + (compact ? 18 : 21)} textAnchor="middle">
                  ghosted
                </text>
              </>
            ) : d.kind === "late" ? (
              <>
                <circle className="ld-hz-late-ring" cx={cx} cy={cy} r={r + 3.5} />
                <circle className={cls} cx={cx} cy={cy} r={r} />
              </>
            ) : (
              <circle className={cls} cx={cx} cy={cy} r={r} />
            )}
          </g>
        );
      })}

      {/* time machine handle rides the horizon */}
      <g className="ld-hz-asof">
        <text className="ld-hz-asof-text" x={xNow} y={handleTop - 10} textAnchor="middle">
          As of day {NOW}
        </text>
      </g>
      <g className="ld-hz-handle">
        <line className="ld-hz-cursor" x1={x0} x2={x0} y1={handleTop} y2={yAxis} />
        <circle className="ld-hz-knob" cx={x0} cy={yAxis} r={compact ? 6 : 7} />
        <circle className="ld-hz-knob-core" cx={x0} cy={yAxis} r={2.4} />
      </g>
    </svg>
  );
}
