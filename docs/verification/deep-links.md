# Cold-start verified links

Verified on 2026-11-03 for #153, stacked on #158.

## Automated checks

- Generation tests use in-memory layers and cover disabled, Android-only, and iOS-only credentials.
- Android generation checks the verified intent filter, host, excluded path pattern, and launching-intent validation.
- iOS generation checks the associated-domains array, browsing activity handling, and suppression of unrelated saved-URL recovery for a link launch.
- `pnpm exec ultracite fix`, `pnpm exec ultracite check`, and `vp run ready` passed.

## Device checks

Used apps/example with temporary Android fingerprint and iOS team ID values and `RADICAL_ORIGIN=https://example.com`. These values were removed after verification. They do not prove domain ownership.

### Android

Pixel_9, Android 16.0:

1. Generated the remote project with `pnpm exec radical android --generate-only` and built with `./gradlew assembleDebug`. Build passed.
2. Installed the APK and approved the development domain with `adb shell pm set-app-links --package dev.radical.example.android 2 example.com`.
3. Cold-launched through the T3 device command with `open dev.radical.example.android 'https://example.com/about?cold=153#details' --relaunch`. Activity inspection confirmed an ACTION_VIEW intent containing the complete URL. The remote WebView displayed the public domain's content.
4. Disabled Wi-Fi and mobile data through the device command and repeated the cold launch. The packaged fallback displayed "You're offline", "Connect to the internet to open this page.", and "Try again". No app snapshot existed for this URL. Retry URL propagation is covered by the existing launch/fallback implementation; the retry target was not inspected on-device.
5. Generated with `RADICAL_MODE=bundled`, built, installed, and repeated the cold launch. The example rendered About and selected the About section. WebView console output identified `https://localhost/about?cold=153#details`, confirming client-side routing with the query and fragment preserved. Calls to the temporary remote origin produced expected CORS failures because it does not serve the example backend.

Remote routing against the actual example server and offline restoration of an exact-URL snapshot were not verified. The temporary public origin does not serve Radical's association files or example routes. Production certificate verification was not tested. Android versions before API 35 cannot apply URI-relative exclusion groups; native launch validation still rejects excluded paths.

### iOS

iPhone 17 Pro, iOS 26.5:

- Generated with `RADICAL_ORIGIN=https://example.com pnpm exec radical ios --generate-only`.
- Built with `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/radical-153-ios CODE_SIGNING_ALLOWED=NO build`. Build passed.
- Installed the simulator app and opened it through the T3 device command. The shell ran and displayed the configured remote origin.
- Attempted the same HTTPS link through the device command. The URL opened Safari. This unsigned development app has no public association for the temporary domain, so the attempt does not verify delivery of an NSUserActivity launch.

iOS verified-link routing, bundled link routing, and offline link behavior remain unverified on-device. No activity was injected to imitate a Universal Link.

## Cleanup

Ran one device at a time under the shared device lock. Closed and shut down both devices, restored Android connectivity, stopped the Gradle daemons started for these builds, restored apps/example configuration, and released the lock. No development server or Metro process was started.
