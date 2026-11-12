import { demoVideoUrl } from './demo-api.mjs';

const HERO_POSTER = '/assets/hero/compass-hero.jpg';
export const BUNDLED_WALKTHROUGH = {
  src: '/assets/demo/compass-walkthrough.mp4',
  poster: '/assets/demo/compass-walkthrough.jpg',
  captions: '/assets/demo/compass-walkthrough.vtt',
};

const MARKER = /<div\s+id="compass-video"[^>]*>\s*<\/div>/;
const HERO_LINKS = '<p class="hero-links"><a class="ghost" id="hero-secondary" href="#access">Request access</a><a class="ghost" href="/demo">Open full demo</a></p>';
const HERO_LINKS_WITH_WATCH = '<p class="hero-links"><a class="ghost" id="hero-secondary" href="#access">Request access</a><a class="ghost" href="#watch">Watch the demo</a><a class="ghost" href="/demo">Open full demo</a></p>';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function playerFor(raw) {
  if (raw === BUNDLED_WALKTHROUGH.src) return { kind: 'file', src: raw, bundled: true, type: 'video/mp4' };
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id ? { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
    const fromPath = url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : '';
    const id = url.searchParams.get('v') || fromPath;
    return id ? { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` } : null;
  }
  if (host === 'vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).pop();
    return id && /^\d+$/.test(id) ? { kind: 'frame', src: `https://player.vimeo.com/video/${id}` } : null;
  }
  if (/\.webm$/i.test(url.pathname)) return { kind: 'file', src: url.toString(), type: 'video/webm' };
  if (/\.ogv$/i.test(url.pathname)) return { kind: 'file', src: url.toString(), type: 'video/ogg' };
  if (/\.mp4$/i.test(url.pathname)) return { kind: 'file', src: url.toString(), type: 'video/mp4' };
  return { kind: 'frame', src: url.toString() };
}

function fileMedia(player) {
  const poster = player.bundled ? BUNDLED_WALKTHROUGH.poster : HERO_POSTER;
  const track = player.bundled
    ? `<track kind="captions" src="${esc(BUNDLED_WALKTHROUGH.captions)}" srclang="en" label="English" default>`
    : '';
  return `<video controls playsinline muted preload="none" poster="${esc(poster)}" width="1920" height="1080" aria-describedby="watch-note" title="COMPASS demo video">${track}<source src="${esc(player.src)}" type="${esc(player.type || 'video/mp4')}"></video>`;
}

export function videoBlock(raw) {
  const player = (raw && playerFor(raw)) || playerFor(BUNDLED_WALKTHROUGH.src);
  if (!player) return '';
  const media = player.kind === 'file'
    ? fileMedia(player)
    : `<img class="poster" src="${HERO_POSTER}" alt="" width="1536" height="1024"><a class="play" href="${esc(raw)}" data-embed="${esc(player.src)}">Play the demo</a>`;
  return `<section class="watch" id="watch" aria-labelledby="watch-title"><div class="wrap"><p class="eyebrow center">Watch the demo</p><h2 class="center reveal" id="watch-title">The walkthrough</h2><p class="watch-note" id="watch-note">A recording of the builder: a barbershop booking idea, the brief, the build, web and phone, then a darker revision. Spoken or typed.</p><div class="player" id="watch-player" data-state="ready">${media}</div></div></section>`;
}

export function applyHomepage(html, env = {}) {
  if (!MARKER.test(html)) return html;
  const configured = demoVideoUrl(env);
  const section = videoBlock(configured);
  if (!section) return html;
  return html.replace(MARKER, section).replace(HERO_LINKS, HERO_LINKS_WITH_WATCH);
}
