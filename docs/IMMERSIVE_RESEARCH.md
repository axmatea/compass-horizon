# COMPASS immersive workspace research

Checked 13 November 2026. This review uses public pages and official documentation;
it does not include competitor signup, paid generation, private code or reused
competitor assets. Recommendations below are COMPASS design decisions, not claims
about another company's private implementation.

## References and evidence

| Reference | What is established | Transferable principle |
| --- | --- | --- |
| [impervum.com](https://impervum.com) | Initial fetch/DNS failed; a later real in-app browser session loaded the homepage and product-story navigation. Its public visual hierarchy and interaction affordances were inspected. Private architecture remains unknown. | Do not invent a visual review, substitute a similarly named company, infer a stack or copy assets. Browser observations belong in the release evidence if the main review can load it. |
| [musa-chat.com/clip](https://musa-chat.com/clip) | Initial fetch/DNS failed; the real in-app browser later loaded the exact clip page, including its example, seven-step explanation, track drop area and order summary. No upload or payment was made; private architecture remains unknown. | Preserve the exact reference URL; do not equate unrelated Musa/clip search results with this product. |
| [Lovable](https://lovable.dev), [editor documentation](https://docs.lovable.dev/features/projects/editor) | Public entry centers on a prompt. The documented editor centers chat and interactive preview, with code/files/history and project controls nearby. On smaller screens controls collapse; its mobile app uses separate swipeable areas. These are documented workflows, not authenticated hands-on results. | Make the canvas and conversation primary. Reveal code, history and settings when requested. Mobile should show a purposeful active view rather than compress three columns. |
| [Framer](https://www.framer.com), [animation lesson](https://www.framer.com/academy/lessons/framer-animations-overview) | Its public presentation shows a canvas, responsive sizes, agent and contextual styling. Official lessons distinguish simple layer effects, scroll effects and component states. [Published pages use React and pre-rendered HTML](https://www.framer.com/help/articles/make-site-readable-by-ai-agents/); this does not establish its private editor/orchestration architecture. | Show creation in place, then let visitors change the result. Keep viewport controls, current selection and styling controls spatially consistent. A React migration is unnecessary for this principle. |
| [Linear's March 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) | Its designers describe calmer navigation, more consistent headers/actions, fewer decorative icons and softer separation. [Its engineering team documents React applications migrating to StyleX](https://linear.app/now/styling-linear-for-the-future-stylex). These are published facts, not evidence COMPASS needs that stack. | Use one stable navigation and action hierarchy, quiet neutral surfaces, clear alignment and contextual details. Retain readable text sizes; do not copy smaller labels where that conflicts with the founder's request. |

The first browser session had no instrumented browser. After access returned, the root opened both exact URLs in hidden in-app tabs. Impervum showed a large typographic hero over a moving product collage, an explicit quiet/sound choice, numbered workflow stories and interactive product demos. Musa showed a large two-line headline, one portrait example, seven explained creation steps, a five-step order flow and a persistent order summary. No media, private source, claimed business metrics or prices were adopted. COMPASS takes the principles of one evolving product and visible steps while keeping its original white surface. A See the work interaction on Impervum unexpectedly landed on its Games page in that session; no successful ordering, uploading or authenticated product flow was claimed. Public architecture remains unverified beyond official sources linked below.

No timings, performance scores, authenticated failure behavior or private backend
architecture are inferred from these marketing pages. See
[the broader feature matrix](COMPETITIVE_NEXT.md) for account, usage and deployment
comparisons already researched.

## Original COMPASS direction

- Keep the white surface, approved Fold mark, readable typography and restrained
  indigo/blue accent. Prefer fewer visible actions and larger meaningful labels.
- Give the workspace one location bar and one view toolbar. Preview, Code and
  History are views of the same project, not separate projects. Put design and
  assets in contextual panels; make the separator keyboard-operable as well as
  draggable. Keep useful minimum widths and switch views on narrow screens.
- Studio should use a single evolving project: Idea → Build → Preview → Design
  → Refine → Export. Move a recognizable surface between those states rather
  than animate unrelated particles, generic artwork or decorative starter cards.
- Let visitors edit the prompt, choose an actual supported theme, use supported
  preview interactions, and continue through the existing bounded draft handoff.
  Never put the prompt in a URL. Account-owned state must retain owner checks.
- The prepared Studio sequence must be labeled as a demonstration. Actual
  generation progress must reflect real work. Export, preview, saving and
  publishing must remain distinct, with current persistence limits disclosed.
- Preserve the approved product film and provenance. A new interactive Studio
  does not require silently replacing its footage, soundtrack or captions.

These choices use existing COMPASS services. They do not create a second account,
billing, model, storage or generated-code execution system.

## Motion choice and licenses

| Option | Appropriate use and boundary | Decision |
| --- | --- | --- |
| Native CSS transitions/keyframes + [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate) | Short feedback and transitions between explicit UI states. `Element.animate()` returns controllable animation objects. Platform APIs add no animation-library runtime or third-party library license. | Preferred. Animate transform/opacity where practical; keep the final layout usable without motion. |
| [IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) + optional [CSS scroll timelines](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations) | The observer reports viewport intersections asynchronously. It is useful for activating a scene and pausing offscreen work; it is not a continuous pixel-accurate scroll timeline. Scroll timelines can progressively enhance supported browsers. | Start with normal document scrolling and a sticky canvas. Feature-detect enhancements; retain static sections and explicit scene controls. No scroll hijacking or required animation completion. |
| [Motion JavaScript](https://motion.dev/docs/animate) | Framework-independent `animate`, plus optional sequence/scroll helpers. Official docs distinguish `motion/mini` and the fuller `motion` import. The core repository has a verified [MIT license](https://github.com/motiondivision/motion/blob/main/LICENSE.md); retain notices if adopted. Separate commercial Motion+ material is not automatically covered. | Optional only if native orchestration becomes materially complex. No React dependency is needed for its JS API. Measure the actual built chunk rather than quote a marketing size as our bundle result. |
| GSAP / ScrollTrigger | Powerful sequencing, but its current [standard license](https://gsap.com/community/standard-license/) restricts no-code visual animation tools that materially assist a competing Webflow animation builder without written consent. It is not an MIT dependency. | Do not adopt as a permissive default for COMPASS's visual builder. Native APIs meet this release's needs. |
| Three.js / WebGL / React Three Fiber | No current Studio interaction requires a 3D renderer. GPU scenes introduce extra download, lifecycle and fallback work; a React renderer also conflicts with avoiding a framework rewrite for one effect. | Defer until a concrete product demonstration needs actual 3D. No library or asset adopted by this review. |

[Framer's official guidance](https://www.framer.com/academy/lessons/framer-animations-trigger-on-scroll)
also starts from a usable static composition and checks slow/fast scrolling,
replay and reduced motion. Its [reduced-motion settings](https://www.framer.com/help/articles/reduced-motion-settings/)
disable movement effects. For COMPASS: respect `prefers-reduced-motion` in CSS
and JS, react to preference changes, cancel ongoing animations, show final
content immediately, disconnect observers on teardown, and avoid continuous
offscreen work. Keyboard/touch controls must not depend on hover or a timeline.

## HTML/CSS editor: canonical parsing

Use **parse5 8.1.1**, verified against the official
[package manifest](https://raw.githubusercontent.com/inikulin/parse5/v8.1.1/packages/parse5/package.json),
[documentation](https://parse5.js.org/modules/parse5.html) and
[release](https://github.com/inikulin/parse5/releases/tag/v8.1.1).
The 7 November release fixes nineteen security-relevant parser/serializer issues;
its maintainers recommend updating applications that parse untrusted input.
Its actual [MIT license](https://raw.githubusercontent.com/inikulin/parse5/v8.1.1/LICENSE)
requires retained copyright and permission notices. Package 8.1.1 is ESM with an
`entities` dependency; old CommonJS examples in some API pages do not override
the current package export.

Useful API contract:

- Named ESM exports include `parse`, `parseFragment`, `serialize`,
  `serializeOuter` and `defaultTreeAdapter`.
- [`parseFragment`](https://parse5.js.org/functions/parse5.parseFragment.html)
  accepts a string/options or a context element/string/options. Context matters
  for table fragments. Full-document parsing can insert implied html/head/body.
- [`serialize(element)`](https://parse5.js.org/functions/parse5.serialize.html)
  emits its children; [`serializeOuter(element)`](https://parse5.js.org/functions/parse5.serializeOuter.html)
  includes the element. Canonical output is not source-format preservation.
- [`scriptingEnabled`](https://parse5.js.org/interfaces/parse5.ParserOptions.html)
  controls `noscript` parsing; it does not execute JavaScript. Source locations
  are optional, and implied nodes have no original location.

Recommended architecture: one pure HTML policy module used authoritatively by
Node and lazily by the editor through a literal dynamic import, which
[Vite supports](https://vite.dev/guide/features.html#dynamic-import). Keep it out
of the initial homepage/Studio path. Browser bundling is an implementation
recommendation, not a bundle-size or compatibility result measured by research.

**Parsing is not sanitizing.** Bound input size and tree complexity; explicitly
allow tags, attributes, namespaces and URL schemes; reject executable content,
event handlers, foreign/active embeds and network-capable CSS. Serialize the
validated tree rather than forwarding the original input. Reparse canonical
output and prove policy invariants with hostile/malformed fixtures and real
browser preview checks. Keep the scriptless iframe and strict CSP as independent
boundaries. A browser-only policy cannot authorize saved server content.

parse5 does not parse CSS. If full stylesheet editing needs an AST, **css-tree**
is an evaluated option: current official [manifest](https://github.com/csstree/csstree/blob/master/package.json)
shows 3.2.1; its [MIT license](https://github.com/csstree/csstree/blob/master/LICENSE)
and [Node/browser exports](https://github.com/csstree/csstree) are public.
Its [parser](https://github.com/csstree/csstree/blob/master/docs/parsing.md)
is tolerant and can preserve malformed input as `Raw` nodes. Reject parse
errors/Raw nodes and explicitly control properties, at-rules, functions and URLs;
syntax validity alone is not a security policy. A small conservative CSS subset
is preferable to implying arbitrary CSS or JavaScript support.

## Implementation acceptance evidence

Prove the same project survives prompt → preview → visual/code edit → revision
→ restore → save/reopen → export. Keep the last complete result and unsent edits
on errors. Test stale-response and account-switch guards, keyboard separators,
mobile active views, reduced-motion fallback and scene teardown. Verify actual
rendered desktop/mobile output and built download sizes; do not infer them from
the reference sites or dependency descriptions.
