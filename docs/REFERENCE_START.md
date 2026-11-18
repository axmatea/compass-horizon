# Starting a COMPASS project

The homepage has two entry points. **Start from an idea** keeps editable voice
input and offers an explicit Website/Data app choice. **Start from an app** opens
an in-place reference planner. Existing Builder projects and the account sidebar
also offer the reference planner.

The planner accepts an app name or a public HTTP(S) link. Familiar references
suggest a supported pattern: a website, project tracker, CRM, inventory, or
booking-record application. The user can change the format and pattern, choose
sections or fields, name their own project, and add a short instruction (design
changes for data apps). The
build brief is visible before continuing. The user must explicitly choose Build.

Reference planning makes no model request and does not fetch the supplied URL,
inspect private pages, import code, or claim to reproduce an entire third-party
application. Names and public hostnames provide context; URL paths, queries and
fragments do not enter the handoff. Credential-bearing URLs, private hosts,
unsupported protocols and malformed references are rejected. Screenshot and
source imports are not offered by this release.

The reviewed brief uses the existing bounded, tab-local creation draft. Website
selection stays a website even if its text mentions CRM or inventory. Data apps
require the configured account service; an explicit guest continuation produces
a clearly labelled website preview. Optional saved profile preferences fill in
defaults, while the chosen target and explicit visual direction take precedence.

Only the canonical initial reference-plan header changes generation behavior.
Website section selection and application field selection are validated against
existing template allowlists. A fully specified initial data-app plan builds
directly with a prepared source label and no model call. Website content can use
the configured model while preserving selected sections. An application retains
its required primary field. Original project branding wins over reference names;
names and reference hostnames never change the chosen appearance. Ordinary ideas
and later refinements retain their normal AI behavior. Arbitrary third-party code
never executes.

Opening, changing or closing the drawer does not overwrite a creation draft or
clear the current project. Before Build replaces a handoff, the workspace checks
active generation, unapplied code/manifest edits and unsent work. A cancelled
guard, unavailable storage, or a late asynchronous continuation keeps the current
work. Navigation recovery uses the same guard. Account identity checks, private
saving, revision history and export use the existing application boundaries.

No billing or provider settings are changed. Payments remain off.
