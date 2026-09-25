# COMPASS

**Keep the reason. Move the work.**

COMPASS is a workspace for people, not an agent-session monitor. Bring a project
brief, task CSV or a short update; keep source material alongside the work it
informs. Team members update tasks. The owner controls invitations and approval.

## Run

Node 22.12+. `npm ci`, `npm run build`, `npm start`.
Open http://localhost:8770. The public demo uses fictional data and no model APIs.

Private collaboration requires PostgreSQL, `DATABASE_URL`, `BETTER_AUTH_SECRET`
and `BETTER_AUTH_URL`. Use HTTPS in production. Existing invited Better Auth
accounts are retained; there is no public signup, automatic email or billing.
Team invitations allow an invited new user to register, then sign in and accept
membership. Tokens are secrets: share only with the intended recipient.

## What works and what does not

- Public team cockpit with accessible tasks, original context and a scripted
  approval flow. No cartoon office, fabricated presence or productivity scores.
- Separate PostgreSQL workspace domain, owner/member permissions, versioned
  task changes, one-use invitations and source/audit records.
- Text, TXT, Markdown and CSV task imports with preview. Uploaded content is
  data, not permission to execute instructions. PDF/connectors are not included.
- Public demo interactions and sample recommendations are explicitly scripted.
- The AI runtime is **BLOCKED** until a human-workspace contract is implemented
  and verified. The existing simulated REMaster runtime is not sufficient.
  Manual collaboration does not depend on that runtime. No autonomous learning,
  lossless compression, provider success or long-horizon performance is claimed.

## Routes

| Route | Purpose |
| --- | --- |
| `/`, `/demo/workspace` | Immediate populated local demo; no account or model calls |
| `/presentation` | Final narrative with speaker notes and embedded Horizon |
| `/horizon` | Browser-only long-horizon simulation; 2D, 3D and Phone |
| `/app`, `/login?returnTo=/app` | Real team account, requires configured DB/auth |
| `/demo`, `/voice-demo` | Existing voice-to-site prototype, not team-runtime integration |
| `/presentation/legacy` | Previous cinematic deck, including its Horizon scene and film |
| `/demo/table`, `/demo/remaster` | Previous table and memory simulation examples |
| `/acquisition`, `/acquisition/app` | Previous acquisition domain, unchanged storage |

Horizon percentages and revenue are illustrative simulation inputs/results,
not customer outcomes or measured model confidence. Workspace proposals are
scripted and local. Voice/provider capabilities are separate and are not
represented as connected to team memory. No paid model call is made merely by
opening the public workspace or presentation. `/present` and `/story` redirect
to the final presentation. There are no new billing services or public signup.

## Verification and release

Run `npm run build`, `npm test`, `npm run test:workspaces` and
`npm run qa:workspace`. Database tests require an explicit local test DSN; see
`docs/WORKSPACE_RELEASE.md`. Never run cleanup tests against production.

See `docs/WORKSPACE_API.md` for the workspace contract and
`docs/FINAL_RELEASE.md` for this public-demo release and
`docs/WORKSPACE_RELEASE.md` for private-SaaS gates. A local screenshot
or HTTP 200 is not proof of a deployed collaborative SaaS.

## Attribution

Selective movement/facing adaptation and visual-interaction reference:
[KbWen/agent-virtual-office](https://github.com/KbWen/agent-virtual-office), pinned
at `c238a30d51881fb2add5a0a875736d6e32ce542c`, MIT. Notice is served at
`/third-party/agent-virtual-office-LICENSE.txt`. No upstream session scanners,
coding-agent hooks or installers are imported. COMPASS's shared-workspace
backend is separate from that project.
