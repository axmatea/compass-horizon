# COMPASS video handoff

## Current human-workspace release

The primary product has changed to a shared human workspace. No existing promo
or REMaster walkthrough demonstrates this new product. Use the stage text in
`src/finale/SPEAKER_SCRIPT.md`, `/presentation` and the current verified UI;
do not relabel an old video. The unified release is documented in FINAL_RELEASE.md.
No new paid media generation or video render is included in this release.

The notes below are retained for the separate `/demo/remaster` example only.

## Studio redesign note

The GPT Image studio redesign is implemented locally. The existing 180-second
REMaster MP4 below predates it and shows the old board. No replacement video was
rendered in the design-only turn. New UI captures are in
`delivery/remaster/studio-qa/`; generated assets and prompts are documented in
`docs/design/remaster-studio/manifest.json`. Before recording again, use the
current UI and recheck the capture script's selectors and framing.

## Existing game recording

The active release is now COMPASS REMaster. Record the real game using
`npm run record:remaster`, not the former acquisition tour. Deliver the raw
Playwright source, deterministic action script, timecoded manifest and
`delivery/remaster/COMPASS_REMaster_Walkthrough_180s_1080p.mp4`.

Target: 180 seconds, 1920x1080, 30 fps, H.264, silent for live narration using
`docs/REMASTER_PITCH.md`. The public game uses a synthetic team and scripted
simulation; day-30 loss is deliberate fault injection. Keep these labels visible.
The recording must show Start, Sarah's availability, archive, Doer/Shadow
disagreement, recovery, and the outcome actually produced by the fixture rules.
No real model execution, provider receipt, token savings or production readiness
may be inferred from this capture. Live integration is separately gated.

Use Playwright and FFmpeg, not a claimed Higgsfield or DaVinci MCP workflow.
Verify the completed file with ffprobe, full decode, and sampled frames. Large
files remain in ignored delivery/. Record the actual results in
`docs/REMASTER_VERIFICATION.md`; this specification is not proof of a render.

REMaster first cut is now rendered and verified: 179.967 seconds, 1920x1080,
30 fps H.264, silent. Output and raw-source manifest are in `delivery/remaster/`.
It shows the real fixture UI, not live agent execution. See the verification
report for capture scope and playback checks.

## Preserved acquisition recording

Priority: actual product walkthrough, not a new generated promo. The old film
depicts a different concept and is not evidence of this release's capabilities.

Deliver a 1920x1080, approximately 180-second H.264 MP4 recorded from the new
public guided tour. Keep synthetic and accelerated-time labels visible. Do not
imply this local fixture recording demonstrates live integrations or a server
restart. The separate stage script is ACQUISITION_PITCH.md.

The recording is a silent visual walkthrough intended for the two presenters'
live narration. No music, third-party footage, generated presenter or synthetic
voice is required; there are no audio licensing claims. Original UI/SVG assets
and local SIL-OFL Manrope are the only visuals.

The capture/render script must record actual browser interaction, retain its raw
recording, export with FFmpeg and verify duration, dimensions and successful
decoding. Store large outputs in ignored delivery/, not Git. Screenshots and a
JSON check report belong there too. Do not claim a rendered video until it exists.

No Higgsfield generation or DaVinci editing is necessary for this workflow; do
not claim either MCP was used. No spending or publishing is authorized here.

## First cut rendered

On 2026-09-25, `scripts/acquisition-record.mjs` produced
`delivery/COMPASS_Acquisition_Walkthrough_180s_1080p.mp4`: H.264, 1920x1080,
30 fps, exactly 180 seconds, silent. FFmpeg decoded the complete output without
errors. The source recording and metadata remain in ignored `delivery/`.
This is a local fixture walkthrough, not verified live sponsor footage.
