# COMPASS Platform Tour — media and instruction provenance

This directory supplies the native sidebar guide. The stable entry point is
`/assets/tutorial/platform-tour.json`.

## Current media status

The manifest currently declares `kind: "interactive"` and `video: null`.
It is an instructional, chapter-based walkthrough using actual COMPASS product
screens. **It is not a screen recording.** The 165-second duration describes
an optional reading sequence, not recorded-video runtime.

No current instructional recording has been supplied with this asset version.
Native recording could not be captured reliably in the current environment.
The earlier promotional film and the separate screenshot montage are not used
as a substitute for such a recording. If a suitable real recording is provided,
verify its privacy, completeness and actual timings before changing `kind` to
`video` or assigning a same-origin MP4 URL.

## Content

Eleven chapters cover account creation/preferences, new projects, AI build,
chat refinement, design controls, responsive preview, versions, explicit save
and reopen, connection availability, export/publishing and measured usage.

Instructions describe the actual controls and distinguish website, data-app
and signed-in workspace contexts. They do not execute project actions, start
model calls, navigate away, connect providers, publish content or enable billing.

Work-tool connections are shown as unavailable/configuration-needed. Google
account sign-in is separate. Publishing controls describe saved static websites,
not unrestricted application hosting. Payments and credit purchases remain off;
no price, credit balance or active checkout is invented.

## Actual-screen assets

Screens are first-party COMPASS interface captures with a fictional NOVA website
and synthetic demonstration records. Account forms are empty. No owner profile,
password, API key, callback/reset URL, mailbox or real client data is included.
The source interface labels, including Saved preview or prepared output, remain
visible and are not relabeled as live generation.

WebP assets use proportional downscaling only when needed and format compression.
Interface content is not fabricated. Content-hashed filenames prevent stale
screen caches. Source and derived hashes are listed in `provenance.json`.

The usage chapter shows the actual Usage panel: accepted calls display measured
token counts; failed attempts retain Token counts unavailable. No credit balance
or result is fabricated.

The rasterized UI uses the product's existing Sora/Inter fonts. Their unmodified
OFL notices are preserved in `licenses/`. These assets contain no unrelated stock
footage, paid AI generation, generated presenter, music or synthetic transcript.

## Captions and maintenance

`platform-tour.vtt` contains the same chapter titles/instructions as the manifest.
Keep both files synchronized. Fetch the stable JSON with `cache: "no-store"`;
the content-hashed image URLs can be cached normally.

When product controls or provider availability change, revise the matching
instruction and actual capture together. Never use an available button alone
as evidence that a provider workflow completed. A missing capture must remain
explicit rather than being replaced by fabricated UI.
