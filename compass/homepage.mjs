import { demoVideoUrl } from './demo-api.mjs';

const POSTER = '/assets/hero/compass-hero.jpg';
const MARKER = /<div\s+id="compass-video"[^>]*>\s*<\/div>/;
const SECONDARY = '<a class="ghost" id="hero-secondary" href="#access">Request access</a>';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function playerFor(raw) {
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
  if (/\.(mp4|webm|ogv)$/i.test(url.pathname)) return { kind: 'file', src: url.toString() };
  return { kind: 'frame', src: url.toString() };
}

export function videoBlock(raw) {
  const player = playerFor(raw);
  if (!player) return '';
  const media = player.kind === 'file'
    ? `<video controls playsinline preload="metadata" poster="${esc(POSTER)}" src="${esc(player.src)}" title="COMPASS demo video"></video>`
    : `<img class="poster" src="${POSTER}" alt="" width="1536" height="1024"><a class="play" href="${esc(raw)}" data-embed="${esc(player.src)}">Play the demo</a>`;
  return `<section class="watch" id="watch" aria-labelledby="watch-title"><div class="wrap"><p class="eyebrow center">Watch the demo</p><h2 class="center reveal" id="watch-title">The walkthrough</h2><div class="player" id="watch-player" data-state="ready">${media}</div></div></section>`;
}

export function applyHomepage(html, env = {}) {
  if (!MARKER.test(html) && !html.includes('id="hero-secondary"')) return html;
  const configured = demoVideoUrl(env);
  const section = configured ? videoBlock(configured) : '';
  const out = html.replace(MARKER, section);
  if (!section) return out;
  return out.replace(SECONDARY, '<a class="ghost" id="hero-secondary" href="#watch">Watch the video</a>');
}
