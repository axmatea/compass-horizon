'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import s from './deck.module.css';
import { Frame, SlideContent } from './Slides';
import { SLIDES, clock, timeline } from './content';

const N = SLIDES.length;
const NAV_EVENT = 'lv-deck-nav';
const TIMED = timeline().lines;

/* The URL hash (#1 .. #10) is the single source of truth for the current slide. */
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
const readHash = () => window.location.hash;
const serverHash = () => null;

function indexFromHash(hash: string): number {
  const m = /^#(?:slide-)?(\d+)$/.exec(hash);
  if (!m) return 0;
  return Math.min(N - 1, Math.max(0, Number(m[1]) - 1));
}

function go(i: number) {
  const next = Math.min(N - 1, Math.max(0, i));
  window.history.replaceState(null, '', `#${next + 1}`);
  window.dispatchEvent(new Event(NAV_EVENT));
}

function toggleFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    if (doc.exitFullscreen) void doc.exitFullscreen();
    else doc.webkitExitFullscreen?.();
  } else if (el.requestFullscreen) {
    void el.requestFullscreen().catch(() => undefined);
  } else {
    el.webkitRequestFullscreen?.();
  }
}

export default function Deck({ print }: { print: boolean }) {
  if (print) return <PrintDeck />;
  return <PresentDeck />;
}

function PrintDeck() {
  return (
    <main className={s.print}>
      <style>{'@page { size: 1920px 1080px; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; background: #0d0d0c !important; }'}</style>
      {SLIDES.map((slide, i) => (
        <section key={slide.key} className={s.printSlide} aria-label={`Slide ${i + 1}: ${slide.title}`}>
          <Frame index={i} />
          <div className={s.slide}>
            <SlideContent index={i} print />
          </div>
        </section>
      ))}
    </main>
  );
}

function PresentDeck() {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  const index = hash === null ? null : indexFromHash(hash);
  const [notes, setNotes] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const current = index ?? 0;

  const next = useCallback(() => go(current + 1), [current]);
  const prev = useCallback(() => go(current - 1), [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case 'ArrowDown':
          e.preventDefault();
          next();
          break;
        case ' ':
          e.preventDefault();
          if (e.shiftKey) prev();
          else next();
          break;
        case 'ArrowLeft':
        case 'PageUp':
        case 'ArrowUp':
          e.preventDefault();
          prev();
          break;
        case 'Home':
          e.preventDefault();
          go(0);
          break;
        case 'End':
          e.preventDefault();
          go(N - 1);
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          setNotes((v) => !v);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('a, button')) return;
    next();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const p = e.changedTouches[0];
    const ddx = p.clientX - start.x;
    const ddy = p.clientY - start.y;
    if (Math.abs(ddx) > 50 && Math.abs(ddx) > Math.abs(ddy)) {
      e.preventDefault();
      if (ddx < 0) next();
      else prev();
    }
  };

  const slide = SLIDES[current];
  const lines = TIMED.filter((l) => l.slide === slide.n);
  const upNext = SLIDES[current + 1];
  const firstLine = lines.find((l) => l.say)?.say;

  return (
    <main className={`${s.deck} ${s.animate}`}>
      <div
        className={s.viewport}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-roledescription="slide deck"
      >
        <div className={s.stage} role="region" aria-roledescription="slide" aria-label={`Slide ${current + 1} of ${N}: ${slide.title}`}>
          <Frame index={current} />
          {index !== null && (
            <div key={current} className={s.slide}>
              <SlideContent index={current} />
            </div>
          )}
          <div className={s.progressTrack} />
          <div className={s.progress} style={{ width: `${((current + 1) / N) * 100}%` }} />
        </div>
        {index !== null && firstLine && (
          <p className={s.caption} aria-hidden>
            {firstLine}
          </p>
        )}
        <p className={s.hint}>Tap or swipe to move. Rotate for a larger view.</p>
        <p className={s.srOnly} aria-live="polite">
          {index !== null ? `Slide ${current + 1} of ${N}: ${slide.title}` : ''}
        </p>
      </div>
      {notes && (
        <aside className={s.notes} aria-label="Speaker notes">
          <div className={s.notesHead}>
            <span>
              <strong>
                Slide {current + 1} of {N}
              </strong>{' '}
              {slide.title}
            </span>
            <span>{upNext ? `Next: ${upNext.title}` : 'Last slide'}</span>
            <span className={s.keys}>Arrows move · N notes · F full screen</span>
          </div>
          <div className={s.notesLines}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <span className={s.notesTime}>{clock(l.t)}</span>
                <span className={s.notesWho}>{l.who}</span>
                {l.cue ? <span className={s.notesCue}>[{l.cue}]</span> : <span className={s.notesSay}>{l.say}</span>}
              </div>
            ))}
          </div>
          {slide.more && slide.more.length > 0 && (
            <ul className={s.notesMore}>
              {slide.more.map((m) => (
                <li key={m}>If asked: {m}</li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </main>
  );
}
