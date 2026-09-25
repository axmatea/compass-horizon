# Acquisition release contract

Public `/` is explicitly DEMO: local fixtures, zero provider calls. `/app` requires an invited email/password account. No billing, ad buying, sending, or private imported data.

## Browser API

All JSON requests use same-origin cookies. Errors: `{error: string, code?: string}` with proper 4xx/503 status. Server derives tenant from the session.

- GET `/api/acquisition/status`: `{database: "ready"|"blocked", integrations: [{name,status,operation,reason?}], billingEnabled:false}`. Public, no secrets.
- POST `/api/auth/sign-in/email`: `{email,password}` (Better Auth).
- POST `/api/auth/sign-out`: `{}`.
- GET `/api/auth/get-session`: Better Auth session or null.
- POST `/api/acquisition/accept-invite`: `{token,name,email,password}`; creates account and workspace, returns `{ok:true}`. Sign in next. No public signup.
- POST `/api/early-access`: `{email,name?,business?,consent:true}`; returns `{ok:true}` ONLY on durable save. 503 if no database.
- GET `/api/acquisition/state`: canonical state below.
- POST `/api/acquisition/projects`: `{name,goal,rules?:{minBudget:number,maxTimelineDays:number}}`. Creates/updates the account's one project. Empty workspace is allowed.
- POST `/api/acquisition/experiments`: `{name,hypothesis,audience,message}`.
- POST `/api/acquisition/leads`: `{name,experimentId?:string|null,problem?:string,decisionMaker?:boolean|null,budget?:number|null,timelineDays?:number|null,businessFit?:boolean|null}`. Unknown is null, not zero.
- POST `/api/acquisition/events`: `{source,externalId,leadId,occurredAt,fields:{problem?,decisionMaker?,budget?,timelineDays?,businessFit?}}`. Field order uses occurredAt; duplicate response `{duplicate:true,state}`. Mode server-controlled LIVE; synthetic stage data separately tagged DEMO.
- POST `/api/acquisition/runs`: `{operation:"research"|"extract"|"metrics",query?:string,text?:string,leadId?:string}` -> `{run}`. Missing provider returns BLOCKED run; no hidden fixtures.
- POST `/api/acquisition/runs/:id/resume`: resumes persisted checkpoint, does not repeat completed work.
- GET `/api/acquisition/metrics`: `{metrics}`. Local counts always marked PostgreSQL; sponsor-derived metrics labelled Tinybird only after real success.
- GET `/api/acquisition/events`: SSE `state` events with canonical state; session-bound.

## Canonical state

```ts
type State = {
  mode: 'DEMO' | 'LIVE';
  project: null | {id:string,name:string,goal:string,rules:{minBudget:number,maxTimelineDays:number},rulesVersion:number};
  experiments: {id:string,name:string,hypothesis:string,audience:string,message:string}[];
  leads: {id:string,name:string,experimentId:string|null,fields:{problem:string|null,decisionMaker:boolean|null,budget:number|null,timelineDays:number|null,businessFit:boolean|null},qualification:{status:'QUALIFIED'|'NEEDS_CONTEXT'|'NOT_ICP',reasons:string[],missing:string[],nextQuestion:string|null,rulesVersion:number},updatedAt:string}[];
  events: {id:string,source:string,externalId:string,leadId:string,occurredAt:string,receivedAt:string,mode:string}[];
  decisions: {id:string,recommendation:string,status:'insufficient_evidence'|'review',evidenceIds:string[],rulesVersion:number,createdAt:string}[];
  runs: {id:string,operation:string,status:'queued'|'running'|'completed'|'blocked'|'failed',checkpoint:string,reason?:string,result?:unknown,updatedAt:string}[];
  metrics: {source:string,totalLeads:number,qualified:number,unresolved:number,notIcp:number,unknownAttribution:number,sampleStatus:string,experiments:{experimentId:string,total:number,qualified:number}[]};
  integrations: {name:string,status:string,operation:string,reason?:string}[];
};
```

Public demo may use this exact shape locally. Every synthetic fixture and accelerated time jump is labelled. Sponsor status is not proof of a successful call. No invented receipt. No arbitrary tenant IDs, unknown budget coerced to zero, win claims, offline AI or automatic subscription promises.

## Ownership

Integrator: server.mjs, server/acquisition except providers, auth, migrations, contract, dependencies, Vite routing, deployment.
UI worker: src/acquisition/**, index.html, public/acquisition/**, public/manifest.webmanifest only.
Provider worker: server/acquisition/providers/**, test/acquisition-providers.test.mjs, docs/ACQUISITION_PROVIDERS.md only.
