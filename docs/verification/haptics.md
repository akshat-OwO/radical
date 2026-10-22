# Haptic feedback verification

Verified on 2026-10-22 with `@capacitor/haptics@8.0.2` and Capacitor 8.5.3. Both devices were opened through the T3 Device panel, one at a time, and driven with agent-device. The example used remote mode at `http://localhost:4173`.

## Build the example and shells

The example resolves radical from built `dist`. From the workspace root:

```sh
vp run radical#build
vp run @radical/example#build
pnpm --filter @radical/example exec radical android --generate-only
pnpm --filter @radical/example exec radical ios --generate-only
```

Start `vp preview --host 0.0.0.0 --port 4173` from `apps/example`. The generated Gradle project includes `:capacitor-haptics`; the generated SPM package includes `CapacitorHaptics`, and the iOS plugin class list includes `HapticsPlugin`.

## Android, Pixel_9 emulator, Android 16

Built successfully in `apps/example/.radical/android/android`:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew assembleDebug
```

Installed `app/build/outputs/apk/debug/app-debug.apk`, forwarded port 4173 with `adb reverse`, and launched `dev.radical.example.android`. Followed **Haptic feedback** from Home and tapped all eight buttons. Every action displayed `Sent` without a failure.

`adb logcat` recorded `Haptics.impact` with `LIGHT`, `MEDIUM`, and `HEAVY`, `Haptics.notification` with `SUCCESS`, `WARNING`, and `ERROR`, then `selectionStart`, `selectionChanged`, and `selectionEnd`. The final **Impact (default medium)** button sent `MEDIUM`. `adb shell dumpsys vibrator_manager` recorded completed effects under `dev.radical.example.android`, including all three notification patterns and selection feedback. No plugin rejection appeared.

Removed the port forward, stopped Gradle daemons, and closed and shut down the emulator through the Device panel.

## iPhone Duo simulator, iOS 27.1

UDID: `88BEE7A3-757E-40C4-A789-5E3259B6B673`. Built successfully from the workspace root:

```sh
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj \
  -scheme App -configuration Debug -sdk iphonesimulator \
  -destination id=88BEE7A3-757E-40C4-A789-5E3259B6B673 \
  -derivedDataPath apps/example/.radical/ios/build build
```

Installed `App.app` and launched `dev.radical.example.ios`. Captured the native console with `xcrun simctl launch --terminate-running-process --console-pty`. Followed **Haptic feedback** and tapped all eight buttons. Every action displayed `Sent`. The console recorded four `Haptics impact` calls, three `Haptics notification` calls, and `selectionStart`, `selectionChanged`, and `selectionEnd`, each followed by `TO JS undefined`, the plugin's successful void completion. No plugin rejection appeared.

Closed and shut down the simulator through the Device panel, then stopped the preview server.

## Automated checks and hardware limits

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm install --frozen-lockfile`, and `vp run ready` pass. The lockfile contains no `@pnpm/exe` entries. The full suite has 258 tests. Haptic tests cover both native runtimes, every style, browser patterns, unsupported-browser no-ops, preserved native failures, Schema argument validation, selection cleanup on interruption, opt-in plugin enablement, stable hook callbacks, error state, overlapping actions, provider replacement, unmount, and SSR guards. Tests use in-memory layers and `TestClock`, with no real timers, network, or devices.

Simulators and emulators cannot establish what the user feels. Verify impact strengths, notification patterns, and selection feedback on physical Android and iOS devices, including devices with haptics disabled or no haptic engine. Successful plugin completion is not proof of physical vibration.
