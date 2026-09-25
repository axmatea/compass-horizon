import type { Metadata } from 'next';
import '@/styles/tokens.css';
import s from './script.module.css';
import { FALLBACK, PRESHOW, QA, SLIDES, TARGET_SECONDS, WORDS_PER_MINUTE, clock, timeline, words } from '../deck/content';

export const metadata: Metadata = {
  title: 'Longview stage script',
  description: 'Three minute stage script for Longview, with click cues and judge Q&A.',
};

export default function ScriptPage() {
  const { lines, totalSeconds, spokenWords } = timeline();
  const fallbackSeconds = (words(FALLBACK.say) / WORDS_PER_MINUTE) * 60;

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <p className={s.kicker}>Longview · Long Horizon Agents hackathon</p>
        <h1 className={s.title}>Stage script, {clock(TARGET_SECONDS)}</h1>
        <p className={s.meta}>
          <strong>NAYL</strong> opens and closes. <strong>VINCENT</strong> drives the live demo. {spokenWords} spoken words,
          about {clock(totalSeconds)} at {WORDS_PER_MINUTE} words per minute including clicks. Lines in brackets are clicks,
          not words. Cues match the /demo stage bar.
        </p>
        <div className={s.horizon} aria-hidden />

        <section className={s.section}>
          <h2 className={s.h2}>Before going on</h2>
          <ul className={s.checklist}>
            {PRESHOW.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>The script</h2>
          {SLIDES.map((slide) => (
            <div key={slide.key} className={s.slide}>
              <p className={s.slideHead}>
                <b>Slide {slide.n}</b>
                <span>{slide.title}</span>
                {slide.key === 'demo' && <span>then the live demo</span>}
              </p>
              {lines
                .filter((l) => l.slide === slide.n)
                .map((l, i) => (
                  <div key={i} className={s.line}>
                    <span className={s.time}>{clock(l.t)}</span>
                    <span className={`${s.who} ${l.who === 'VINCENT' ? s.whoV : ''}`}>{l.who}</span>
                    {l.cue ? <p className={s.cue}>[{l.cue}]</p> : <p className={s.say}>{l.say}</p>}
                  </div>
                ))}
            </div>
          ))}
          <div className={s.line} style={{ borderTop: '1px solid var(--lv-line-strong)', paddingTop: 16 }}>
            <span className={s.time}>{clock(totalSeconds)}</span>
            <span className={s.who}>END</span>
            <p className={s.cue}>[Stay on slide 10 for questions]</p>
          </div>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>If the network fails ({Math.round(fallbackSeconds)} seconds)</h2>
          <div className={s.box}>
            <p className={s.boxLabel}>When</p>
            <p className={s.a}>{FALLBACK.when}</p>
            <p className={s.boxLabel} style={{ marginTop: 16 }}>
              Do
            </p>
            <p className={s.cue}>[{FALLBACK.cue}]</p>
            <p className={s.boxLabel} style={{ marginTop: 16 }}>
              {FALLBACK.who} says
            </p>
            <p className={s.say}>{FALLBACK.say}</p>
            <p className={s.a} style={{ marginTop: 14, color: 'var(--lv-muted)' }}>
              Then NAYL continues from slide 7 as written.
            </p>
          </div>
        </section>

        <section className={`${s.section} ${s.qaSection}`}>
          <h2 className={s.h2}>Judge Q&amp;A</h2>
          <ol className={s.qa}>
            {QA.map((item) => (
              <li key={item.q}>
                <p className={s.q}>{item.q}</p>
                <p className={s.a}>{item.a}</p>
              </li>
            ))}
          </ol>
        </section>

        <p className={s.foot}>
          Source of truth: src/app/deck/content.ts (also feeds the /deck speaker notes and docs/SCRIPT.md).{' '}
          <a href="/deck">Open the deck</a>
        </p>
      </div>
    </main>
  );
}
