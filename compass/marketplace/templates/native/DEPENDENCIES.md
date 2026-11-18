# Native toolchain

Dependency versions were checked against the official Expo SDK 58 source on
18 November 2026. They are exact direct dependency pins, not a generated or
tested dependency lockfile. No Expo SDK packages were installed during this
template delivery verification.

- expo 58.0.26
- react 19.3.0
- react-native 0.88.1
- react-native-safe-area-context 5.11.1

Sources:

- https://expo.dev/changelog/sdk-58
- https://raw.githubusercontent.com/expo/expo/sdk-58/packages/expo/package.json
- https://raw.githubusercontent.com/expo/expo/sdk-58/templates/expo-template-blank/package.json
- https://raw.githubusercontent.com/expo/expo/sdk-58/packages/expo/bundledNativeModules.json
- https://docs.expo.dev/versions/v58.0.0/

SDK 58 supports Node 22.13 and newer on the Node 22 line, Node 24.3 and newer
on the Node 24 line, and Node 26 and later. Use Node 22.23 or a compatible
supported LTS release. Native iOS work needs macOS and the SDK-compatible
Xcode version; Android work needs the Android development toolchain.

Install third-party dependencies separately and review their licenses in the
installed package files. No third-party dependency source or artwork is copied
into this starter. These exact direct pins do not promise that transitive
dependencies will remain unchanged; retain the lockfile from your verified
installation before shipping.
