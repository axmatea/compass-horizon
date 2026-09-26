# Restored COMPASS concepts

User requested the earlier visual experience restored on mycompass.world without
another redesign. Two preserved concepts are now separately addressable:

- `/original`: warm six-seat office, shared plan and inspectable source memory.
- `/original/site`: early voice-thinking-partner site, film and scripted demo.
- `/original/site#present`: its original presentation mode.
- `/original/tour`: the six-scene office walkthrough.

Main site gains a link; existing /office, /app, voice, APIs, Horizon and the current
presentation are unchanged. The unfinished combined-world landing is not included.
These are explicitly concepts, not a newly connected AI backend or multi-user SaaS.
No assets were generated or purchased. Existing artwork and film are reused.

Verification: Vite/TypeScript build; 11 office/layout tests; 8 backend API tests;
browser clicks at 390/768/1440px, no horizontal overflow/page exceptions;
existing routes return 200; film range request returns 206.
Reproduce: `BASE_URL=http://localhost:8904 node scripts/original-qa.mjs`.

Canonical GitHub remains axmatea/compass-horizon. This release is from its compass/
subdirectory to the existing compass-web Railway service. At preflight Railway's
GitHub trigger still referenced axmatea/compass; do not push there. A manual upload
does not reconfigure that trigger. Future auto-deploy migration must correctly set
the canonical repository's compass/ root and preserve server configuration.
