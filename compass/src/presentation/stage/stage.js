import { CONFIG } from "./config.js";
import { SLIDES as FIVE, LINES, timing as timeDeck, speechSeconds } from "./slides.js";
import { SLIDES_V10, STATE_STRIP_V10 as STATE_STRIP, FIRST_INTENT_V10 as FIRST_INTENT } from "./archive/slides-v10.js";

const params = new URLSearchParams(location.search);
const PRESENTER = params.has("presenter");
const DEMO_URL = params.get("demo") || CONFIG.demoUrl;
const SLIDES = params.get("deck") === "v10" ? SLIDES_V10 : FIVE; // archived 10-scene deck stays runnable
const timing = () => timeDeck(SLIDES);
const isDemo = (S) => !!(S.demo || S.id === "demo");
const REC = CONFIG.recording;
const chan = "BroadcastChannel" in window ? new BroadcastChannel("compass-stage") : null;

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
// mask-reveal line: words wrapped so each can rise out of a clip
const line = (text, cls = "") => {
  const el = h("div", `ln ${cls}`);
  text.split(" ").forEach((w, i) => {
    const m = h("span", "m");
    const s = h("span", "w", w);
    s.style.setProperty("--i", i);
    m.append(s);
    el.append(m, document.createTextNode(" "));
  });
  return el;
};
const video = (src) => {
  const v = h("video", "bg-video");
  Object.assign(v, { src, muted: true, loop: true, playsInline: true, preload: "auto" });
  v.setAttribute("muted", "");
  return v;
};

