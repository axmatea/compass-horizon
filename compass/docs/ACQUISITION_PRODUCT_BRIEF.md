# COMPASS Acquisition product brief (preserved workflow)

Updated September 25, 2026. Implementation branch: codex/acquisition-engine.
The REMaster branch preserves this UI at /acquisition and /acquisition/app.
This brief describes the release candidate, not an assertion of production deployment.

## Positioning
COMPASS connects acquisition hypotheses to the quality of inbound conversations,
remembers why decisions changed, and revises the next test when delayed evidence
arrives. First workflow: demand for AI Media Global's AI implementation service.
Audience and willingness to pay remain hypotheses, not validated customer results.

**Promise:** Keep the next decision connected to what actually happened.

## Concrete problem
A form conversion can look successful before budget, fit, authority or timeline
is known. Later answers and changed rules must update qualification without
double-counting leads, erasing evidence or claiming an experiment has won.

## Release candidate behavior
- Invite-only email/password accounts with server-derived workspace identity.
- PostgreSQL projects, hypotheses, leads, evidence, versioned rules and decisions.
- Event deduplication and per-field time ordering.
- Durable provider jobs with checkpoint recovery and uncertain-outcome blocking.
- Nimble, Liquid and Tinybird adapters with strict schemas and redacted receipts.
- Human review before extracted fields become facts; deterministic qualification.
- Public synthetic demo and same-product guided tour.
- Early-access request persistence. $299/month proposed price; no payment flow.

## Not yet established
Production database availability, sponsor credentials, actual provider conformance,
live paid calls, production rollout, customer adoption and measurable ROI are
not established by code or mock tests. Consult the current verification report.
The first-cut UI is text-first; voice transport remains but microphone UI is not
claimed connected. No automatic ads, outbound sends, CRM or Meta writes.

## Visual and narrative direction
Warm light surfaces, graphite, cobalt, locally bundled Manrope. Four utility
screens: Mission / Experiments / Pipeline / Memory. Original typographic creative
cards, meaningful state transitions, reduced motion. No girl, orb, hero intro or
separate slide deck. Legacy presentation paths enter the guided tour.

The tour follows synthetic Mira: missing budget -> delayed $6,500 answer ->
qualified against $5,000 -> duplicate ignored -> threshold becomes $8,000 ->
qualification changes while the evidence is retained. Four leads do not prove a
winning campaign. Accelerated time and synthetic data remain visible.

## Ownership and sources
One integrator controls main and Railway. Workers do not independently deploy.
Repository: https://github.com/axmatea/compass
Existing production domain: https://mycompass.world
Contract: ACQUISITION_CONTRACT.md. Script: ACQUISITION_PITCH.md.
Release gates: ACQUISITION_RELEASE.md. Provider sources: ACQUISITION_PROVIDERS.md.
No current film should imply the previous voice-thinking-partner or site-builder
product is the new acquisition workflow.
