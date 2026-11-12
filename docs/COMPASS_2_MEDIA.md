# COMPASS 2.0 media

The founder confirmed on 12 November 2026 that
[COMPASS — Build & Direct Software With Your Voice](https://www.youtube.com/watch?v=Y_D17IxUur8)
is the requested promo and that he holds rights to all footage, voice and music.
The homepage now uses this film, with native controls, inline mobile playback,
deferred loading and no autoplay. Its label is **Product film · Earlier vision**;
it is not presented as a recording of the current builder.

## Verified delivery

| File under `compass/public/assets/promo/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `compass-promo.mp4` | 8,033,810 | `a648caecce6408b2d39201aad307921e004b7cf8cfa4dea002355835c1b9d4c3` |
| `compass-promo.jpg` | 95,735 | `cb57650280cb79cba2637d49e28e728a3f2312ef00ef509db20d016719f588ac` |
| `compass-promo.en.vtt` | 395 | `7e04cfc1cfc46e9d5c6e700fde4699ca610a466fb82f106e98b52678a4481b33` |

The exact public YouTube ID and title were checked with official yt-dlp. Only
public video/audio formats were retrieved; no account credentials or browser
cookies were used. The source was preserved outside the repository. A lossless
stream-copy remux preserves its quality: H.264 High, yuv420p, 1920×1080, 30fps,
40.12 seconds; AAC-LC, 44.1kHz stereo, approximately 127kbps. Faststart is verified:
`moov` at byte 32 precedes `mdat` at 39,928. Full video/audio decode passed.

The JPG is the actual frame at 12 seconds, independently extracted and visually
checked. No synthetic film frame, third-party stock or new soundtrack was added.

The platform developer supplied a new seven-cue English VTT from word-level
speech recognition: five spoken lines and two music cues. The delivered text
matches its reported SHA-256 exactly. Cues fit the film duration. Two speech
starts differ from YouTube auto captions by about 1.5 seconds; those ASR timings
have not been manually checked by ear. Do not claim a human caption review.

The platform developer also supplied a 10,373,982-byte re-encode and a ZIP via
Grok Bot. Native attachment saving was unavailable during this run. This release
uses the independently retrieved source above rather than pretending that the
remote re-encode's bytes or hash were used.

## Distinct walkthroughs

- The previous 39-second prepared-example recording remains at
  `compass/public/assets/demo/compass-walkthrough.*`, introduced in PR #21. Its MP4
  SHA-256 is `587c41bbf0662b9c15d2ddcc707e24b5f612ad7825df3d9f716682a92d496ccb`.
  It is retained for coordination/history and is no longer the homepage default.
- [PR #22](https://github.com/axmatea/compass-horizon/pull/22) contains a separate
  32.6-second silent live-model walkthrough at head
  `ed79f19581a81afa30cc0e18d958980b0a1bd378`. Its MP4 is 3,161,638 bytes, SHA-256
  `1b3aeacd5582ba27ffad29137ea1777cadc952e72411b67bb4713dd4308ed5b7`.
  It was inspected and remains separate; it was not silently substituted or merged.
- Older 37.9/60/28-second clips in Git history and the separate 10-second hero loop
  are different assets. No new reuse permission for them is inferred from approval
  of this exact YouTube film.

An explicit valid HTTPS `DEMO_VIDEO_URL` still overrides the bundled promo.
Provider settings, domains and media source branches were not changed to enable it.