// ---------- slide builders (each returns a <section>) ----------
const B = {
  founders() {
    const s = h("section", "slide s-founders");
    const f = CONFIG.founders;
    if (f.photo) {
      const img = h("img", "bg-photo");
      img.src = f.photo;
      img.alt = "";
      s.append(img, h("div", "shade"));
    }
    const names = h("div", "names");
    names.append(line(f.names[0], "xl"), h("span", "x", "×"), line(f.names[1], "xl"));
    const meta = h("div", "meta rv");
    meta.append(h("span", null, `${f.origin[0]} × ${f.origin[1]}`), h("i"), h("span", null, f.role));
    if (f.arr) meta.append(h("i"), h("b", null, f.arr));
    s.append(names, meta);
    return s;
  },
  human() {
    const s = h("section", "slide s-human media");
    s.append(video("/media/present/human-balcony.mp4"), h("div", "shade"), line("Does AI actually feel human?", "xl center"));
    return s;
  },
  problem() {
    const s = h("section", "slide s-problem media");
    s.append(video("/media/present/human-speak.mp4"), h("div", "shade"));
    const a = line("Humans change their minds.", "xl l1");
    const b = line("AI keeps executing.", "xl l2 step-1");
    s.append(a, b);
    return s;
  },
  action() {
    const s = h("section", "slide s-action");
    const flow = h("div", "flow");
    ["Request", "Plan", "Action"].forEach((n, i) => {
      const node = h("div", `node n${i}`);
      node.style.setProperty("--i", i);
      node.append(h("span", "node-label", n));
      if (i === 2) {
        const run = h("div", "run");
        run.append(h("i"));
        const job = h("div", "job", FIRST_INTENT.slice(2).join(" · "));
        node.append(run, job);
      }
      flow.append(node);
      if (i < 2) flow.append(h("span", `arrow a${i}`));
    });
    const said = h("div", "said step-2");
    said.append(h("small", null, "You, a second later"), h("span", null, "“Actually, make it 8.”"));
    const stale = h("div", "stale step-2", "still executing the old plan");
    s.append(flow, said, stale);
    return s;
  },
  compass() {
    const s = h("section", "slide s-compass");
    s.append(h("div", "wordmark", "COMPASS"), line("AI that adapts while acting.", "lg center step-1"));
    return s;
  },
  useful() {
    const s = h("section", "slide s-useful");
    s.append(line("Less talk.", "xxl u0"), line("Something useful.", "xxl u1 step-1"));
    return s;
  },
  app() {
    const s = h("section", "slide s-app");
    s.append(line("Actual application.", "lg center"));
    return s;
  },
  chain() {
    const s = h("section", "slide s-chain");
    const flow = h("div", "flow");
    [["Voice", "Boson"], ["Request", "GLM on Nebius"], CONFIG.app.verified ? ["Generated page", "COMPASS application"] : ["Updated plan", "COMPASS agent"]].forEach(([n, by], i) => {
      const node = h("div", `node n${i}`);
      node.style.setProperty("--i", i);
      node.append(h("span", "node-label", n), h("span", "node-by", by));
      flow.append(node);
      if (i < 2) flow.append(h("span", `arrow a${i}`));
    });
    s.append(flow);
    return s;
  },
  demo() {
    const s = h("section", "slide s-demo");
    s.append(line("Let me show you.", "lg center"));
    return s;
  },
  takeaway() {
    const s = h("section", "slide s-takeaway");
    const lines = h("div", "tk-lines");
    lines.append(line("It didn’t restart.", "xl t0"), line("It understood what changed.", "xl t1 step-1"));
    const strip = h("div", "strip step-2");
    const groups = { kept: "Preserve", updated: "Supersede", added: "Continue" };
    STATE_STRIP.forEach((r, i) => {
      const cell = h("div", `cell c-${r.status}`);
      cell.style.setProperty("--i", i);
      cell.append(h("small", null, r.label));
      const v = h("div", "vals");
      if (r.status === "updated") v.append(h("s", "old", r.from), h("b", "new", r.to));
      else if (r.status === "added") v.append(h("b", "new", r.to));
      else v.append(h("span", null, r.to));
      cell.append(v);
      strip.append(cell);
    });
    const verbs = h("div", "verbs step-2");
    Object.entries(groups).forEach(([k, label]) => {
      if (STATE_STRIP.some((r) => r.status === k)) verbs.append(h("span", `vb v-${k}`, label + "."));
    });
    s.append(lines, strip, verbs);
    return s;
  },
  stack() {
    const s = h("section", "slide s-stack");
    const layers = [
      ["Voice", ""],
      ["Boson", "realtime conversation · interruption", "step-1"],
      ["COMPASS", "mutable intent"],
      ["Nebius", "reasoning · replanning · tools", "step-2"],
      ["Action", ""],
    ];
    const col = h("div", "stack");
    layers.forEach(([name, cap, lit], i) => {
      const row = h("div", `layer ${lit ? "lit-" + lit : ""} ${name === "COMPASS" ? "core" : ""}`);
      row.style.setProperty("--i", i);
      row.append(h("span", "ly-name", name), h("span", "ly-cap", cap));
      col.append(row);
      if (i < layers.length - 1) {
        const ar = h("span", "down");
        ar.style.setProperty("--i", i);
        col.append(ar);
      }
    });
    s.append(col);
    return s;
  },
  partners() {
    const s = h("section", "slide s-partners");
    s.append(line("We’re not opening this to everyone.", "lg p0"), line("Design partners.", "xxl p1 step-1"));
    return s;
  },
  cta() {
    if (SLIDES === FIVE) {
      // final scene: orb, big COMPASS, small QR. Nothing else.
      const s = h("section", "slide s-end");
      const qr = h("img", "end-qr");
      qr.src = CONFIG.qr;
      qr.alt = `QR code: ${CONFIG.domain}`;
      const corner = h("div", "end-corner");
      corner.append(qr, h("span", null, CONFIG.domain));
      s.append(h("div", "end-mark", "COMPASS"), corner);
      return s;
    }
    const s = h("section", "slide s-cta");
    const qr = h("img", "qr rv");
    qr.src = CONFIG.qr;
    qr.alt = `QR code: ${CONFIG.domain}`;
    const right = h("div", "cta-right");
    if (SLIDES === FIVE) right.append(h("div", "domain big rv", CONFIG.domain)); // scene 5: COMPASS / domain / QR only
    else right.append(line("Build with us.", "lg"), h("div", "domain rv", CONFIG.domain));
    const row = h("div", "cta-row");
    row.append(right, qr);
    s.append(h("div", "wordmark", "COMPASS"), row, line("Thank you.", "lg center thanks step-1"));
    return s;
  },
};

