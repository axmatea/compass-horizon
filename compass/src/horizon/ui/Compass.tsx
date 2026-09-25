
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { loadSimulation, type Simulation } from "../sim";
import { usePrefersReducedMotion } from "./hooks";
import { Horizon } from "./Horizon";
import { readout } from "./story";

const Horizon3D = lazy(() => import("../three/Horizon3D"));
const PhoneView = lazy(() => import("../phone/PhoneView"));

type View = "2d" | "3d" | "phone";
const VIEWS: { id: View; label: string }[] = [
  { id: "2d", label: "2D" },
  { id: "3d", label: "3D" },
  { id: "phone", label: "Phone" },
];

function initialView(): View {
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "3d" || v === "phone" ? v : "2d";
}

function canWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const EMBED = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";

const STEP_MS = 600;
const KEY_PAUSE_MS = 2000;

function initialDay(lastDay: number): number {
  const q = new URLSearchParams(window.location.search).get("day");
  const n = q === null || q.trim() === "" ? NaN : Number(q);
  return Number.isFinite(n) ? Math.max(0, Math.min(lastDay, Math.round(n))) : lastDay;
}

export function Compass() {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const [view, setViewState] = useState<View>(initialView);
  const [webgl] = useState(canWebGL);

  const setView = useCallback((v: View) => {
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === "2d") url.searchParams.delete("view");
    else url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    let alive = true;
    loadSimulation().then((s) => {
      if (!alive) return;
      setDay(initialDay(s.lastDay));
      setSim(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Day-by-day replay, holding on the days where the story turns.
  useEffect(() => {
    if (!playing || !sim) return;
    const isKey = sim.keyDays.some((k) => k.day === day);
    const t = window.setTimeout(
      () => {
        const next = Math.min(sim.lastDay, day + 1);
        setDay(next);
        if (next >= sim.lastDay) setPlaying(false);
      },
      isKey ? KEY_PAUSE_MS : STEP_MS,
    );
    return () => window.clearTimeout(t);
  }, [playing, day, sim]);

  const togglePlay = useCallback(() => {
    if (!sim) return;
    if (playing) return setPlaying(false);
    if (day >= sim.lastDay) setDay(0);
    setPlaying(true);
  }, [sim, playing, day]);

  const jump = useCallback(
    (dir: -1 | 1) => {
      if (!sim) return;
      setPlaying(false);
      const days = sim.keyDays.map((k) => k.day);
      setDay((d) => (dir < 0 ? [...days].reverse().find((x) => x < d) : days.find((x) => x > d)) ?? d);
    },
    [sim],
  );

  const restart = useCallback(() => {
    setDay(0);
    setPlaying(true);
  }, []);

  const scrub = useCallback((d: number) => {
    setPlaying(false);
    setDay(d);
  }, []);

  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target instanceof Element ? ev.target : null;
      if (t?.closest("input, textarea, select, [role='slider']")) return;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        jump(-1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        jump(1);
      } else if (ev.key === " " && !t?.closest("button, a")) {
        ev.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, togglePlay]);

  const frame = sim ? sim.frameAt(day) : null;
  const read = frame ? readout(frame) : null;
  const caption = sim ? [...sim.keyDays].reverse().find((k) => k.day <= day)?.caption ?? "" : "";
  const atStart = !sim || day <= sim.keyDays[0].day;
  const atEnd = !sim || day >= sim.lastDay;

  const show3d = view === "3d" && webgl && !reducedMotion;
  const flat = sim && frame ? <Horizon frame={frame} day={day} lastDay={sim.lastDay} reducedMotion={reducedMotion} onScrub={scrub} /> : null;
  const switcher = (
    <div className="cp-views" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button key={v.id} type="button" className={view === v.id ? "cp-view is-on" : "cp-view"} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
          {v.label}
        </button>
      ))}
    </div>
  );

  if (view === "phone" && sim && frame) {
    return (
      <div className="cp-phone">
        <div className="cp-phone-bar">{switcher}</div>
        <Suspense fallback={<div className="cp-wait" />}>
          <PhoneView frame={frame} day={day} lastDay={sim.lastDay} caption={caption} playing={playing} reducedMotion={reducedMotion} onTogglePlay={togglePlay} onScrub={scrub} />
        </Suspense>
      </div>
    );
  }

  return (
    <main className={EMBED ? "cp is-embed" : "cp"} id="main">
      <header className="cp-head">
        <div className="cp-left">
          <div className="cp-mark">COMPASS</div>
          {!EMBED && <nav className="hz-return" aria-label="COMPASS navigation"><a href="/">Workspace</a><a href="/presentation">Presentation</a></nav>}
          {switcher}
        </div>
        <div className="cp-clock">
          <span className="cp-day" aria-live="polite">
            {sim ? `Day ${day}` : " "}
          </span>
          <span className="cp-honest">Simulation · illustrative percentages and revenue</span>
        </div>
      </header>

      <section className="cp-stage" aria-label="Horizon">
        {sim && frame ? (
          show3d ? (
            <Suspense fallback={flat}>
              <Horizon3D frame={frame} day={day} lastDay={sim.lastDay} reducedMotion={reducedMotion} onScrub={scrub} />
            </Suspense>
          ) : (
            flat
          )
        ) : (
          <div className="cp-wait" />
        )}
      </section>

      <footer className="cp-foot">
        <div className="cp-read" aria-live="polite">
          <div className="cp-readout">
            {read?.num && <span className="cp-num">{read.num}</span>}
            <span className={read?.num ? "cp-status" : "cp-status is-alone"}>{read?.status ?? " "}</span>
          </div>
          <p className="cp-caption">{caption || " "}</p>
        </div>

        <div className="cp-controls">
          <button type="button" className="cp-btn is-play" onClick={togglePlay} disabled={!sim} aria-keyshortcuts="Space">
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.5" y="3" width="3" height="10" rx="0.5" />
                <rect x="9.5" y="3" width="3" height="10" rx="0.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.8 L13 8 L4.5 13.2 Z" />
              </svg>
            )}
            <span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button type="button" className="cp-btn" onClick={() => jump(-1)} disabled={atStart} aria-keyshortcuts="ArrowLeft">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3 L5 8 L10 13" />
            </svg>
            <span>Back</span>
          </button>
          <button type="button" className="cp-btn" onClick={() => jump(1)} disabled={atEnd} aria-keyshortcuts="ArrowRight">
            <span>Next</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3 L11 8 L6 13" />
            </svg>
          </button>
          <button type="button" className="cp-btn is-quiet" onClick={restart} disabled={!sim}>
            Restart
          </button>
        </div>
      </footer>
    </main>
  );
}
