# COMPASS · Vertical cinema v1

Local redesign, September 17, 2026. One shared vertical scene system for `/` and
`/#present`. Supersedes the separate horizontal presentation direction.
Every spoken line, inferred state and recommendation below is a SCRIPTED CONCEPT.
No live voice backend has been verified. `/demo` exposes the existing guided demo.

| # / scene | Purpose | Visual | Motion in | Interaction | Motion out | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 01 Chaos | Start with a real uncertain commitment | Same adult heroine, dark jacket, desk/phone; sparse fragments “Friday / client / payment” | Immediate full-height human image, subtle push | Scroll or Play story | Vertical aperture tightens around phone | Concept footage |
| 02 Speak | Remove the perfect-prompt burden | Close profile, same woman and room, “The client wants Friday…” | Match phone position; portrait comes into focus | Manual scroll takes over | Room darkens, phone highlight aligns with orb | Scripted conversation |
| 03 Appear | Introduce COMPASS | One luminous orb, black space | Human world wipes upward into sphere | Pause motion available | Sphere persists, waveform grows | Concept visualization |
| 04 Listen | Make space for unfinished thought | Orb and short line “I’m not sure I can say yes.” | Light traces waveform vertically into view | Scroll or keyboard | Words move into context positions | Simulated listening, no microphone |
| 05 Understand | Separate fact from assumption | Friday requested stays fixed; Deadline? remains tentative | Scattered fragments settle into precise positions | Can move freely between scenes | Deadline becomes the correction target | Prepared context state |
| 06 Correction | The important turn | “No, actually… Friday’s fine. It’s the payment.” | Fast strike and replacement, fact stays visible | Correct assumption button selects prepared correction | Payment survives; other noise clears | Scripted correction, not live interruption |
| 07 Clarity | Make the next question relevant | “What payment terms would help?” | Noise masks away from center | Scroll without waiting | Two terms align | Scripted question |
| 08 Decision | Person chooses terms | 50% upfront / 50% on delivery, orb aligns beneath | Two clean typographic statements resolve | Human choice is explicit, no success claim | Terms expand vertically into draft | Prepared example |
| 09 Action | Deliver a concrete next step | Real HTML editable reply, NOT SENT | Full-viewport dark-to-light vertical wipe | Edit draft; resetting is explicit | Draft plane recedes; human scene wipes upward | Working local editing, simulated response |
| 10 Real life | Return attention to work | Same woman sets phone down and returns to laptop | Full-height human footage replaces draft through vertical wipe | Scroll to product | Camera movement matches interface reveal | Concept footage |
| 11 Product | Show exactly what is testable | Actual local guided UI vocabulary, link to canonical /demo | Human frame becomes clean product plane | Open guided demo; film link retained | Interface frame expands into black | Working prepared demo, live voice unbuilt |
| 12 CTA | Clear next action and truth | COMPASS orb, “Find your next step.” | Full-screen mask closes around persistent orb | Open scripted demo / Replay story | Replay returns to first scene | Concept; latency/memory/actions unbuilt |

## New media plan

Three matched 16:9 keyframes using existing heroine as identity reference:
A: uncertainty at desk; B: speaking profile; C: returning to work.
Each becomes one 6-second 1080p silent Seedance 2.5 clip. No generated UI/text.
Three source clips are reused across 12 authored states. Orb, typography,
context and actual UI stay crisp native HTML/SVG/CSS, not generated pixels.
Maintain black tailored jacket, dark top, low bun, same phone and blue-hour room.
On mobile crop around face/device with responsive focal positions.

MCP verified: GPT Image 2 supports reference images; 2K High costs 6.5 credits.
Seedance 2.5 supports start/reference images, 4–30 seconds, 1080p; the prepared
6-second silent reference task estimates 54 credits. Total for 3+3: 181.5.
New cap requested: 200. No submission before approval; no paid retries.

## Motion and load rules

Native scroll is the source of truth. No wheel interception, no forced snapping
that prevents reading/editing. Arrow/Page/Home/End navigation moves vertically.
Presentation is a user-initiated autoplay of the same scene positions. Wheel,
touch, keyboard and interaction interrupt it immediately. Page hidden pauses it.
Reduced motion uses discrete readable states/posters, no autoplay or parallax.
Pause control stops looping media and decorative movement.
Only active/adjacent video is eligible for load; offscreen clips pause.
Use local optimized muted H.264 MP4, faststart, short GOP and poster fallback.
