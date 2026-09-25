// Swaps the YouTube fallback for the approved COMPASS film when /media/film/film.json says approved: true.
(async () => {
  try {
    const res = await fetch('/media/film/film.json', { cache: 'no-store' });
    if (!res.ok) return;
    const m = await res.json();
    if (m?.approved !== true || !m.src) return;
    const box = document.querySelector('#scene-film .yt');
    if (!box) return;
    const video = document.createElement('video');
    video.id = 'film';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    if (m.poster) video.poster = m.poster;
    if (m.title) video.setAttribute('aria-label', m.title);
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000';
    video.src = m.src;
    if (m.captions) {
      const track = document.createElement('track');
      track.kind = 'captions'; track.srclang = 'en'; track.label = 'English'; track.src = m.captions; track.default = true;
      video.appendChild(track);
    }
    box.replaceChildren(video);
    // Pause when the film scene leaves the viewport (app.js only pauses the YouTube iframe).
    new IntersectionObserver(([e]) => { if (!e.isIntersecting) video.pause(); }, { threshold: 0.2 }).observe(box);
  } catch { /* keep the YouTube fallback */ }
})();
