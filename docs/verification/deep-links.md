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

## Default-port regression check

The Android template has no JVM unit-test runner or Android Uri test layer in this repository. Accepted links now rebuild their authority from the configured origin in remote mode, using the same encoded route setters as bundled mode.

Device check to run on Pixel_9 with a remote origin serving the example routes:

1. Generate and install the remote app with origin `https://example.com`.
2. Cold-launch `https://example.com:443/about?x=1#details` through the T3 device command with `--relaunch`.
3. Inspect the WebView URL. It must be `https://example.com/about?x=1#details`, and the About route must render instead of the configured start page.
4. Repeat with `https://EXAMPLE.COM:443/a%2Fb?x=%2F#encoded%20fragment`. Confirm the canonical authority and unchanged encoded route components.
5. Repeat in bundled mode and confirm those route components under the local origin.

This regression device check has not been run for the review fixes.

## Warm delivery, issue 154

Pixel_9, Android 16.0, bundled example with temporary verified origin `https://example.com`:

- Generated with `RADICAL_MODE=bundled RADICAL_ORIGIN=https://example.com pnpm exec radical android --generate-only` and built with `./gradlew assembleDebug`. Build passed. Installed and approved `example.com` with `adb shell pm set-app-links --package dev.radical.example.android 2 example.com`.
- Opened the example, then delivered `https://example.com/about?warm=154#details` through the T3 device command. About rendered and its native section became selected. The WebView URL was `https://localhost/about?warm=154#details`.
- Used About's Badge Home button, then delivered `https://example.com/details?warm=154`. Details rendered in Home, and the Home badge retained its value of 3. Capacitor logs showed Network, setBack, and section update calls, with no transition cover/reveal call for this cross-section navigation.
- Read the WebView through its debugging socket. `performance.timeOrigin` remained `1793713365111.4` on About, Details, and Home after Back. This confirms the warm navigation did not reload the document.
- System Back from Details returned to `/`, the Home root, rather than About. The badge remained 3. This follows ADR 0016's within-section root rule.

The device check covers bundled routing, section state, and Back. Remote routing against the example backend, exact-URL offline restoration, and two native intents before readiness were not exercised on-device. Unit tests cover shared route validation, network-aware snapshot selection, and the readiness handshake against an in-memory shell retaining the latest pending URL. Existing notification-navigation tests remain unchanged.

iPhone 17 Pro, iOS 26.5:

- Generated the remote shell for `https://example.com` and built with `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/radical-154-ios CODE_SIGNING_ALLOWED=NO build`. Build passed.
- Installed and opened the shell. It displayed Example Domain.
- Tried the HTTPS warm link through the T3 device command. The system opened an external browser surface. This unsigned simulator app has no public association with the temporary domain, so local Universal Link delivery could not be verified. No synthetic NSUserActivity was injected.

Closed and shut down each device before opening the next, stopped the Gradle daemon, removed the debugging port forward, restored the example configuration, and released the device lock. No development server was started.

## Scheme links, issue 155

Verified on 2026-11-03 with a temporary example configuration: `deepLinks: { scheme: "myscheme", exclude: ["/private/*"] }`, `RADICAL_MODE=bundled`, and `RADICAL_ORIGIN=https://example.com`. Restored the example configuration after generation.

### Android

Pixel_9, Android 16.0:

- Generated with `pnpm exec radical android --generate-only` and built with `./gradlew assembleDebug`. Build passed.
- Installed the APK with `adb install -r`. Opened scheme links through the T3 device command, which delivers Android VIEW intents.
- Cold-opened `myscheme://about?cold=155#details`. Capacitor logged a local request for `https://localhost/about?cold=155#details`. The example's manual splash initially stayed visible on this route; the example context handoff fix below resolves it.
- Cold-opened `myscheme:///?cold=155#home`. Home rendered, and Capacitor logged `https://localhost/?cold=155#home`.
- Warm-opened the path-only Home link and `myscheme://about?warm=155#details`. Home and About rendered, with the matching native section selected.
- Opened `myscheme://private/test?x=1#excluded`. Chrome received an ACTION_VIEW intent for `https://example.com/private/test?x=1#excluded`. After Chrome's first-run prompts, its address field showed the complete mapped URL.

### Android 11 combined-filter check, 2026-11-03

Tested head `8b9f3d8` on Pixel_9_API_30 (Android 11) with a temporary debug-keystore SHA-256 fingerprint, `myscheme`, `/private/*`, bundled mode, and origin `https://example.com`. Driven with adb, because the device tool timed out on this image.

- The generated manifest contains the HTTPS autoVerify filter for `example.com`, the scheme filter, the `uri-relative-filter-group` exclusions, and the HTTPS BROWSABLE `<queries>` entry.
- Control: `cmd package query-activities` for `https://example.com/private/test` returned both MainActivity and Chrome. Android 11 ignores `uri-relative-filter-group`, so excluded paths still match the app's filter.
- `am start -a android.intent.action.VIEW -d 'myscheme://private/test?x=1#excluded'` produced a second `START u0` with `pkg=com.android.chrome` and `dat=https://example.com/...`. `mResumedActivity` was `ChromeTabbedActivity`, and the screenshot showed `example.com/private/test?x=1#excluded` in the address bar. No chooser appeared, and the app did not re-enter.
- The image's WebView 91 lacks document-start scripts, so the shell normally refuses to start. Only for this check, the generated project's `MainActivity` skipped that guard to reach the handoff. The generated project was not committed.

