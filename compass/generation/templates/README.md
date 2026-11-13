# Your COMPASS application

This source is a real Node.js application with SQLite records, owner-scoped CRUD,
Better Auth email/password sessions and a responsive frontend. COMPASS compiles a
bounded application manifest into engineer-authored code; it does not execute
arbitrary AI-written code on its server.

## Run

Use Node 22.13 or newer. Install dependencies with `npm ci`, set a private
`BETTER_AUTH_SECRET` of at least 32 random characters in your environment, and
run `npm start`. The process prints its exact localhost origin. Use that origin.
`PORT` defaults to 3000. `APP_DATABASE` defaults to `./data/app.sqlite`.

Register with a reserved address such as `you@example.test` and a password of at
least 12 characters. Email delivery, verification, recovery and social providers
are not configured in this standalone template. Do not use real customer email
accounts until those services and policies have been implemented and verified.
Passwords and sessions are handled by Better Auth, not custom cryptography.

`npm test` exercises real registration, cookies, owner isolation, CRUD and logout
against disposable SQLite data. `npm run check` checks source syntax.

## Deployment boundary

For deployment set `HOST=0.0.0.0`, `NODE_ENV=production`, and an exact HTTPS
`APP_ORIGIN`. Configure a persistent writable `APP_DATABASE` path, backups and
restore tests. A container filesystem alone is not cloud persistence. Keep the
secret outside source control. No provider credentials or COMPASS session data
are included in this export. No billing or third-party integrations are enabled.

The manifest controls title, fields and appearance. Source export does not mean
that a deployment has been created. Arbitrary source execution requires an
isolated execution provider and separate authorization.
