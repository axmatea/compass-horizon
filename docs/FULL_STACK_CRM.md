# Consulting CRM application engine

The COMPASS Builder can configure and preview a multi-file React and TypeScript CRM. To try the complete blueprint, sign in, select **Applications**, and start with this prompt.

> Build a professional AI consulting CRM with a client pipeline, contact management, follow-up tasks, proposal tracking, and a revenue dashboard.

Use synthetic data for the demo. Create a client and contact, add a deal and proposal, record a follow-up, then move the deal to Won and check **Won revenue**. Save a Project Context decision, ask **Plan** to revise a pipeline label, and apply the reviewed change. Reopen the project to see the records and revision. **Code** shows the project files, and **Export** downloads the source or private record data separately.

## Runtime and storage

| Surface | Implementation |
| --- | --- |
| Builder preview | Deployment builds the engineer-authored frontend into `dist/internal-crm/`. The account server embeds validated configuration as inert JSON alongside a CSP hash-pinned script and stylesheet in an opaque `allow-scripts` iframe. Network, forms, objects and nested frames are denied by the preview policy. |
| Data API | The frame sends a bounded record operation to the Builder. The parent checks the frame and revision, then calls a same-origin API protected by the signed-in account session. SQLite scopes clients, contacts, deals, tasks, and proposals by application and owner. Writes check record versions and relationships. |
| Source | A source ZIP contains the React and TypeScript files, Node server, SQLite record store, Better Auth configuration, manifest, lockfile, build configuration, Dockerfile, and smoke test. The source includes the application configuration. Business records have a separate owner-only JSON export. |
| Standalone app | The exported source builds with pinned dependencies and type-checks. Its server uses a separate secret, session cookie, database, and exact origin. For local evaluation run `npm ci --ignore-scripts`, `npm run build`, and `npm test`. The bundled app accepts `.test` signup addresses. Commercial deployment needs its own identity and registration policy, durable storage, backups and HTTPS origin. |

The hosted CRM uses the existing account volume and backup policy. Changing the project definition creates a revision. Restoring a definition keeps current CRM records. Currency changes are blocked once deals or proposals have value records, so existing amounts retain their meaning. The dashboard sums integer cents for open pipeline and won deals separately.

## Model and verification

The model reads the current CRM configuration, the request, and active Project Context. It proposes bounded configuration changes such as the title, appearance and pipeline labels. The account service checks the application and context versions before saving the result. Business records and superseded decisions stay outside the model request.

The controlled repair test returned an unsupported currency and an empty stage label. The compiler kept safe fields, restored valid defaults for both defects, and recorded diagnostics. The HTTP test then created related records, applied a model-assisted label change, restarted, and restored the previous definition while preserving a won deal. The repair covers configuration validation. Compiler errors and runtime faults in arbitrary source require a different execution service. Existing GitHub Actions can install, build, and test the engineer-authored repository code in a fresh VM. [GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners)

An independent local run extracted the 24-file source ZIP into a fresh directory, installed the pinned dependencies from cache, type-checked, built, and passed its standalone session, relationship, and persistence smoke test. The local frontend build took 703 ms and produced 74.94 kB of gzip-compressed JavaScript and 2.31 kB of gzip-compressed CSS.

The production release, browser pass, and model receipts are tracked in the release evidence. A provider token count is usage evidence. A currency cost requires an invoice or a matching approved price schedule and infrastructure measurement.

## Provider requirements

- **GitHub.** Staging supports review and import of a compatible `manifest.json` from a public branch. Applying rechecks the repository, commit, owner, grant, application, and context. The existing reviewed feature-branch source export requires a separate write grant. Provider verification requires a staging OAuth app or GitHub App, exact callback, encryption key, an authorized public test repository, and an owner connection. See [integration setup](INTEGRATIONS_COMPLETE.md).
- **Publishing.** Existing website snapshots and private CRM previews use separate paths. A public standalone CRM requires an approved isolated deployment target and a per-installation auth, data and backup policy. The exported app includes the Docker build and `/healthz` endpoint. [Railway private networking](https://docs.railway.com/networking/private-networking)
- **Arbitrary execution.** A managed VM needs a scoped credential and approved budget, a pinned image, hard command and lifecycle deadlines, resource limits, verified default-deny network policy, and owner-gated preview access. Railway Sandbox `ISOLATED` separates private networking while retaining internet egress. Its public domains require `PRIVATE`. Vercel Sandbox and E2B offer egress controls that can be verified on an authorized runtime. [Railway Sandboxes](https://docs.railway.com/sandboxes), [Vercel Sandbox](https://vercel.com/docs/sandbox), [E2B network configuration](https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/sandboxApi.ts)
