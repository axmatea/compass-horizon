# COMPASS Mobile

The official iOS and Android client uses the same COMPASS account, cloud projects, model calls, Project Context, and revision history as [mycompass.world](https://mycompass.world). This directory is the native COMPASS client. The Builder’s generated mobile apps have independent source archives.

## Local development

Use Node.js 22.13 or later. Install pinned dependencies with `npm ci --ignore-scripts`. Run `npm run check` and `npm test`. `npm run bundle` produces separate Hermes bundles for iOS and Android. A compiled JavaScript bundle does not establish that an installed native binary works.

With a supported Xcode and simulator, run `npm run ios`. With the supported JDK, Android SDK and emulator, run `npm run android`. Both commands generate disposable native projects through Expo prebuild. The public native build workflow prepares the iOS Simulator app and Android development APK where compatible runners and Java/Android SDKs are available. See the [Expo SDK support matrix](https://docs.expo.dev/versions/latest/) for toolchain versions.

## What the client connects

- Verified email sign-in and registration use the existing Better Auth service. Verification and reset links return to the existing HTTPS account flow. A signed session cookie is stored through Expo SecureStore and sent only to authorized COMPASS API routes. The app refuses redirected API responses and has no bearer relay or alternate account database.
- Create websites, web apps, iOS projects, Android projects, or cross-platform projects. Application proposals require owner approval with both project and context versions. Website edits check the cloud revision timestamp. The phone shows completed revisions, context, decisions, tasks, and limited read-only project records. Scriptless website previews use an isolated local WebView with JavaScript, network resources, persistent WebView state, and session cookies disabled. Open the web Builder for the generated application preview itself.
- Standard web apps accept PNG and JPEG project image uploads through the system photo picker. Keyboard dictation uses the OS text input service. The user can enable local build-completion notifications for builds completed while the client is open. These are local notifications. Push delivery and completion while the app is suspended require a separate service and verification.
- Usage, connection status, and the saved design preference come from the COMPASS account. Payments follow the existing backend setting. Integration changes and account management open the existing website. Federated mobile sign-in needs its own approved backend callback and app deep-link configuration.

## Distribution prerequisites

Configured identifiers are `world.mycompass.mobile` on both platforms. Store distribution requires approved signing and developer accounts, device validation, current privacy and store metadata, and an account deletion flow that covers server data. A native distribution release, claims about store approval, use of paid infrastructure, and ownership of those identifiers require separate verification and authorization. See the [privacy policy](https://mycompass.world/privacy).

The lockfile scopes a patched `minimatch` to Expo’s fingerprint builder. [Advisory and patch history](https://github.com/isaacs/minimatch/security/advisories/GHSA-hqmv-qgp3-jx75)
