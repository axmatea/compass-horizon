# Tinybird deployment handoff

Prepared 2026-09-25. **Nothing deployed or provisioned.** No credentials are in
these files. Deployment, token creation, data import, billing and live query
checks require separate current approval.

## Files

- `datasources/acquisition_lead_versions.datasource`: append-only MergeTree with only pseudonymous IDs, mode, versions, qualification and tombstones.
- `pipes/acquisition_metrics.pipe`: backend endpoint with required `tenant_key` and `mode` parameters; deterministic latest state before aggregation.

No `TOKEN` directives are included because they can implicitly create
credentials. No fixtures, private data, materialized counter, mutable dimension
in a dedup key, or retention TTL is included. Query-time deduplication is
intentional: background merges must not determine whether dashboard counts are
correct. A plain append-only source also retains deterministic same-version
tie-break candidates. [Datafiles](https://www.tinybird.co/docs/forward/dev-reference/datafiles/datasource-files),
[Pipes](https://www.tinybird.co/docs/forward/dev-reference/datafiles/pipe-files)

## Authorized deployment checklist

1. Approve the existing workspace, region, data policy, retention/storage budget and exact resource names. Keep sponsor calls disabled until approval.
2. Use the current Tinybird CLI against an explicitly selected authorized development target. This folder is the datafile project root; use `tb build` to validate the source and pipe in that target, then review the deployment diff.
3. Deploy with the current `tb deploy` workflow only after approval. Do not create another workspace, infer an account, grant wildcard access, or deploy merely to make the adapter green.
4. Supply an existing source-scoped APPEND token and a separate source-scoped READ token for `/v0/sql`; the runtime does not need CREATE or admin permissions. If choosing the published pipe later, scope its token to that pipe and keep tenant enforcement server-side.
5. Set the application variables documented in `docs/ACQUISITION_PROVIDERS.md`. Use the workspace's actual regional origin. Preserve one high-entropy `TINYBIRD_HASH_KEY` across every app replica and restore.
6. Run the synthetic-only smoke sequence below under an approved isolated DEMO tenant. Inspect safe receipts and numeric metrics, not request bodies, secrets or private text. Enable LIVE calls only after the results and privacy policy are accepted.

These are operator steps, not executed commands. `tb build` may contact a local
or cloud target and must not be treated as a free offline linter. Current CLI
and deployment syntax are described in [CLI commands](https://www.tinybird.co/docs/forward/dev-reference/commands)
and [manual deployment](https://www.tinybird.co/docs/forward/development-workflow/manual-deployment).

## Required smoke sequence

Use only synthetic opaque IDs, never actual lead names/emails. Construct rows
through the adapter so the deployment receives exactly its schema.

| Step | Input / expected current state |
| --- | --- |
| 1 | DEMO tenant A: lead 1 v1 QUALIFIED on experiment A, lead 2 v1 NEEDS_CONTEXT unattributed. Expect total 2, qualified 1, unresolved 1, unknownAttribution 1. |
| 2 | Resend exactly those rows, including a new caller request ID. Expect identical counts. |
| 3 | Change lead 1 to v2 NOT_ICP on experiment B. Include lead 2. Expect total 2, qualified 0, notIcp 1; no count on experiment A. |
| 4 | Deliver delayed lead 1 v1 after v2, with current experiment B represented in the snapshot. v2 must remain current. |
| 5 | Send lead 1 v3 deleted=true plus lead 2. Expect total 1, unresolved 1. Later old versions cannot resurrect lead 1. |
| 6 | Use same raw lead/experiment IDs for tenant B and for A's LIVE scope. All tenant/mode hashes and queries must be distinct. Do not issue LIVE calls without separate authorization. |
| 7 | Query the deployed pipe with the generated tenant hash and fixed mode. Compare every group with the adapter `/v0/sql` results. Missing tenant/mode must be rejected by the pipe template. |
| 8 | Confirm an APPEND-only token cannot read and READ-only token cannot append. Neither may create resources. |

The Node unit suite checks deterministic serialization, schema/privacy rules,
mocked wire protocol and a reference ordering oracle. **It does not execute
ClickHouse SQL or prove the deployed schema.** A failed remote build or smoke
test is a blocker; do not substitute local counts labelled Tinybird.

The parent owns monotonic persisted versions and durable delivery. Deleting a
local lead without a newer tombstone leaves stale remote state. HMAC-key
rotation, tenant deletion, resource cleanup, compaction and retention changes
require an explicit migration plan; do not silently reset this source.
