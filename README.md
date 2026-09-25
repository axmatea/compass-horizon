# Longview

**The acquisition agent that waits for the truth.** Ads are judged on day one; customers arrive on day thirty. Longview keeps every experiment open until lead quality actually arrives, remembers what it believed and why, changes its mind with receipts when late evidence lands, and tightens its own decision rules when it learns it was fooled.

- Live: https://longview-agent.vercel.app
- Demo: https://longview-agent.vercel.app/demo (each visitor gets an isolated workspace)
- Deck: https://longview-agent.vercel.app/deck (N speaker notes, F fullscreen) · PDF: /deck/longview-deck.pdf
- Stage script: https://longview-agent.vercel.app/script · docs/SCRIPT.md
- Plan and critique (RU): docs/PLAN.ru.md · Product brief: LONGVIEW_BRIEF.md · Contract: src/contract.ts

## What is real, what is simulated
Simulated and labeled on screen: the campaign data (scenario `ai-media-q4`) and the clock. Real: the agent, the ledger in Neon Postgres, idempotency, late-event restatement, belief versions, lessons, the crash (`process.exit` on Vercel) and the resume. Sponsor calls show LIVE only after a real successful call; without credentials they show BLOCKED and the core keeps working.

## Long-horizon primitives
1. Ledger: one append-only bitemporal table (`occurred_at`, `learned_at`), idempotent by primary key.
2. Commitments: the agent schedules its own future work and wakes up to keep it.
3. Beliefs: versioned, Beta-posterior gate (INSUFFICIENT / LEANING / SUPPORTED), diffs, lessons that raise the policy version.
4. Crash-safe runs: 7 checkpointed steps, effects with deterministic keys, resume from the last checkpoint.
5. Time machine: `GET /api/state?asOf=<day>` re-projects the world as the agent knew it.

## Run locally
```
npm install
vercel env pull .env.local   # DATABASE_URL (Neon), STAGE_KEY, CRON_SECRET
npm test                     # 59 tests incl. one against the real Neon table
npm run build && npx next start
```

## Sponsor credentials (server-side env on Vercel)
- Nimble: `NIMBLE_API_KEY`
- Liquid AI: `LIQUID_API_KEY` + `LIQUID_BASE_URL` + `LIQUID_MODEL`, or `OPENROUTER_API_KEY` + `LIQUID_MODEL=liquid/...`
- Tinybird: `TINYBIRD_TOKEN` (+ `TINYBIRD_HOST`), setup files in `tinybird/`
Sponsor calls run only in the stage workspace (`/demo?stage=<STAGE_KEY>`) and LIVE workspaces; the public demo never spends paid APIs.

Built by AI Media Global.
