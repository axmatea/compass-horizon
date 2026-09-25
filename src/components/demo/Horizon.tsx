"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { LedgerEntry, WorldView } from "@/contract";
import { campaignKey, laneColor } from "./format";
import { useWidth } from "./hooks";

interface Props {
  world: WorldView;
  handleDay: number;
  pending: boolean;
  onScrub: (day: number, final: boolean) => void;
}

interface Lane {
  key: string;
  label: string;
  short: string;
  color: string;
}

const IMPORTANCE: Record<string, number> = {
  "belief.recorded": 0,
  "lesson.recorded": 1,
  "outcome.recorded": 2,
  "chaos.fired": 3,
  "run.resumed": 4,
  "lead.qualified": 5,
  "webhook.duplicate_ignored": 6,
  "lead.replied": 7,
};

function laneOf(world: WorldView, e: LedgerEntry): string {
  if (e.lane === "agent" || e.lane === "market") return "Agent";
  if (e.lane === "unknown") return "Unknown";
  return campaignKey(world, e.lane);
}

function Glyph({ e, cx, cy, color, r }: { e: LedgerEntry; cx: number; cy: number; color: string; r: number }) {
  switch (e.type) {
    case "belief.recorded": {
      const s = r * 2.1;
      return <path d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`} fill="var(--lv-gold)" />;
    }
    case "lesson.recorded": {
      const s = r * 2.1;
      return <path d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`} fill="var(--lv-bg)" stroke="var(--lv-cream)" strokeWidth={1.2} />;
    }
    case "policy.versioned":
    case "rules.versioned":
    case "market.scanned":
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill="none" stroke="var(--lv-muted)" strokeWidth={1} />;
    case "chaos.fired":
      return <circle cx={cx} cy={cy} r={r * 1.3} fill="var(--lv-bad)" />;
    case "run.resumed":
      return <circle cx={cx} cy={cy} r={r * 1.3} fill="var(--lv-ok)" />;
    case "webhook.duplicate_ignored":
      return <circle cx={cx} cy={cy} r={r * 1.1} fill="none" stroke="var(--lv-muted)" strokeWidth={1} />;
    case "outcome.recorded":
      return (
        <>
          <circle cx={cx} cy={cy} r={r * 1.9} fill="none" stroke={color} strokeWidth={1} opacity={0.8} />
          <circle cx={cx} cy={cy} r={r * 1.05} fill={color} />
        </>
      );
    case "lead.qualified":
      return <circle cx={cx} cy={cy} r={r * 1.05} fill={color} stroke="var(--lv-ok)" strokeWidth={1.3} />;
    case "lead.captured":
      return <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.5} />;
    default:
      return <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.85} />;
  }
}