Restored the example configuration, uninstalled the app, stopped the emulator and Gradle daemon, and released the device lock.

Repeated with the app as the origin's verified handler: `pm set-app-link dev.radical.example.android always`, the Android 11 equivalent of a verified domain. `cmd package resolve-activity` for `https://example.com/private/test` now returned MainActivity alone, and an implicit HTTPS VIEW intent for that URL opened the app directly. The excluded `myscheme://private/test?x=1#excluded` still started `com.android.chrome` explicitly. Chrome resumed at `example.com/private/test?x=1#excluded`, with no chooser and no app re-entry.

### Android splash follow-up, 2026-11-03

Reproduced with the installed bundled scheme-link build on Pixel_9. Cold `myscheme://about?cold=155#details`, plain `myscheme://about`, and `myscheme://details` loaded their routes without a `RadicalSplash.hide` call. Query and fragment handling were not the trigger. About rendered beneath the native overlay, which eventually disappeared at the native timeout. The HTTPS intent cannot resolve without Android fingerprints and was not used.

Root cause was in the example. Bundled hydration starts with a browser context, and the root loader could retain that context on a cold non-root route. `LaunchReveal` therefore skipped its effect and initialized its phase to done. The root now passes the injected context after the mount handoff, and the reveal keeps its splash phase until the native platform arrives. Android's bundled start URL correctly preserves the route, query, and fragment; no native template change was needed.

Regenerated the bundled scheme build, ran `./gradlew assembleDebug`, and installed with `adb install -r`. Cold About with query and fragment logged `hidden: true` at 20:01:05.173, `RadicalSplash.hide` at 20:01:05.548, then `hidden: false` at 20:01:08.086. This confirms both awaited calls completed and the reveal finished. The device screenshot and accessibility tree showed About with its section selected and no splash. Plain About and Details also reached the hide call. Expected update-policy CORS errors from the temporary public origin did not prevent routing or the reveal.

Restored the example configuration after generation. Closed Pixel_9, stopped the emulator and Gradle daemon, removed the debugging port forward, and released the shared device lock. No server was started.

### iOS

iPhone 17 Pro, iOS 26.5:

- Generated with `pnpm exec radical ios --generate-only`.
- Built with `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/radical-155-ios CODE_SIGNING_ALLOWED=NO build`. Build passed.
- Installed with `xcrun simctl install`. Opened links through the T3 device command. Accepted the system's initial scheme-open confirmation.
- Cold-opened `myscheme:///?cold=155#home`, then warm-opened `myscheme://about?warm=155#details`. About rendered and its native section became selected.
- Opened both `myscheme:///private/test?x=1#excluded` and `myscheme://private/test?x=1#excluded`. SpringBoard logged the app handing `https://example.com/private/test?x=1#excluded` to Safari. Bringing Safari forward and focusing its address field confirmed that complete URL.

These checks exercise bundled routing and browser handoff without domain association files. Remote-mode routing and offline snapshot restoration were not repeated for this issue. Unit tests cover empty routes, host-only and path-only routes, queries, fragments, percent-encoding, platform registration, and Google sign-in scheme collisions.

Closed and shut down Android before starting iOS under the shared device lock. Stopped the Gradle daemons, closed and shut down iOS, and released the lock. No development server was started.

## Browser-only excluded scheme handoff

The Android handoff now discovers browsers with a generic HTTPS BROWSABLE intent. It honors the resolved default only when that package appears in the browser results and is not this app. Otherwise, a chooser contains explicit browser activities. No available browser leaves the app open and logs a warning rather than attempting an unrestricted intent. Generation tests cover the visibility query with scheme links alone and with verified links enabled.

The Java helper depends on Android PackageManager, Intent, and Uri. This repository has no Android JVM test runner or framework test layer, so its resolution behavior requires a device check. The following check remains unperformed for this fix:

1. On Android 14 or earlier, configure both a scheme and verified App Links, with an excluded route such as /private/* and a verified origin.
2. Confirm an included HTTPS route opens the app. Cold-open and warm-open myscheme://private/test?x=1#excluded with the configured scheme.
3. Confirm the default browser receives the mapped HTTPS URL with its path, query, and fragment intact, even though the app owns the origin.
4. Clear the default browser and install two browsers. Repeat and confirm the chooser offers browsers only. Each choice must open the complete URL.
5. Disable all browsers and repeat. Confirm the app stays open without a crash.

iOS keeps UIApplication.open for the mapped HTTPS URL. Apple's [Universal Links documentation](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app) specifies that opening a link to the app's own website from that app does not route back to itself. The default universalLinksOnly option is false. No iOS handoff change is needed. The earlier simulator check did not have domain associations; repeat the excluded-link check with a signed, associated app to verify that configuration on a device.
