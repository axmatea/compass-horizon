# COMPASS competitive review

Checked 13 November 2026 against public homepages and official documentation.
No competitor account was created, paid generation run, restricted code accessed,
or authenticated workflow tested. Mobile and account behavior below is documented
behavior, not a claim of hands-on verification. Prices are deliberately omitted.

## Current feature matrix

| Product | Entry, identity, personalization | Workspace, history, code | Connections and publishing | Usage and mobile |
| --- | --- | --- | --- | --- |
| Lovable | Homepage prompt survives signup. Email/password, Google, GitHub, Apple; first personal workspace is automatic. No long mandatory survey established. [Start](https://docs.lovable.dev/introduction/getting-started), [accounts](https://docs.lovable.dev/introduction/create-an-account). | Chat and live preview; code editor and version history. Controls collapse on smaller screens. [Editor](https://docs.lovable.dev/features/projects/editor). | Separate project controls for publishing and integrations. [Editor](https://docs.lovable.dev/features/projects/editor). | Workspace usage combines build/chat/runtime consumption; mobile app uses swipeable areas. [Credits](https://docs.lovable.dev/introduction/credits-and-usage), [editor](https://docs.lovable.dev/features/projects/editor). |
| Bolt | Prompt, submit, Google/GitHub/email signup, short survey, then generation are explicitly documented. [Quickstart](https://support.bolt.new/building/quickstart). | Preview/code views, version preview then explicit restore; manual code edits and history restore do not spend generation tokens. [Quickstart](https://support.bolt.new/building/quickstart). | Project knowledge and integrations; hosted Publish. [Overview](https://support.bolt.new/building/intro-bolt), [settings](https://support.bolt.new/building/using-bolt/project-settings). | Per-message token visibility; quickstart specifies Chromium. Mobile editor parity not established. [Quickstart](https://support.bolt.new/building/quickstart). |
| Replit Agent | Natural-language entry; optional project type. Exact platform social-login list and signup personalization not verified. [Agent](https://docs.replit.com/features/agent/overview). | Agent builds/tests; checkpoints capture code and context. Database rollback is separately selectable; production database recovery is separate. [Checkpoints](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks). | Connectors, editor tools and publishing are documented. [Agent](https://docs.replit.com/features/agent/overview). | Cost/capability modes; iOS/Android support chat, edit, preview and publishing. [Modes](https://docs.replit.com/replitai/assistant/), [mobile](https://docs.replit.com/features/platforms/mobile-app). |
| v0 | Prompt-first homepage; v0 and Vercel share identity. Exact social-provider list was not verified. [Accounts](https://v0.app/docs/vercel-integration). | Multiple chats contribute to one project; code/design views and versions. [Projects](https://v0.app/docs/projects), [versions](https://v0.app/docs/versions). | GitHub branch/PR workflow, databases, MCP, Vercel Publish. [FAQ](https://v0.app/docs/faqs), [quickstart](https://v0.app/docs/quickstart). | Credit and billing visibility; dedicated iOS app. [Account](https://v0.app/docs/account), [FAQ](https://v0.app/docs/faqs). |
| Base44 | Prompt-first entry; signup when starting. Official index lists Google, Apple and email; detail page was unavailable. No mandatory survey verified. [Start](https://docs.base44.com/Getting-Started/Quick-start-guide), [index](https://docs.base44.com/llms.txt). | Chat left, preview right; Build/Discuss, device sizes, visual Select, history and branches. [Editor](https://docs.base44.com/Getting-Started/app-editor-overview). | Connections can begin from the first prompt; publishing is explicit. [Start](https://docs.base44.com/Getting-Started/Quick-start-guide). | Message versus integration credits; per-app/workspace usage. Mobile editor parity not verified. [Credits](https://docs.base44.com/Account-and-billing/Credits). |
| Framer | Canvas-led marketing entry; Google or email magic link. Name/workspace details may follow. [Accounts](https://www.framer.com/help/articles/creating-a-framer-account/). | Agent, editable canvas/CMS/code components; read-only history and branch previews. [AI](https://www.framer.com/ai/), [history](https://www.framer.com/help/articles/how-can-i-revert-to-a-previous-working-version-of-my-file/). | Publishing is explicit; branch publishing does not publish main. [Branches](https://www.framer.com/help/articles/how-to-use-branches-in-framer/). | Workspace AI allowance; non-credit editor helpers remain usable at the limit. Mobile builder parity not established. [Credits](https://www.framer.com/help/articles/how-ai-credits-and-agents-pricing-work/). |

Failure recovery deserves its own acceptance tests. History, rollback, testing and
troubleshooting are documented across these products; no authenticated competitor
error/cancellation path was exercised during this review. COMPASS must prove its
own retry, expiry, cancellation and last-good-preview behavior.

## Technology boundaries

v0 explicitly documents Vercel Sandbox for isolated full-app previews and names
Next.js, React, TypeScript, Tailwind and shadcn/ui for generated projects.
[Source](https://v0.app/docs/faqs). Framer documents React-based published sites
with server-rendered HTML. [Source](https://www.framer.com/help/articles/make-site-readable-by-ai-agents/).
These facts do not reveal either product's private orchestration or identity
architecture. Base44 publishes an SDK/API/CLI and Replit documents execution and
connectors. Their internal frameworks, identity providers and ledgers remain
unknown here. A generated template is not evidence of the platform's own stack.

## Decisions for this increment

- Keep the existing Vite/vanilla JavaScript/Node architecture.
- Preserve the exact bounded prompt in tab-local storage before any redirect.
  No prompt in callback URLs; clear only its matching handoff after a complete build.
- Offer project type and visual direction as two optional choices. Experience
  and intended use can wait for settings. This is our design recommendation.
- Keep preview and composer central; reveal project history/settings on demand.
  Use distinct mobile views instead of shrinking every desktop column.
- Preview an earlier revision without silently replacing current work. Publish,
  preview and save must remain distinct actions with accurate labels.
- Track real server-side usage before setting credit economics. Do not charge
  for deterministic layout changes or present arbitrary balances.
- Add no decorative integrations. Each connection needs consent, real status,
  secure credentials, disconnect and recovery before it appears as functional.

## Reusable components with verified licenses

| Candidate | Fit | License and adoption rule |
| --- | --- | --- |
| Split.js / Split Grid | Vanilla-JS resizable panels | [MIT](https://github.com/nathancahill/split/blob/master/LICENSE). Retain notices; add keyboard separators, minimum sizes and mobile fallback. |
| Lucide | Consistent interface icons | [ISC plus applicable Feather MIT notices](https://github.com/lucide-icons/lucide/blob/main/LICENSE). Preserve both notices where applicable; develop the COMPASS logo independently. |
| Floating UI | DOM-positioned menus/popovers | [MIT](https://github.com/floating-ui/floating-ui/blob/master/LICENSE). Positioning does not supply complete focus/keyboard behavior. |

These are evaluated candidates, not dependencies added by this review. Use native
controls first; import a library only for a concrete interaction need. Competitor
branding, proprietary UI, videos and private code are not reusable assets.
