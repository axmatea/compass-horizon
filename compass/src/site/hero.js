// COMPASS opening screen + story shots (owner: FRONTEND). No framework, no observers beyond what is needed.
import listen from './media/listen.mp4';
import listenPoster from './media/listen.jpg';
import interrupt from './media/interrupt.mp4';
import interruptPoster from './media/interrupt.jpg';
import cont from './media/continue.mp4';
import contPoster from './media/continue.jpg';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

// Hero video: reduced motion holds the first frame.
const art = document.querySelector('.cx-art');
function syncArt() { if (!art) return; if (reduce.matches) art.pause(); else art.play()?.catch(() => {}); }
syncArt();
reduce.addEventListener?.('change', syncArt);

// Retire the entrance once it has played, so a breakpoint change never replays it.
const last = document.querySelector('.cx-foot');
let retireTimer = setTimeout(retire, 3200);
function retire() { clearTimeout(retireTimer); last?.removeEventListener('animationend', onEnd); root.classList.add('cx-entered'); }
function onEnd(e) { if (e.target === last) retire(); }
last?.addEventListener('animationend', onEnd);

// Mobile menu: close after choosing a destination.
const toggle = document.getElementById('cx-nav');
document.querySelectorAll('.cx-panel a').forEach(a => a.addEventListener('click', () => { if (toggle) toggle.checked = false; }));

// Story chrome waits while the opening screen is in view; the hero video pauses once it is gone.
const hero = document.querySelector('.cx');
if (hero && 'IntersectionObserver' in window) {
  root.classList.add('at-hero');
  new IntersectionObserver(([e]) => {
    root.classList.toggle('at-hero', e.intersectionRatio > 0.35);
    if (art && !reduce.matches) { if (e.isIntersecting) art.play()?.catch(() => {}); else art.pause(); }
  }, { threshold: [0, 0.35, 0.6] }).observe(hero);
}

// Story shots: poster first, video only when near, playing only while visible.
const SHOTS = { listen: [listen, listenPoster], interrupt: [interrupt, interruptPoster], continue: [cont, contPoster] };
const figures = [...document.querySelectorAll('.shot[data-shot]')];
for (const fig of figures) {
  const [, poster] = SHOTS[fig.dataset.shot] || [];
  const img = fig.querySelector('img');
  if (img && poster) img.src = poster;
  fig.closest('.scene')?.classList.add('has-shot');
}
if ('IntersectionObserver' in window) {
  const near = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting || reduce.matches) continue;
      const fig = e.target, v = fig.querySelector('video');
      if (v && !v.src) {
        v.src = SHOTS[fig.dataset.shot][0];
        v.addEventListener('playing', () => v.classList.add('is-playing'), { once: true });
        v.addEventListener('error', () => v.remove(), { once: true });
      }
      near.unobserve(fig);
    }
  }, { rootMargin: '100% 0px' });
  const seen = new IntersectionObserver(entries => {
    for (const e of entries) {
      const fig = e.target, v = fig.querySelector('video');
      if (e.intersectionRatio > 0.25) fig.classList.add('is-in');
      if (!v || reduce.matches) continue;
      if (e.isIntersecting && v.src) v.play()?.catch(() => {}); else v.pause();
    }
  }, { threshold: [0, 0.25] });
  figures.forEach(f => { near.observe(f); seen.observe(f); });
} else figures.forEach(f => f.classList.add('is-in'));
