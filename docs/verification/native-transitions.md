# Native snapshot transitions verification

Verified on 2026-10-20 with the generated `dev.radical.example` shell on iPhone Duo, iOS 27.1, UDID `88BEE7A3-757E-40C4-A789-5E3259B6B673`. Only the already-booted simulator was used. Android device verification is pending the user's device handoff; no emulator was started.

## iOS evidence

Built radical and the example, started the example server on localhost port 4173, then generated, built, installed, and launched the iOS shell:

```sh
pnpm --filter radical run build
pnpm --filter @radical/example run build
pnpm --filter @radical/example exec vp dev --host 0.0.0.0 --port 4173
pnpm --filter @radical/example exec radical ios --target 88BEE7A3-757E-40C4-A789-5E3259B6B673
```

The generated shell compiled with Xcode 27.1. The T3 Device panel remained open. All device interactions used the supplied agent-device executable, UDID, config, and session flags.

Recorded navigation with `xcrun simctl io 88BEE7A3-757E-40C4-A789-5E3259B6B673 recordVideo --codec=h264 /tmp/radical-native-transitions.mov`. The 31.85-second recording contains Home to Details, Details to Home through the Back button, and Home to About. The recording is a local verification artifact; these stills are extracted from it.

![Outgoing Home snapshot mid-slide, with Details exposed on the right](native-transitions/ios-slide.png)

![Outgoing Details snapshot moving right during back navigation](native-transitions/ios-back.png)

![Outgoing Home snapshot mid-fade over About](native-transitions/ios-fade.png)

Reviewed consecutive frames at 60 frames per second around the slide at 1.30 to 1.90 seconds and the fade at 28.05 to 28.65 seconds. Each interval includes the old screen, capture, reveal, and final destination. No white, black, or empty frame appeared between them. The outgoing content remained visible until destination content was present underneath it. The background and right-side system area stayed covered. This is simulator evidence, not a claim about every physical device or Android.

Rebuilt and relaunched after enabling WebKit document-history gestures. Slide, fade, and button back reached their destinations. A synthesized edge swipe on the SPA Details entry did not navigate on this simulator. Interactive document-history swipe behavior remains unverified. The implementation leaves document swipes to WebKit and skips the newly loaded router's initial transition; SPA history that reaches the router reverses the radical slide.

## Ordering and failure coverage

`native-transitions.test.ts` uses in-memory Layers, `it.effect`, and TestClock. It checks capture before commit, paint before reveal, capture failure and timeout followed by one plain commit, navigation failure cleanup, typed commit timeout, stalled reveal and cleanup handling, interruption during paint, malformed acknowledgements, and shell strategy selection without browser support. `tanstack-navigation.test.ts` exercises actual Router commits for slide, fade, reversed history back, transition opt-out, and restoration of the original hook.

Each shell acknowledges `cover` only after attaching its overlay. JavaScript waits for the framework commit and two animation frames before `reveal`. Android then waits for Chromium's visual-state callback. iOS waits for a successful WebKit snapshot of the new content. The live WebView remains visible throughout. Both native implementations remove overlays after three seconds independently of JavaScript, and compare ids before any late callback changes the overlay. Failure and watchdog paths were checked in source and the Effect tests; native process-death recovery was not exercised on the simulator.

## Android build and remaining verification

Generated Android without launching a device:

```sh
pnpm --filter @radical/example exec radical android --generate-only
cd apps/example/.radical/android/android
JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home ./gradlew assembleDebug testDebugUnitTest --no-daemon
```

Gradle completed successfully, including the generated app's unit tests. These are build checks, not Android visual evidence. After the device handoff, verify slide, fade, system back, failure cleanup, reduced motion, and coverage under system bars. Record with `adb shell screenrecord`, review consecutive frames, and add Android stills here.

## Repository checks

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm run ready`, and `pnpm install --frozen-lockfile` pass. Ready includes 126 passing tests. The lockfile contains no `@pnpm/exe` entry. The example server is stopped after verification.
