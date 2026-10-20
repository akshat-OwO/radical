# Native snapshot transitions verification

Android push, back, fade, and forced-timeout recovery were verified on 2026-10-20 on Pixel_9, Android 16, API 36, serial `emulator-5554`. The user supplied the already-booted emulator. The iOS simulator stayed shut down throughout this round. The revised iOS shell compiles for a generic simulator destination, but items 1 and 4 of the PR review require iOS device re-verification after a device swap.

## Android setup

Built radical, started the example at localhost port 4173, forwarded the port, and generated the shell:

```sh
pnpm --filter radical run build
pnpm --filter @radical/example exec vp dev --host 0.0.0.0 --port 4173
adb -s emulator-5554 reverse tcp:4173 tcp:4173
pnpm --filter @radical/example exec radical android --generate-only
cd apps/example/.radical/android/android
JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home ./gradlew assembleDebug testDebugUnitTest --no-daemon
```

The generated Debug build and unit tests passed. Installed the APK and drove the app through `/Users/akshat/.t3/userdata/device/bin/agent-device`, always with the supplied Android serial, host config, and session flags. No emulator or simulator was started by the agent.

## Android motion and capture

Recorded with `adb -s emulator-5554 shell screenrecord --time-limit 90 /sdcard/radical-push-final.mp4`, then pulled the recording to `/tmp/radical-push-final.mp4`. These stills come from that recording.

![Forward push, with Details entering over the outgoing Home snapshot](native-transitions/android-slide.png)

![System Back, with Details sliding right over Home returning from parallax](native-transitions/android-back.png)

![Home snapshot fading over About](native-transitions/android-fade.png)

![Android edge-back gesture followed by the reversed slide](native-transitions/android-gesture-back.png)

PixelCopy captured the outgoing WebView text, links, safe-area values, and device information. Those details remain visible in the moving Home snapshot after the live WebView contains Details. The capture is neither blank nor a stale copy of another route.

Forward reveal moves the live content branch from one window width to zero over the old snapshot. The snapshot shifts left by 30% of the width. Back keeps the snapshot in front and moves it right while the destination returns from a -30% offset. Native logs record `kind: "slide", direction: "back"` for both system Back and the edge gesture. Both returned from Details to Home without leaving the activity. The generated shell now owns an OnBackPressedDispatcher callback because the optional Capacitor App plugin is absent.

Reviewed every encoded frame in the intervals 7.70 to 8.40 seconds for forward slide, 8.50 to 9.20 for system Back, 15.90 to 16.80 for fade, and 32.70 to 33.60 for gesture Back. The review includes the old screen, capture, layer ordering, motion, and cleanup. No white, black, or empty frame appeared. Background content stayed continuous under the status and navigation bars. Android screenrecord uses variable frame timing; this checks the recorded frames, not unrecorded sub-frame behavior.

## Forced reveal timeout

In the Debug WebView's DevTools session, temporarily wrapped `Capacitor.nativePromise` so the first `RadicalTransitions.reveal` call returned a promise that never settled. Other commands used the real native bridge. No source, native plugin, or app file was modified for this probe.

Tapped Slide to details with agent-device. The live DOM heading became Details while the native Home snapshot still covered it. The bridge probe recorded cover at 87870.5 ms, stalled reveal at 87913.5 ms, and remove at 88898.7 ms on the page's performance clock. The combined paint-and-reveal timeout caused removal roughly one second after capture, before the native three-second watchdog. The route remained `/details` and its heading remained Details.

Recorded this run with `adb shell screenrecord --time-limit 20 /sdcard/radical-timeout.mp4` and pulled it to `/tmp/radical-timeout.mp4`. The source frame at 1.3653 seconds displays the old Home snapshot until 2.302456 seconds; the next frame shows the committed Details route. These stills use source frame indices 3 and 4, so variable frame timing cannot cause a seek to choose the wrong side of removal.

![Home snapshot covers the already-committed Details route while reveal is stalled](native-transitions/android-timeout-covered.png)

![Details remains visible after timeout cleanup removes the Home snapshot](native-transitions/android-timeout-revealed.png)

Restored the original bridge method after the probe. Native process-death watchdog recovery was not exercised. The native watchdog, pending PixelCopy cancellation, and id guards were inspected in source.

## Ordering and failure tests

`native-transitions.test.ts` uses in-memory Layers, `it.effect`, and TestClock. It verifies capture before commit, paint before reveal, plain commit after capture failure or timeout, navigation error preservation, stalled reveal and cleanup recovery, interruption cleanup, malformed acknowledgements, and shell strategy selection without browser support. A deferred commit remains pending across a five-second TestClock advance with `timeoutMs: 100`; it then resolves with its original result and removes the overlay. The commit itself has no transition timeout.

`tanstack-navigation.test.ts` exercises actual Router commits for slide, fade, reversed history back, transition opt-out, and restoration of the original hook. Its insecure-origin regression removes `crypto.randomUUID` for the test scope, restores the original descriptor on every exit, and verifies initial, unmarked, opted-out, and native route commits. Consecutive native overlay ids show that plain commits do not consume counter values.

Each shell acknowledges cover only after attachment. Android attaches only after PixelCopy succeeds and checks the id again in its callback. JavaScript waits for the framework commit and two animation frames before reveal. Android then waits for Chromium's visual-state callback; iOS waits for a WebKit snapshot of the committed content. Offset setup and layer reordering happen in one native callback before the next presented frame. Cleanup cancels motion and resets live content to zero before removing the snapshot.

## iOS status after review

The original iPhone Duo evidence below was captured at `d69eb99`. Its slide moved only the outgoing snapshot. It does not verify the revised push, parallax, dimming, or transform cleanup.

![Earlier iOS slide, superseded by the push implementation](native-transitions/ios-slide.png)

![Earlier iOS back slide](native-transitions/ios-back.png)

![Earlier iOS fade](native-transitions/ios-fade.png)

The current shell removes the added `allowsBackForwardNavigationGestures = true` setting, preserving the previous disabled behavior. It uses forward push and reversed back motion with 30% parallax. The background page dims by 12% during iOS pushes. Both the animation changes in review item 1 and the gesture revert in item 4 require iOS device re-verification. The user must swap devices before that work; the simulator was not booted in this round.

Compilation passed with the generated project and no simulator launch:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build build
```

## Repository checks and cleanup

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm run ready`, and `pnpm install --frozen-lockfile` pass. Ready includes 127 passing tests. The lockfile is unchanged and contains no `@pnpm/exe` entry. The example server and Gradle are stopped after verification. Pixel_9 remains booted.
