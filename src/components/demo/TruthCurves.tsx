"use client";

import type { CurvePoint, WorldView } from "@/contract";
import { laneColor, money } from "./format";
import { useWidth } from "./hooks";

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const steps = [100, 200, 250, 400, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000];
  for (const s of steps) if (v <= s) return s;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

function pathFor(points: CurvePoint[], pick: (p: CurvePoint) => number | null, x: (d: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    const v = pick(p);
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p.day).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

interface EndLabel {
  key: string;
  y: number;
  x: number;
  text: string;
  color: string;
  solid: boolean;
}

function spreadLabels(labels: EndLabel[], minGap: number, lo: number, hi: number): EndLabel[] {
  const out = labels.slice().sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < minGap) out[i].y = out[i - 1].y + minGap;
  const overflow = out.length ? out[out.length - 1].y - hi : 0;
  if (overflow > 0) for (const l of out) l.y -= overflow;
  for (const l of out) l.y = Math.max(lo, l.y);
  return out;
}

export function TruthCurves({ world }: { world: WorldView }) {
  const [ref, width] = useWidth<HTMLDivElement>(700);
  const compact = width < 520;
  const horizon = Math.max(1, world.clock.horizonDays || 30);
  // Zoom to the lived part of the horizon plus a little future, so early beats stay legible.
  const H = Math.min(horizon, Math.max(10, world.asOfDay + 3));
  const campaigns = world.campaigns ?? [];
  const series = campaigns.map((c) => ({ c, pts: world.curves?.byCampaign?.[c.id] ?? [] }));
  const all = series.flatMap((s) => s.pts.flatMap((p) => [p.cplUsd ?? 0, p.costPerQualifiedUsd ?? 0]));
  const yMax = niceMax(Math.max(100, ...all) * 1.08);

  const height = compact ? 230 : 280;
  const padL = compact ? 40 : 52;
  const padR = compact ? 70 : 96;
  const padT = 26;
  const padB = 30;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = height - padT - padB;
  const x = (d: number) => padL + (Math.max(0, Math.min(H, d)) / H) * plotW;
  const y = (v: number) => padT + plotH - (Math.max(0, Math.min(yMax, v)) / yMax) * plotH;
  const flip = world.curves?.flipDay ?? null;
  const asOf = world.asOfDay;

  const grid = [0.25, 0.5, 0.75, 1].map((k) => k * yMax);

  const ends: EndLabel[] = [];
  for (const { c, pts } of series) {
    const color = laneColor(c.key);
    const lastCpl = [...pts].reverse().find((p) => p.cplUsd !== null);
    const lastCpq = [...pts].reverse().find((p) => p.costPerQualifiedUsd !== null);
    if (lastCpl && lastCpl.cplUsd !== null) ends.push({ key: `${c.id}-cpl`, x: x(lastCpl.day), y: y(lastCpl.cplUsd), text: `${c.key} ${money(lastCpl.cplUsd)}`, color, solid: false });
    if (lastCpq && lastCpq.costPerQualifiedUsd !== null)
      ends.push({ key: `${c.id}-cpq`, x: x(lastCpq.day), y: y(lastCpq.costPerQualifiedUsd), text: `${c.key} ${money(lastCpq.costPerQualifiedUsd)}`, color, solid: true });
  }
  const labelX = x(Math.min(H, asOf)) + 10;
  const spread = spreadLabels(ends, 15, padT + 4, padT + plotH);

  const summary = series
    .map(({ c }) => `${c.key}: cost per lead ${money(c.cplUsd)}, cost per qualified lead ${money(c.costPerQualifiedUsd)}`)
    .join(". ");

  return (
    <section className="dm-card dm-curves" aria-labelledby="dm-curves-h">
      <header className="dm-card-head">
        <div>
          <h2 id="dm-curves-h" className="dm-card-title">
            Truth curves
          </h2>
          <p className="dm-card-sub">What the ad dashboard sees against what Longview waits for.</p>
        </div>
        {flip !== null && (
          <span className="lv-pill lv-pill--gold lv-num dm-flip-pill">
            <span className="lv-dot" />
            Rank flips on Day {flip}
          </span>
        )}
      </header>
      <div className="dm-curves-plot" ref={ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Truth curves as of Day ${asOf}. ${summary}.${flip !== null ? ` Rank flips on Day ${flip}.` : ""}`}>
          {grid.map((g) => (
            <g key={g} className="dm-cv-grid">
              <line x1={padL} x2={padL + plotW} y1={y(g)} y2={y(g)} />
              <text x={padL - 8} y={y(g) + 4} textAnchor="end">
                ${g >= 1000 ? `${g / 1000}k` : g}
              </text>
            </g>
          ))}
          <line className="dm-cv-base" x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)} />
          {Array.from(new Set([0, 7, 14, 21, 28, H].filter((d) => d <= H && (d === H || H - d >= 2)))).map((d) => (
            <text key={d} className="dm-cv-x" x={x(d)} y={height - 8} textAnchor="middle">
              Day {d}
            </text>
          ))}
          {asOf < H && <rect className="dm-cv-future" x={x(asOf)} y={padT - 6} width={x(H) - x(asOf)} height={plotH + 6} />}
          {flip !== null && flip <= asOf && (
            <g className="dm-cv-flip">
              <line x1={x(flip)} x2={x(flip)} y1={padT - 8} y2={padT + plotH} />
              <text x={x(flip) + (x(flip) > width - 180 ? -6 : 6)} y={padT - 12} textAnchor={x(flip) > width - 180 ? "end" : "start"}>
                Rank flips on Day {flip}
              </text>
            </g>
          )}
          {series.map(({ c, pts }) => {
            const color = laneColor(c.key);
            const cpl = pathFor(pts, (p) => p.cplUsd, x, y);
            const cpq = pathFor(pts, (p) => p.costPerQualifiedUsd, x, y);
            return (
              <g key={c.id}>
                {cpl && <path d={cpl} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="4 5" opacity={0.75} className="dm-cv-line" />}
                {cpq && <path d={cpq} fill="none" stroke={color} strokeWidth={2.2} className="dm-cv-line" />}
                {pts
                  .filter((p) => p.day === asOf && p.costPerQualifiedUsd !== null)
                  .map((p) => (
                    <circle key={`e${p.day}`} cx={x(p.day)} cy={y(p.costPerQualifiedUsd as number)} r={3.4} fill={color} />
                  ))}
              </g>
            );
          })}
          {spread.map((l) => (
            <g key={l.key} className="dm-cv-end">
              <line x1={l.x + 3} x2={labelX - 3} y1={ends.find((e) => e.key === l.key)?.y ?? l.y} y2={l.y} stroke={l.color} opacity={0.3} />
              <text x={labelX} y={l.y + 4} fill={l.color} className={l.solid ? "is-solid" : "is-dashed"}>
                {l.text}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {series.some(({ c }) => c.costPerQualifiedUsd === null) && (
        <p className="dm-curves-note">
          {(() => {
            const keys = series.filter(({ c }) => c.costPerQualifiedUsd === null).map(({ c }) => c.key);
            return keys.length > 1
              ? `${keys.join(" and ")} have no qualified lead yet, so cost per qualified lead is Unknown, not $0.`
              : `${keys[0]} has no qualified lead yet, so its cost per qualified lead is Unknown, not $0.`;
          })()}
        </p>
      )}
      <div className="dm-curves-legend">
        <span>
          <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
            <line x1="0" x2="26" y1="4" y2="4" stroke="var(--lv-muted)" strokeWidth="1.4" strokeDasharray="4 5" />
          </svg>
          Cost per lead: what the ad dashboard sees
        </span>
        <span>
          <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
            <line x1="0" x2="26" y1="4" y2="4" stroke="var(--lv-cream)" strokeWidth="2.2" />
          </svg>
          Cost per qualified lead: what Longview waits for
        </span>
        {campaigns.map((c) => (
          <span key={c.id}>
            <i className="dm-swatch" style={{ background: laneColor(c.key) }} />
            {c.key}: {c.name}
          </span>
        ))}
      </div>
    </section>
  );
}
