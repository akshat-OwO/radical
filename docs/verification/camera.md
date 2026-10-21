# Camera verification

Verified on 2026-10-21 with Camera 8.2.6 and Capacitor 8.5.3. Runtime checks use the example's remote mode at `http://localhost:4173`. No device was booted by this task.

## Browser

T3 preview navigation succeeded, but two snapshot attempts failed with `Preview automation snapshot timed out after 15000ms.` The in-app browser was unavailable, so verification used Helium through native UI automation in a separate tab.

Opened `/camera`; permission displayed `prompt`. **Capture photo** opened the browser's file picker. Selected the repository's `apps/example/assets/icon.png`. The page displayed `image/png` and the captured preview. This verifies the desktop file-input fallback and data URL display. A desktop file picker cannot establish mobile browser hardware capture. Deterministic DOM tests assert the input's `image/*` accept value and environment capture attribute, selected-file result, cancellation, and removal on success or interruption.

## iPhone Duo, iOS 27.1 simulator

Generated with `pnpm --filter @radical/example exec radical ios --generate-only`. Built with:

```sh
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj \
  -scheme App -configuration Debug -sdk iphonesimulator \
  -destination id=88BEE7A3-757E-40C4-A789-5E3259B6B673 \
  -derivedDataPath apps/example/.radical/ios/build build
```

The build succeeded. Generated Info.plist contains both validated example descriptions. Reset camera permission with `xcrun simctl privacy 88BEE7A3-757E-40C4-A789-5E3259B6B673 reset camera dev.radical.example.ios`.

- Initial check displayed `prompt`.
- **Request permission** displayed the OS camera prompt with "Take a photo to preview it in the Radical example."
- **Don't Allow** produced `PermissionDenied`. A subsequent check displayed `denied`; capture also produced `PermissionDenied`.
- Reset camera privacy again. **Allow** produced `granted`.
- Capture opened the native camera, but its viewfinder stayed black and the shutter produced no image. Dismissing it produced `Cancelled`. Camera 8.2.6 does not report `Unavailable` for this simulator's camera UI. Missing-camera error translation is covered with an in-memory native bridge; physical iPhone capture remains unverified.
- Added the repository's icon to the simulator library using `simctl addmedia`. The first library attempt revealed that upstream Camera requires `NSPhotoLibraryUsageDescription`; iOS terminated the app without it. Generation now requires and emits a separate library description, with regression tests for missing, blank, invalid, and escaped text.
- Regenerated and rebuilt. **Choose photo** displayed the configured library explanation. Chose **Select Photos**, allowed only the test icon, then selected it in the native picker. The page displayed `image/png 1024 1024` and the captured preview. This verifies limited library access, native file reading, normalization, and rendering without camera hardware.

The simulator's system permission prompts and some picker controls were absent from the app accessibility tree. Those steps used screenshots and coordinates; other actions used snapshot refs. No native diagnostic handlers or verification commands are committed.

## Android

Generated the Android project. Its package pins Camera 8.2.6, and the manifest contains `android.permission.CAMERA` plus `android.hardware.camera` with `required="false"`. Built it with `./gradlew assembleDebug`, installed it on the Pixel_9 emulator (Android 16), and loaded the example from `vp preview` on port 4173 through `adb reverse`. Permission was reset between runs with `pm revoke` and `pm clear-permission-flags ... user-set user-fixed`.

- The initial check displayed `prompt`.
- **Request permission**, then **Don't allow**: Android reports a first decline as `prompt-with-rationale`, which the hook had normalized to `prompt` without an error. Requests now fail with `PermissionDenied` for any result other than `granted`. After the fix, the same steps displayed `PermissionDenied`.
- **Capture photo** asked again, as Android allows after a rationale. **Don't allow** produced `PermissionDenied`, and no camera opened. A following check displayed `denied`.
- Reset permission. **Capture photo**, then **While using the app**, opened the camera with the emulator's virtual scene. The shutter and **Done** displayed the captured preview.
- The first capture reported `image/jpeg 1280 960`, but the WebView decoded the image as 960 × 1280. Capacitor's resolution metadata is sensor-oriented. Dimensions now come from decoding the image with `createImageBitmap`, which applies EXIF orientation, in every runtime. After the fix the page displayed `image/jpeg 960 1280`, and `naturalWidth`/`naturalHeight` read through WebView DevTools were `960`/`1280`.
- Opening the camera and pressing Back produced `Cancelled`. Dismissing the library picker also produced `Cancelled`.
- Pushed the repository's icon to `/sdcard/Pictures`. **Choose photo** opened the system photo picker, and selecting the icon displayed `image/png 1024 1024` with the preview.

The test image, the port forwards, and the preview server were removed afterwards, Gradle daemons were stopped, and `agent-device close` completed.

## Repository checks

`pnpm exec ultracite fix`, `pnpm exec ultracite check`, `pnpm run ready`, and `pnpm install --frozen-lockfile` pass. The ready suite includes 213 tests. New tests use `@effect/vitest`, in-memory bridge and browser layers, Deferred synchronization, and TestClock interruption without timers, network, or devices. They cover SSR guards, repeat actions, duplicate suppression, provider changes, native error mapping, denial, photo normalization, and opt-in declarations. The lockfile contains no `@pnpm/exe` entries.

The preview and dev servers were stopped, port 4173 had no listener, and `agent-device close` completed. The device daemon was left running.
