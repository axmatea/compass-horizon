# Virtual studio addition

Adds `/studio` and `/studio/tour` to the existing Railway application. The
cinematic homepage from canonical main `331d9ab` is preserved, with two new
navigation links. Existing office, private app, voice, presentation and API
routes are unchanged.

The studio is a browser-local, resettable demonstration with fictional people
and data. A supplier delay leads to a proposed revision, owner confirmation and
inspectable source history. No model, payment, notification or external action
is triggered. Refresh clears state; this is not a connected multi-user office.

## Verification

```sh
npm run build
node --experimental-strip-types --test src/office/model.test.mjs src/office/scene/layout.test.mjs test/api.test.mjs
PORT=8905 npm start
node scripts/studio-qa.mjs
# After release:
BASE_URL=https://mycompass.world node scripts/studio-qa.mjs
```

Canonical source: `axmatea/compass-horizon`, application directory `compass/`.
Release uploads that directory as the Railway build root. The existing GitHub
auto-deploy source is still the legacy `axmatea/compass`; migration of that
trigger is outside this additive page release.
