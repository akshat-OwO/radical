# Network status verification

Verified on 2026-10-22 with Capacitor 8.5.3 and `@capacitor/network@8.0.1`. Devices were opened through the T3 Device panel, one at a time, and closed and shut down afterward. No bridge results or network events were injected during native verification.

## Build both shells

Ran `vp run radical#build` before building the example. Temporarily changed the example's `mode` to `bundled`, retaining its configured origin. Generated bundled assets and shells with these commands:

```sh
pnpm --filter @radical/example exec radical android --generate-only
pnpm --filter @radical/example exec radical ios --generate-only
```

Built Android from `apps/example/.radical/android/android`:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew assembleDebug
```

Built iOS from the repository root:

```sh
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj \
	-scheme App -configuration Debug -sdk iphonesimulator \
	-destination id=88BEE7A3-757E-40C4-A789-5E3259B6B673 \
	-derivedDataPath apps/example/.radical/ios/build build
```

Both builds succeeded and included the official Network plugin. Restored the committed example config to remote mode after verification. Generated projects and diagnostic files are not committed.

## Pixel_9, Android 16

Installed the debug APK with adb and opened the app with the Device panel's pinned agent-device CLI. Selected **Network status** from Home. The accessibility snapshot reported **Connected: true, Type: wifi**.

With `/network` mounted, disabled both interfaces:

```sh
adb -s emulator-5554 shell svc wifi disable
adb -s emulator-5554 shell svc data disable
```

The same page updated to **Connected: false, Type: none**. No UI server was running or required for this bundled build. Enabled only data with `adb -s emulator-5554 shell svc data enable`; the page updated to **Connected: true, Type: cellular**. Enabled Wi-Fi with `adb -s emulator-5554 shell svc wifi enable`; the page returned to **Connected: true, Type: wifi**. Captured Wi-Fi and offline screenshots for the PR. Restored both interfaces, stopped the app, and closed the device.

This verifies initial status and native listener updates across Wi-Fi, cellular, and offline states without remounting or reloading the page.

## iPhone Duo, iOS 27.1 simulator

Installed the built app with simctl. The pinned agent-device open command returned `Error (DEVICE_IN_USE): Device is already in use by session "t3-e4386dac46be132b1d66ccac"`. Left that existing session alone. With the simulator still visible in the Device panel, launched the app with simctl and used LLDB to invoke the existing Home page's `/network` link in its WKWebView. No status values were replaced.

The page displayed **Connected: true, Type: wifi** through the native plugin. Captured the primary display with `xcrun simctl io 88BEE7A3-757E-40C4-A789-5E3259B6B673 screenshot --display=1`. The simulator shares the Mac's network and does not establish physical iPhone cellular or radio-loss behavior. Offline and cellular transitions on iOS still require hardware verification. Terminated the app, then closed and shut down the simulator through the Device panel.

## Browser and automated checks

Started the example in restored remote mode with `pnpm --filter @radical/example exec vp dev --host 127.0.0.1 --port 5175`. The collaborative browser's `/network` page displayed **Connected: true, Type: unknown**, matching `navigator.onLine === true` and an absent `navigator.connection.type`. Browser online/offline and transport-change updates are covered deterministically with injected browser objects and events; physical browser connectivity changes were not tested.

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `vp run ready`, and `pnpm install --frozen-lockfile` pass. The ready suite contains 263 tests. The lockfile contains no `@pnpm/exe` entries.

Tests use `it.effect`, `assert`, per-test in-memory bridge and browser services, Deferred synchronization, and TestClock. They cover current status in both shells, distinct live changes, listener cleanup on interruption and failure, interruption during initial reads, startup event precedence over stale initial responses, malformed responses and events, missing native listener support, browser online/offline and connection changes, missing browser transport information, injectable browser stream updates, hook state and errors, provider replacement, unmount, plugin opt-in, and SSR without global access. No test uses real timers, network, or devices.
