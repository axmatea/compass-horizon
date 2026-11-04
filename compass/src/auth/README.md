# Core account access

`login.html` mounts this minimal account UI. It never loads acquisition product
state, sample data, early-access forms, or provider demos.

- Readiness is `GET /api/auth/status` with `database: ready | blocked`. Blocked
  or unverified service disables registration/sign-in and explains the blocker.
- Sign-in uses the unchanged same-origin Better Auth email endpoint and checks
  `GET /api/auth/get-session` before navigating. Existing cookies are preserved.
- Invitation registration uses `/api/acquisition/accept-invite` only as the
  retained identity compatibility alias. A confirmed `{ok:true}` means account
  creation, not workspace membership. Sign-in and explicit acceptance in `/app`
  remain separate steps. No public signup or automatic acceptance exists.
- `login-return.ts` owns the bounded redirect contract. Only
  `/app` is an allowed post-login destination. Valid workspace tokens survive
  registration and sign-in; registration tokens are removed from the URL.

Run `node --experimental-strip-types --test src/auth/*.test.mjs` and
`node --experimental-strip-types --test src/core.test.mjs`. Browser checks use
local intercepted API fixtures only, not paid providers or production data.