export function Horizon({ world, handleDay, pending, onScrub }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(1200);
  const compact = width < 640;
  const H = Math.max(1, world.clock.horizonDays || 30);
  const clockDay = world.clock.day;
  const asOf = world.asOfDay;

  const lanes: Lane[] = useMemo(() => {
    const keys = Array.from(new Set((world.campaigns ?? []).map((c) => c.key))).sort();
    const out: Lane[] = keys.map((k) => ({ key: k, label: `Campaign ${k}`, short: k, color: laneColor(k) }));
    out.push({ key: "Unknown", label: "Unknown", short: "Unk.", color: laneColor("Unknown") });
    out.push({ key: "Agent", label: "Agent", short: "Agent", color: "var(--lv-cream)" });
    return out;
  }, [world.campaigns]);

  const padL = compact ? 60 : 112;
  const padR = compact ? 14 : 32;
  const top = compact ? 32 : 34;
  const laneGap = compact ? 26 : 32;
  const laneY = (i: number) => top + i * laneGap;
  const axisY = laneY(lanes.length - 1) + laneGap;
  const height = axisY + (compact ? 30 : 34);
  const plotW = Math.max(10, width - padL - padR);
  const x = (d: number) => padL + (Math.max(0, Math.min(H, d)) / H) * plotW;
  const dayW = plotW / H;

  // New-dot detection: entries absent from the previous projection rise onto the horizon.
  const ledger = world.ledger;
  const [prevLedger, setPrevLedger] = useState(ledger);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [firstPaint, setFirstPaint] = useState(true);
  if (ledger !== prevLedger) {
    const before = new Set((prevLedger ?? []).map((e) => e.id));
    setNewIds(new Set((ledger ?? []).filter((e) => !before.has(e.id)).map((e) => e.id)));
    setPrevLedger(ledger);
    setFirstPaint(false);
  }

  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.key, i])), [lanes]);

  const cells = useMemo(() => {
    const m = new Map<string, LedgerEntry[]>();
    for (const e of world.ledger ?? []) {
      const lane = laneOf(world, e);
      if (!laneIndex.has(lane)) continue;
      const k = `${lane}|${e.learnedDay}`;
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (IMPORTANCE[a.type] ?? 9) - (IMPORTANCE[b.type] ?? 9));
    return m;
  }, [world, laneIndex]);

  const late = useMemo(() => (world.ledger ?? []).filter((e) => e.late && e.learnedDay > e.occurredDay), [world.ledger]);

  const cols = compact ? 2 : 3;
  const maxShown = cols * 3;
  const sp = compact ? 5 : Math.min(7, Math.max(5, dayW / 5.5));
  const r = compact ? 1.8 : 2.4;

  const dots: React.ReactNode[] = [];
  const overflow: React.ReactNode[] = [];
  let newCount = 0;
  for (const [k, arr] of cells) {
    const [lane, dayStr] = k.split("|");
    const li = laneIndex.get(lane) ?? 0;
    const day = Number(dayStr);
    const cx0 = x(day);
    const cy0 = laneY(li);
    const color = lanes[li].color;
    const shown = arr.length > maxShown ? arr.slice(0, maxShown - 1) : arr;
    const rows = Math.ceil(shown.length / cols);
    shown.forEach((e, i) => {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? shown.length - row * cols : cols;
      const col = i % cols;
      const cx = cx0 + (col - (inRow - 1) / 2) * sp;
      const cy = cy0 + (row - (rows - 1) / 2) * sp;
      const isNew = newIds.has(e.id);
      const delay = isNew ? newCount++ : 0;
      dots.push(
        <g key={e.id} className={`dm-hz-dot${isNew ? " is-new" : ""}${firstPaint ? " is-first" : ""}`} style={{ ["--i" as string]: Math.min(delay, 40) }}>
          <title>{`Day ${e.learnedDay}: ${e.label}${e.late ? ` (happened Day ${e.occurredDay}, learned Day ${e.learnedDay})` : ""}`}</title>
          <Glyph e={e} cx={cx} cy={cy} color={color} r={r} />
        </g>,
      );
    });
    if (arr.length > shown.length) {
      overflow.push(
        <text key={`o-${k}`} x={cx0 + ((cols - 1) / 2) * sp + 6} y={cy0 + 3} className="dm-hz-more">
          +{arr.length - shown.length}
        </text>,
      );
    }
  }

  // Late arcs: from occurredDay to learnedDay, labelled once per landing cell.
  const labelled = new Set<string>();
  const arcs = late
    .slice()
    .sort((a, b) => b.learnedDay - b.occurredDay - (a.learnedDay - a.occurredDay))
    .map((e) => {
      const lane = laneOf(world, e);
      const li = laneIndex.get(lane);
      if (li === undefined) return null;
      const y = laneY(li);
      const x1 = x(e.occurredDay);
      const x2 = x(e.learnedDay);
      const span = Math.abs(x2 - x1);
      const h = Math.min(compact ? 30 : 44, 14 + span * 0.28);
      const mid = (x1 + x2) / 2;
      const key = `${lane}|${e.learnedDay}`;
      const showLabel = !labelled.has(key) && span >= 64 && Math.abs(mid - x(handleDay)) > 70;
      labelled.add(key);
      const isNew = newIds.has(e.id);
      return (
        <g key={`arc-${e.id}`} className={`dm-hz-arc${isNew ? " is-new" : ""}`}>
          <path d={`M${x1} ${y} Q${mid} ${y - h * 2} ${x2} ${y}`} pathLength={1} />
          <circle cx={x1} cy={y} r={3.2} className="dm-hz-arc-origin" />
          {showLabel && (
            <text x={mid} y={y - h - 6} textAnchor="middle" className="dm-hz-arc-label">
              learned late
            </text>
          )}
        </g>
      );
    });

  const ticks: React.ReactNode[] = [];
  for (let d = 0; d <= H; d++) {
    const major = d % 7 === 0 || d === H;
    const labelIt = compact ? d % 5 === 0 : dayW >= 26 || d % 2 === 0;
    ticks.push(
      <g key={`t${d}`} className={d > clockDay ? "dm-hz-tick is-future" : "dm-hz-tick"}>
        <line x1={x(d)} x2={x(d)} y1={axisY - (major ? 5 : 3)} y2={axisY + (major ? 5 : 3)} />
        {labelIt && (
          <text x={x(d)} y={axisY + (compact ? 18 : 21)} textAnchor="middle" className={d === asOf ? "is-current" : undefined}>
            {d}
          </text>
        )}
      </g>,
    );
  }

  // Scrubbing on the axis track and the handle.
  const dragging = useRef(false);
  const dayFromClientX = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const d = Math.round(((px - padL) / plotW) * H);
    return Math.max(0, Math.min(clockDay, d));
  };
  const onPointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    dragging.current = true;
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    onScrub(dayFromClientX(ev.clientX, wrap), false);
  };
  const onPointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !wrapRef.current) return;
    onScrub(dayFromClientX(ev.clientX, wrapRef.current), false);
  };
  const onPointerUp = (ev: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !wrapRef.current) return;
    dragging.current = false;
    onScrub(dayFromClientX(ev.clientX, wrapRef.current), true);
  };
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    let d = handleDay;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") d -= 1;
    else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") d += 1;
    else if (ev.key === "PageDown") d -= 7;
    else if (ev.key === "PageUp") d += 7;
    else if (ev.key === "Home") d = 0;
    else if (ev.key === "End") d = clockDay;
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    onScrub(Math.max(0, Math.min(clockDay, d)), true);
  };

  const [hint, setHint] = useState(false);
  const hx = x(handleDay);
  const atNow = handleDay >= clockDay;

  return (
    <div className={`dm-horizon${world.isTimeTravel ? " is-travel" : ""}`} ref={wrapRef}>
      <svg className="dm-hz-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Horizon: ${world.ledger?.length ?? 0} ledger events from Day 0 to Day ${H}. Clock at Day ${clockDay}.`}>
        <defs>
          <pattern id="dm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--lv-gold)" strokeWidth="1" opacity="0.16" />
          </pattern>
        </defs>
        {lanes.map((l, i) => (
          <g key={l.key} className="dm-hz-lane">
            <line x1={x(0)} x2={x(H)} y1={laneY(i)} y2={laneY(i)} />
            <circle cx={compact ? 8 : 12} cy={laneY(i)} r={3} fill={l.color} />
            <text x={compact ? 16 : 22} y={laneY(i) + 4} className="dm-hz-lane-label">
              {compact ? l.short : l.label}
            </text>
          </g>
        ))}
        {world.isTimeTravel && (
          <g className="dm-hz-unknown-zone">
            <rect x={x(asOf)} y={top - 22} width={Math.max(0, x(clockDay) - x(asOf))} height={axisY - top + 22} fill="url(#dm-hatch)" />
            {x(clockDay) - x(asOf) > 90 && (
              <text x={(x(asOf) + x(clockDay)) / 2} y={top - 26} textAnchor="middle" className="dm-hz-zone-label">
                not yet known on Day {asOf}
              </text>
            )}
          </g>
        )}
        {arcs}
        {dots}
        {overflow}
        <rect className="dm-hz-future" x={x(clockDay) + 1} y={0} width={Math.max(0, x(H) - x(clockDay) + padR)} height={axisY - 2} />
        {H - clockDay >= 4 && !compact && (
          <text x={(x(clockDay) + x(H)) / 2} y={top - 26} textAnchor="middle" className="dm-hz-zone-label">
            not lived yet
          </text>
        )}
        <line className="dm-hz-axis" x1={x(0)} x2={x(clockDay)} y1={axisY} y2={axisY} />
        <line className="dm-hz-axis is-future" x1={x(clockDay)} x2={x(H)} y1={axisY} y2={axisY} />
        {ticks}
        <text x={compact ? 8 : 12} y={axisY + 4} className="dm-hz-axis-label">
          Day
        </text>
      </svg>

      <div
        className="dm-hz-track"
        style={{ left: 0, right: 0, top: axisY - 18, height: 36 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseEnter={() => setHint(true)}
        onMouseLeave={() => setHint(false)}
        aria-hidden="true"
      />

      <div className={`dm-hz-handle${atNow ? " is-now" : ""}${pending ? " is-pending" : ""}`} style={{ left: hx, top: top - 22, height: axisY - top + 22 }}>
        <div className="dm-hz-handle-line" />
        <div className="dm-hz-handle-chip">{atNow ? `Now, Day ${clockDay}` : `Day ${handleDay}`}</div>
        <div
          className="dm-hz-knob"
          role="slider"
          tabIndex={0}
          aria-label="Time machine: choose a day to see what the agent knew then"
          aria-valuemin={0}
          aria-valuemax={clockDay}
          aria-valuenow={handleDay}
          aria-valuetext={atNow ? `Now, Day ${clockDay}` : `Day ${handleDay}, as the agent knew it`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <div className="dm-hz-legend">
        <span className="lv-eyebrow dm-hz-eyebrow">The Horizon</span>
        <span>
          <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="var(--lv-a)" /></svg>
          Ledger event
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="3" fill="var(--lv-b)" stroke="var(--lv-ok)" strokeWidth="1.3" /></svg>
          Qualified
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1 L11 6 L6 11 L1 6 Z" fill="var(--lv-gold)" /></svg>
          Belief
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1 L11 6 L6 11 L1 6 Z" fill="none" stroke="var(--lv-cream)" /></svg>
          Lesson
        </span>
        <span>
          <svg width="22" height="10" viewBox="0 0 22 10"><path d="M1 9 Q11 -3 21 9" fill="none" stroke="var(--lv-gold)" strokeDasharray="2 2" /></svg>
          Learned late
        </span>
        <span className="dm-hz-legend-hint">{hint ? "Click or drag the line to travel in time" : "Drag the handle or use arrow keys to travel in time"}</span>
      </div>
    </div>
  );
}
