# AI MEDIA Personal OS

This generated COMPASS project uses Expo SDK 58, React Native and TypeScript. Open the Today tab and choose **Load sample data** to try the workflows with synthetic records. Create or edit clients, contacts, opportunities, tasks, follow-ups, and projects. Move an opportunity to Won and check **Pipeline → Revenue**. The Assistant tab summarizes local tasks and opens the signed-in COMPASS Builder for online AI assistance.

## Build

```sh
npm ci
npm run check
npm test
npm run bundle
```

Node 22.13 or later is required. The bundle command produces Metro JavaScript and assets for iOS and Android. For interactive browser testing, run `npm run bundle:web`. A browser build uses web storage and cannot exercise device-only photos or reminders. Native execution requires Xcode 26.4 or later on macOS, or a JDK and Android SDK 37. Install on authorized development devices with `npm run ios` or `npm run android`. See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) and [SDK compatibility](https://docs.expo.dev/versions/latest/).

Bundle identifiers are `world.mycompass.personalos` for this internal case study. Use your own unique identifiers and authorized signing when distributing a different app. Public release and signing accounts are separate from source export.

## Data and device permissions

- Business records and optional project photo copies stay in the app's local storage. This version doesn't sync those records or transmit them to an AI model. Use synthetic data for QA.
- Choosing a photo opens the device picker. Taking a photo asks for camera permission at that action. Audio permission is disabled in the image picker configuration.
- Follow-up reminders are scheduled on the device after notification permission. Choose a future due date and tap **Remind at 9:00 AM**. The device displays a generic message. Completing, deleting, or moving a follow-up cancels its pending reminder. Delivery timing follows the OS notification policies.
- This source ZIP carries the validated manifest, package pins and program files. It contains no production account data, vault secrets, or signing credentials.

The mobile project title, theme, pipeline labels, currency, and intended platform are represented in `manifest.json`. The generated app consumes those settings without evaluating model-authored code.
