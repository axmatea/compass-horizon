"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { LedgerEntry, WorldView } from "@/contract";
import { useSize } from "./hooks";
import { beliefLabels } from "./story";

interface Props {
  frame: WorldView;
  day: number;
  lastDay: number;
  reducedMotion: boolean;
  onScrub: (day: number) => void;
}

interface Lane {
  key: string;
  letter: string;
  name: string;
  color: string;
}

/** Order inside a day cell: what matters most is drawn first and never folded into the +N counter. */
const IMPORTANCE: Record<string, number> = {
  "belief.recorded": 0,
  "lesson.recorded": 1,
  "outcome.recorded": 2,
  "lead.qualified": 3,
  "lead.replied": 4,
  "webhook.duplicate_ignored": 5,
};

const COLS = 3;
const MAX_SHOWN = 9;

function laneOf(frame: WorldView, e: LedgerEntry): string {
  if (e.lane === "agent" || e.lane === "market") return "Agent";
  if (e.lane === "unknown") return "Unknown";
  return frame.campaigns.find((c) => c.id === e.lane)?.key ?? e.lane;
}

function Glyph({ e, cx, cy, color, r }: { e: LedgerEntry; cx: number; cy: number; color: string; r: number }) {
  switch (e.type) {
    case "belief.recorded": {
      const s = r * 2;
      return <path d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`} fill="var(--c-gold)" />;
    }
    case "lesson.recorded": {
      const s = r * 2;
      return <path d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`} fill="var(--c-bg)" stroke="var(--c-cream)" strokeWidth={1.3} />;
    }
    case "policy.versioned":
    case "rules.versioned":
    case "market.scanned":
      return <rect x={cx - r * 0.85} y={cy - r * 0.85} width={r * 1.7} height={r * 1.7} fill="none" stroke="var(--c-muted)" strokeWidth={1} />;
    case "webhook.duplicate_ignored":
      return <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--c-muted)" strokeWidth={1} />;
    case "outcome.recorded":
      return (
        <>
          <circle cx={cx} cy={cy} r={r * 1.75} fill="none" stroke={color} strokeWidth={1} opacity={0.75} />
          <circle cx={cx} cy={cy} r={r} fill={color} />
        </>
      );
    case "lead.qualified":
      return <circle cx={cx} cy={cy} r={r} fill={color} stroke="var(--c-ok)" strokeWidth={1.4} />;
    case "lead.captured":
      return <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.45} />;
    default:
      return <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.8} />;
  }
}

/** Rough text width for label layout (Helvetica, 13px, with digits). */
const textW = (s: string, px: number) => s.length * px * 0.56;