// ---------- presenter view ----------
if (PRESENTER) {
  document.body.classList.add("presenter");
  document.title = "COMPASS · Presenter";
  const root = h("div", "pv");
  document.body.append(root);
  let st = { slide: 0, step: 0, overlay: null, demoArmed: "unknown", path: CONFIG.stagePath, rec: !!REC.src };
  const t0 = { all: 0, slide: Date.now() };
  const T = timing();
  const render = () => {
    const S = SLIDES[st.slide];
    const next = SLIDES[st.slide + 1];
    const el = (sec) => {
      const m = Math.floor(sec / 60);
      return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
    };
    const target = S.steps.reduce((a, x) => a + (x.live || speechSeconds(x.speech)), 0);
    root.innerHTML = "";
    const head = h("div", "pv-head");
    head.append(
      h("b", null, `${st.slide + 1} / ${SLIDES.length}  ${S.title}`),
      h("span", null, `step ${st.step + 1}/${S.steps.length}`),
      h("span", null, `slide ${el((Date.now() - t0.slide) / 1000)} / target ${el(target)}`),
      h("span", null, `total ${t0.all ? el((Date.now() - t0.all) / 1000) : "0:00"} / plan ${el(T.total)}`),
      h("span", `pv-demo ${st.demoArmed}`, `demo: ${st.overlay ? st.overlay.toUpperCase() + " ON SCREEN" : st.demoArmed}`),
      h("span", `pv-path ${st.path}`, `path: ${st.path.toUpperCase()} · recording: ${st.rec ? "ready" : "NONE"}`),
    );
    const speech = h("div", "pv-speech");
    S.steps.forEach((x, i) => {
      const p = h("p", i === st.step ? "now" : i < st.step ? "done" : "", x.speech);
      speech.append(p);
    });
    const side = h("div", "pv-side");
    side.append(h("small", null, "TRIGGER"), h("p", null, S.trigger), h("small", null, "MOTION"), h("p", null, S.motion), h("small", null, "MEDIA"), h("p", null, S.media));
    if (S.flag) side.append(h("small", "warn", "CHECK"), h("p", "warn", S.flag));
    if (isDemo(S)) {
      const say = st.overlay === "fallback" ? (st.path === "recorded" ? LINES.recordingFirst : LINES.liveFailure) : st.path === "recorded" ? LINES.recordingFirst : `If it stalls: R, then “${LINES.liveFailure}”`;
      side.append(h("small", null, "SAY"), h("p", "say", say));
    }
    side.append(h("small", null, "NEXT"), h("p", null, next ? `${next.title}: ${next.steps[0].speech}` : "End"));
    const btns = h("div", "pv-btns");
    [["← Prev", "prev"], ["Next →", "next"], ["Live run", "demo"], ["Recorded run", "fallback"], ["Close run", "close"], ["Switch path (M)", "path"], ["Black", "black"]].forEach(([t, cmd]) => {
      const b = h("button", null, t);
      b.onclick = () => chan?.postMessage({ type: "cmd", cmd });
      btns.append(b);
    });
    root.append(head, speech, side, btns);
  };
  chan?.addEventListener("message", (e) => {
    if (e.data.type === "state") {
      if (e.data.deck !== SLIDES.length) return; // a stage running another deck version
      if (e.data.slide !== st.slide) t0.slide = Date.now();
      if (!t0.all && (e.data.slide || e.data.step)) t0.all = Date.now();
      st = e.data;
      render();
    }
  });
  addEventListener("keydown", (e) => {
    const map = { ArrowRight: "next", PageDown: "next", " ": "next", ArrowLeft: "prev", PageUp: "prev", r: "fallback", d: "demo", Escape: "close", b: "black", m: "path" };
    if (map[e.key]) { e.preventDefault(); chan?.postMessage({ type: "cmd", cmd: map[e.key] }); }
  });
  setInterval(render, 1000);
  chan?.postMessage({ type: "hello" });
  render();
} else {
  // ---------- audience stage ----------
  const frame = h("div", "frame");
  const stage = h("div", "stage");
  const orb = h("div", "orb");
  ["core", "ring", "ring two", "glint"].forEach((c) => orb.append(h("div", "orb-" + c.replace(" ", " orb-"))));
  const slidesEl = SLIDES.map((S) => {
    const el = B[S.id]();
    el.dataset.id = S.id;
    return el;
  });
  const overlay = h("div", "overlay");
  const iframe = h("iframe", "demo-frame");
  iframe.allow = "microphone; autoplay";
  iframe.title = "COMPASS live demo";
  const fb = h("video", "demo-video");
  Object.assign(fb, { muted: !REC.hasAudio, playsInline: true, preload: "auto" });
  if (REC.src) fb.src = REC.src;
  const recLabel = h("div", "rec-label", REC.label); // recordings are always labelled on screen
  const back = h("button", "back", "Back to slides →");
  const z = Number(params.get("zoom")) || CONFIG.demoZoom;
  Object.assign(iframe.style, { width: `${1920 / z}px`, height: `${1080 / z}px`, transform: `scale(${z})`, transformOrigin: "0 0", inset: "auto", left: "0", top: "0" });
  fb.style.transform = `scale(${CONFIG.fallbackZoom})`;
  overlay.append(iframe, fb, recLabel, back);
  const black = h("div", "black");
  stage.append(...slidesEl, orb, overlay, black);
  frame.append(stage);
  document.body.append(frame);

  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(-50%,-50%) scale(${s})`;
  };
  addEventListener("resize", fit);
  fit();

  let cur = 0;
  let step = 0;
  let overlayMode = null; // null | "live" | "fallback"
  let demoArmed = "loading";
  let demoLoaded = false;
  let path = ["live", "recorded"].includes(params.get("path")) ? params.get("path") : CONFIG.stagePath;

  const broadcast = () => chan?.postMessage({ type: "state", slide: cur, step, overlay: overlayMode, demoArmed, path, rec: !!REC.src, deck: SLIDES.length });
  function apply(dir = 1) {
    slidesEl.forEach((el, i) => {
      el.classList.toggle("is-active", i === cur);
      el.classList.toggle("is-past", i < cur);
      for (let k = 1; k <= 4; k++) el.classList.toggle(`on-${k}`, i === cur && step >= k);
      const vids = el.querySelectorAll("video");
      vids.forEach((v) => {
        if (i === cur) {
          v.play().catch(() => {});
          if (SLIDES[i].id === "problem") step >= 1 ? v.pause() : v.play().catch(() => {});
        } else if (Math.abs(i - cur) > 1) v.pause();
      });
    });
    stage.dataset.orb = SLIDES[cur].orb;
    stage.dataset.slide = SLIDES[cur].id;
    stage.dataset.dir = dir;
    history.replaceState(null, "", `#${cur + 1}.${step}`);
    if (path === "live" && (isDemo(SLIDES[cur]) || SLIDES[cur + 1] && isDemo(SLIDES[cur + 1]))) armDemo();
    broadcast();
  }

  function armDemo() {
    if (iframe.src) return;
    iframe.src = DEMO_URL;
    const timer = setTimeout(() => { if (!demoLoaded) { demoArmed = "fallback"; broadcast(); } }, CONFIG.demoLoadTimeoutMs);
    iframe.addEventListener("load", () => {
      clearTimeout(timer);
      let d = null;
      try { d = iframe.contentDocument; } catch { d = null; } // cross-origin in dev: cannot inspect
      if (!d) { demoLoaded = true; demoArmed = "live"; broadcast(); return; }
      d.addEventListener("keydown", onDemoKey, true);
      // same-origin (production /demo): require the real COMPASS demo UI to have mounted
      let tries = 0;
      const check = () => {
        const ok = !!d.querySelector('[class^="cv-"],[class*=" cv-"]');
        if (ok || ++tries > 12) { demoLoaded = ok; demoArmed = ok ? "live" : "fallback"; broadcast(); }
        else setTimeout(check, 250);
      };
      check();
    }, { once: true });
  }
  // clicker keys inside the demo frame return to the slides; typing is untouched
  function onDemoKey(e) {
    if (e.key === "PageDown" || e.key === "PageUp") { e.preventDefault(); e.stopPropagation(); closeOverlay(e.key === "PageDown"); }
  }

  function openOverlay(mode) {
    if (mode === "live" && demoArmed !== "live") mode = "fallback";
    if (mode === "fallback" && !REC.src) { broadcast(); return false; } // no verified recording: stay on the slide
    overlayMode = mode;
    stage.classList.add("demo-open");
    overlay.dataset.mode = mode;
    if (mode === "fallback") { fb.currentTime = 0; fb.play().catch(() => {}); }
    else setTimeout(() => iframe.focus(), 700);
    broadcast();
  }
  function closeOverlay(advance = true) {
    if (!overlayMode) return;
    overlayMode = null;
    stage.classList.remove("demo-open");
    fb.pause();
    window.focus();
    if (advance && isDemo(SLIDES[cur])) go(cur + 1, 0);
    else broadcast();
  }
  back.onclick = () => closeOverlay(true);

  function go(i, s = 0) {
    const dir = i >= cur ? 1 : -1;
    if (SLIDES[cur].id === "action" && i === cur + 1) {
      slidesEl[cur].classList.add("collapsing");
      setTimeout(() => slidesEl.forEach((el) => el.classList.remove("collapsing")), 900);
    }
    cur = Math.max(0, Math.min(SLIDES.length - 1, i));
    step = Math.max(0, Math.min(SLIDES[cur].steps.length - 1, s));
    apply(dir);
  }
  function next() {
    if (overlayMode) return closeOverlay(true);
    const S = SLIDES[cur];
    if (isDemo(S) && step === 0) { step = 1; apply(); openOverlay(path === "recorded" ? "fallback" : "live"); return; }
    if (step < S.steps.length - 1) { step++; apply(); }
    else if (cur < SLIDES.length - 1) go(cur + 1, 0);
  }
  function prev() {
    if (overlayMode) return closeOverlay(false);
    if (step > 0) { step--; apply(-1); }
    else if (cur > 0) go(cur - 1, SLIDES[cur - 1].steps.length - 1);
  }
  const toDemo = () => { if (!isDemo(SLIDES[cur])) go(SLIDES.findIndex(isDemo), 1); else { step = 1; apply(); } };
  const cmds = {
    next, prev,
    demo: () => { toDemo(); openOverlay("live"); },
    fallback: () => { toDemo(); openOverlay("fallback"); },
    path: () => { path = path === "live" ? "recorded" : "live"; if (path === "live") armDemo(); broadcast(); },
    close: () => closeOverlay(false),
    black: () => stage.classList.toggle("blackout"),
  };
  chan?.addEventListener("message", (e) => {
    if (e.data.type === "cmd" && cmds[e.data.cmd]) cmds[e.data.cmd]();
    if (e.data.type === "hello") broadcast();
  });
  fb.addEventListener("ended", () => { fb.pause(); });

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(k)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp"].includes(k)) { e.preventDefault(); prev(); }
    else if (k === "Home") go(0);
    else if (k === "End") go(SLIDES.length - 1);
    else if (/^[0-9]$/.test(k)) go(k === "0" ? 9 : Number(k) - 1);
    else if (k === "m") cmds.path();
    else if (k === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
    else if (k === "d") cmds.demo();
    else if (k === "r") cmds.fallback();
    else if (k === "Escape") closeOverlay(false);
    else if (k === "b") cmds.black();
    else if (k === "p") window.open(`${location.pathname}?presenter${params.get("demo") ? "&demo=" + encodeURIComponent(DEMO_URL) : ""}`, "compass-presenter", "width=1280,height=800");
  });

  // deterministic start state from hash: #slide.step (1-based slide)
  const m = /^#(\d+)(?:\.(\d+))?$/.exec(location.hash);
  if (m) { cur = Math.min(SLIDES.length - 1, Number(m[1]) - 1); step = Number(m[2] || 0); }
  requestAnimationFrame(() => { document.body.classList.add("ready"); apply(); });
  addEventListener("hashchange", () => {
    const h = /^#(\d+)(?:\.(\d+))?$/.exec(location.hash);
    if (h && (Number(h[1]) - 1 !== cur || Number(h[2] || 0) !== step)) go(Number(h[1]) - 1, Number(h[2] || 0));
  });
  window.STAGE = { go, next, prev, open: openOverlay, close: closeOverlay, state: () => ({ slide: cur + 1, step, overlay: overlayMode, demoArmed, path, deck: SLIDES.length }), timing };
}
