# COMPASS release notes

## COMPASS 2.0 product quality

The homepage starts with one prompt and reveals the real canvas on demand.
Starter preview cards, unused mock layouts and unreachable app-mode examples
were removed. The full builder uses a single persistent composer with text-only
example prompts, actual generation states and readable source labels.

Failed or incomplete requests preserve the last complete preview and retry text.
Exports remain tied to that preview; server-preview links wait for a matching
successful result. Source labels are withheld for interim renders until the final
result establishes their provenance. No arbitrary delay or fake progress is added.

Website generation uses domain-aware compositions for property, booking, creative
and food sites, with reusable neutral layout primitives. Typography, spacing and
mobile refinements change actual rendered CSS. Preview navigation and primary
actions target existing sections. Forms do not submit, reserve or charge; listing
and image placeholders are identified as such. Unapproved testimonials stay empty.

Production provider configuration and scriptless isolation are preserved. Accounts
are not enabled: [limited-access research](ACCESS_PREVIEW.md) specifies a separate
managed-auth preview and the required ownership/session tests. The
[media audit](COMPASS_2_MEDIA.md) records the exact promo identity and approval.

## White instrument foundation

This change keeps the existing plain-JavaScript/Vite/Node architecture and
production provider settings. Public routes are `/`, `/demo`, `/plan` and
`/studio`. The interface uses shared white/neutral tokens, restrained blue,
editable manual dictation, and a larger preview workspace. Completed previews
support brief copying, HTML export and explicit device-local project saving.
There is no account, cloud backup or external publishing. Artificial builder
and plan delays were removed.

The Studio page holds team and testimonial content separately from the product
homepage. Testimonial configuration is empty: approved wording, attribution and
an https public source are required before a statement renders.

## Media provenance

- **Approved founder promo:** `compass/public/assets/promo/compass-promo.mp4`, actual-frame JPG and English VTT. The founder confirmed YouTube `Y_D17IxUur8` and rights to all footage, voice and music. The 40.12-second 1080p H.264/AAC file is a lossless faststart remux, 8,033,810 bytes. The page labels it as an earlier product vision; it is not presented as a recording of the current builder. See [media verification](COMPASS_2_MEDIA.md) for hashes and caption review limits.

- **Historical walkthrough (retained asset):** `compass/public/assets/demo/compass-walkthrough.mp4`,
  poster JPG and English VTT captions, introduced in
  [PR #21](https://github.com/axmatea/compass-horizon/pull/21). It is the earlier
  39-second prepared-example recording, H.264, 1920×1080, about 3.12 MB, without
  audio. It was the earlier homepage default; the approved promo now replaces it. Native controls,
  a poster, captions, deferred metadata loading and no autoplay are retained.
  [PR #22](https://github.com/axmatea/compass-horizon/pull/22) contains a separate
  live-model recording and is outside this change; its media was not substituted.
- **Studio artwork:** `compass/public/assets/studio/compass-study.svg` wraps an
  embedded WebP generated with OpenAI ImageGen on 12 November 2026. Artist AI and
  Artlist were not used. It is conceptual brand art—a silver compass form on an
  off-white surface—not a manufactured product, photograph of a team member, or
  depiction of the application. The original was 1536×1024; Sharp encoded the
  delivery WebP at quality 85 without semantic edits. The 59,638-byte SVG contains
  no scripts or external references. Alt text: “Compass brand study”.
- **Fonts:** retained Inter and Sora licence texts remain in
  `compass/public/licenses/`. No third-party footage or music was added.

## Verification boundary

Automated tests cover speech lifecycle/error handling with mocks, safe local
storage, bounded brief restoration, streamed builds, four-page routes/assets and
testimonial publication guards. These checks do not prove physical microphone
capture. The founder will test dictation on the live site after deployment.
Use `compass/DEPLOYMENT.md` for release checks and rollback; record the final
commit/deployment evidence after it exists.