export function Horizon({ frame, day, lastDay, reducedMotion, onScrub }: Props) {
  const [wrapRef, size] = useSize<HTMLDivElement>({ width: 1200, height: 560 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);

  const compact = size.width < 720;
  const labelW = compact ? 64 : 196;
  const padR = compact ? 28 : 44;
  const svgW = Math.max(size.width, compact ? labelW + lastDay * 38 + padR : 0);
  const plotW = Math.max(10, svgW - labelW - padR);
  const dayW = plotW / Math.max(1, lastDay);
  const x = (d: number) => labelW + Math.max(0, Math.min(lastDay, d)) * dayW;

  const top = 40;
  const bottom = 46;
  const laneGap = Math.max(58, Math.min(150, (size.height - top - bottom) / 3.9));
  const laneY = (i: number) => top + i * laneGap;
  const axisY = laneY(3) + laneGap * 0.9;
  const svgH = Math.round(axisY + bottom);

  const sp = Math.max(6.5, Math.min(12.5, dayW / 4.4));
  const r = sp * 0.32;

  const lanes: Lane[] = useMemo(() => {
    const out: Lane[] = [...frame.campaigns]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((c) => ({ key: c.key, letter: c.key, name: c.name, color: c.key === "A" ? "var(--c-a)" : "var(--c-b)" }));
    out.push({ key: "Unknown", letter: "", name: "Unknown", color: "var(--c-unknown)" });
    out.push({ key: "Agent", letter: "", name: "Agent", color: "var(--c-cream)" });
    return out;
  }, [frame.campaigns]);
  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.key, i])), [lanes]);
  const agentY = laneY(laneIndex.get("Agent") ?? 3);

  // Entries that were not in the previous frame rise onto the line.
  const [seen, setSeen] = useState<{ frame: WorldView | null; ids: Set<string> }>({ frame: null, ids: new Set() });
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  if (seen.frame !== frame) {
    const ids = new Set(frame.ledger.map((e) => e.id));
    setFresh(new Set([...ids].filter((id) => !seen.ids.has(id))));
    setSeen({ frame, ids });
  }

  const cells = useMemo(() => {
    const m = new Map<string, LedgerEntry[]>();
    for (const e of frame.ledger) {
      const lane = laneOf(frame, e);
      if (!laneIndex.has(lane)) continue;
      const k = `${lane}|${e.learnedDay}`;
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (IMPORTANCE[a.type] ?? 9) - (IMPORTANCE[b.type] ?? 9));
    return m;
  }, [frame, laneIndex]);

  const dots: ReactNode[] = [];
  const counters: ReactNode[] = [];
  let order = 0;
  for (const [k, arr] of cells) {
    const [lane, dayStr] = k.split("|");
    const li = laneIndex.get(lane) ?? 0;
    const cx0 = x(Number(dayStr));
    const cy0 = laneY(li);
    const color = lanes[li].color;
    const shown = arr.length > MAX_SHOWN ? arr.slice(0, MAX_SHOWN - 1) : arr;
    const rows = Math.ceil(shown.length / COLS);
    shown.forEach((e, i) => {
      const row = Math.floor(i / COLS);
      const inRow = row === rows - 1 ? shown.length - row * COLS : COLS;
      const col = i % COLS;
      const cx = cx0 + (col - (inRow - 1) / 2) * sp;
      const cy = cy0 + (row - (rows - 1) / 2) * sp;
      const isNew = fresh.has(e.id);
      dots.push(
        <g key={e.id} className={`hz-dot${isNew ? " is-new" : ""}`} style={{ ["--i" as string]: isNew ? Math.min(order++, 60) : 0 }}>
          <title>{`Day ${e.learnedDay}: ${e.label}${e.late ? ` (happened Day ${e.occurredDay})` : ""}`}</title>
          <Glyph e={e} cx={cx} cy={cy} color={color} r={r} />
        </g>,
      );
    });
    if (arr.length > shown.length) {
      counters.push(
        <text key={`n-${k}`} x={cx0} y={cy0 + sp * 1.5 + 11} textAnchor="middle" className="hz-more">
          +{arr.length - shown.length}
        </text>,
      );
    }
  }

  // Learned late: an arc from the day it happened to the day the agent learned it.
  const landed = new Set<string>();
  const arcs = frame.ledger
    .filter((e) => e.late && e.learnedDay > e.occurredDay && e.type === "outcome.recorded")
    .sort((a, b) => b.learnedDay - b.occurredDay - (a.learnedDay - a.occurredDay))
    .map((e) => {
      const lane = laneOf(frame, e);
      const li = laneIndex.get(lane);
      if (li === undefined) return null;
      const y = laneY(li);
      const x1 = x(e.occurredDay);
      const x2 = x(e.learnedDay);
      const h = Math.min(laneGap * 0.5, 12 + Math.abs(x2 - x1) * 0.25);
      const mid = (x1 + x2) / 2;
      const cell = `${lane}|${e.learnedDay}`;
      const label = !landed.has(cell);
      landed.add(cell);
      return (
        <g key={`arc-${e.id}`} className={`hz-arc${fresh.has(e.id) ? " is-new" : ""}`}>
          <path d={`M${x1} ${y} Q${mid} ${y - h * 2} ${x2} ${y}`} pathLength={1} />
          <circle cx={x1} cy={y} r={3.4} className="hz-arc-origin" />
          {label && (
            <text x={mid} y={y - h - 9} textAnchor="middle" className="hz-arc-label">
              learned late
            </text>
          )}
        </g>
      );
    });

  // Belief versions, a few words each, above the Agent lane. Two rows so neighbours never collide.
  const beliefs = beliefLabels(frame);
  const rowRight = [-Infinity, -Infinity];
  const labelPx = compact ? 12 : 13.5;
  const beliefNodes = beliefs.map((b) => {
    const full = b.num ? `${b.text} ${b.num}` : b.text;
    const w = textW(full, labelPx);
    let left = x(b.day) - w / 2;
    left = Math.max(labelW - sp, Math.min(svgW - padR / 2 - w, left));
    // Nudge right a little before stacking; stack only when neighbours truly collide.
    const need = rowRight[0] + 18;
    if (left < need && need - left <= 28 && need + w <= svgW - padR / 2) left = need;
    const row = rowRight[0] + 18 <= left ? 0 : 1;
    rowRight[row] = left + w;
    const y = agentY - sp * 1.5 - 14 - row * (labelPx + 9);
    return (
      <g key={`b-${b.version}`} className={`hz-belief${b.day === day ? " is-current" : ""}`}>
        <line x1={x(b.day)} x2={x(b.day)} y1={y + 5} y2={agentY - sp * 1.2} className="hz-belief-tick" />
        <text x={left} y={y} className="hz-belief-label">
          {b.text}
          {b.num && <tspan className="hz-belief-num">{` ${b.num}`}</tspan>}
        </text>
      </g>
    );
  });

  const lessonNodes = frame.lessons.map((l) => {
    const agentCell = cells.get(`Agent|${l.day}`);
    const below = agentY + sp * 1.5 + (agentCell && agentCell.length > MAX_SHOWN ? 30 : 16);
    return (
      <text key={l.id} x={x(l.day)} y={below} textAnchor="middle" className="hz-lesson">
        Rule tightened
      </text>
    );
  });

  const ticks: ReactNode[] = [];
  for (let d = 0; d <= lastDay; d++) {
    const labelIt = dayW >= 24 || d % 2 === 0 || d === lastDay;
    const cls = d === day ? "hz-tick is-current" : d > day ? "hz-tick is-future" : "hz-tick";
    ticks.push(
      <g key={`t${d}`} className={cls}>
        <line x1={x(d)} x2={x(d)} y1={axisY - 3} y2={axisY + 3} />
        {labelIt && (
          <text x={x(d)} y={axisY + 22} textAnchor="middle">
            {d}
          </text>
        )}
      </g>,
    );
  }

  // Time travel: drag the handle or the axis.
  const dayFromClientX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return day;
    return Math.max(0, Math.min(lastDay, Math.round((clientX - rect.left - labelW) / dayW)));
  };
  const onPointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    try {
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    } catch {
      // capture is a nicety; dragging still works without it
    }
    onScrub(dayFromClientX(ev.clientX));
  };
  const onPointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onScrub(dayFromClientX(ev.clientX));
  };
  const onPointerUp = (ev: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onScrub(dayFromClientX(ev.clientX));
  };
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    let d = day;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") d -= 1;
    else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") d += 1;
    else if (ev.key === "Home") d = 0;
    else if (ev.key === "End") d = lastDay;
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    onScrub(Math.max(0, Math.min(lastDay, d)));
  };

  // On narrow screens the graph scrolls sideways: keep the current day in view.
  const hx = x(day);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragging.current || el.scrollWidth <= el.clientWidth + 1) return;
    const target = Math.max(0, hx - (el.clientWidth + labelW) / 2);
    el.scrollTo({ left: target, behavior: reducedMotion ? "auto" : "smooth" });
  }, [hx, labelW, reducedMotion]);

  return (
    <div className="hz" ref={wrapRef}>
      <div className="hz-frame" style={{ height: svgH }}>
        <div className="hz-scroll" ref={scrollRef}>
          <div className="hz-canvas" style={{ width: svgW, height: svgH }}>
            <svg
              ref={svgRef}
              className="hz-svg"
              width={svgW}
              height={svgH}
              viewBox={`0 0 ${svgW} ${svgH}`}
              role="img"
              aria-label={`Horizon, Day 0 to Day ${lastDay}. Showing what the agent knew on Day ${day}.`}
            >
              {lanes.map((l, i) => (
                <g key={l.key} className="hz-lane">
                  <line x1={x(0)} x2={hx} y1={laneY(i)} y2={laneY(i)} />
                  <line x1={hx} x2={x(lastDay)} y1={laneY(i)} y2={laneY(i)} className="is-future" />
                </g>
              ))}
              <line className="hz-now" x1={0} x2={0} y1={10} y2={axisY} style={{ transform: `translateX(${hx}px)` }} />
              {arcs}
              {dots}
              {counters}
              {beliefNodes}
              {lessonNodes}
              <line className="hz-axis" x1={x(0)} x2={x(lastDay)} y1={axisY} y2={axisY} />
              {ticks}
            </svg>

            <div
              className="hz-track"
              style={{ left: labelW - 12, width: plotW + 24, top: axisY - 20, height: 40 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-hidden="true"
            />

            <div className="hz-handle" style={{ left: hx, top: axisY }}>
              <div
                className="hz-knob"
                role="slider"
                tabIndex={0}
                aria-label="Time machine: drag to any day to see what the agent knew then"
                aria-valuemin={0}
                aria-valuemax={lastDay}
                aria-valuenow={day}
                aria-valuetext={`Day ${day}`}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          </div>
        </div>

        <div className="hz-lanes" style={{ width: labelW }} aria-hidden="true">
          {lanes.map((l, i) => (
            <div key={l.key} className={`hz-lane-label${l.letter ? "" : " is-quiet"}`} style={{ top: laneY(i) }}>
              {l.letter && (
                <span className="hz-lane-letter" style={{ color: l.color }}>
                  {l.letter}
                </span>
              )}
              {(!compact || !l.letter) && <span className="hz-lane-name">{l.name}</span>}
            </div>
          ))}
          <div className="hz-lane-label is-axis" style={{ top: axisY }}>
            <span className="hz-lane-name">Day</span>
          </div>
        </div>
      </div>
    </div>
  );
}
