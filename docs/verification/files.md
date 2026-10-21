# Files and intents verification

Verified on 2026-10-21 with file picker 8.1.1, app launcher 8.0.1, file opener 8.0.1, and Capacitor 8.5.3. Runtime checks use the example's remote mode at `http://localhost:4173`.

## Android, Pixel_9 emulator (Android 16)

Generated with `pnpm --filter @radical/example exec radical android --generate-only`. The generated package pins all three plugins. Built with `./gradlew assembleDebug`, installed the APK, and connected the preview with `adb reverse tcp:4173 tcp:4173`. Pushed `radical-note.txt` (19 bytes) and the example icon to `/sdcard/Download`.

The agent-device daemon was unavailable during this run, so the app was driven with `adb shell input tap` on bounds from `uiautomator dump`.

- **Pick file** opened the system document picker on Recent files. Selecting `radical-note.txt` displayed `radical-note.txt text/plain 19 19`: the name, MIME type, the size the picker reported, and the 19-byte blob read back through the `content://` URI. The example now shows only `size`, which is the blob's size.
- **Open picked file** showed Android's "Open with" sheet (Chrome, HTML Viewer). **HTML Viewer**, **Just once** opened the file, which displayed `hello from radical`. Back in the app, the page showed `Intent: Opened`.
- **Open URL** made Chrome the resumed activity on `https://example.com/` (its first-run screen on this emulator).
- **Pick images or PDFs** opened the picker filtered to Images and Documents. The `.txt` file was not offered. Back produced `Cancelled`. A second pick of `radical-icon.png` displayed `image/png`.

The test files, the port forward, and Gradle daemons were removed afterwards, and the emulator was shut down.

## iPhone Duo, iOS 27.1 simulator

Generated with `radical ios --generate-only` and built with `xcodebuild ... -sdk iphonesimulator`; the build succeeded. The generated SPM package includes `CapawesomeCapacitorFilePicker`, `CapacitorAppLauncher`, and `CapacitorCommunityFileOpener`, and `packageClassList` registers `FilePickerPlugin`, `AppLauncherPlugin`, and `FileOpenerPlugin`.

Runtime checks on iOS are pending: the agent-device daemon was unavailable, and no other way to tap the simulator is installed.

## Repository checks

Tests use `@effect/vitest` with in-memory bridge, file, and intent layers and `TestClock` interruption. They cover:

- native picks in both shells, with options, URI reads, and the MIME fallback
- single-file limits
- identical browser results
- native, empty, and browser cancellation, plus preserved failures and missing paths
- URL opening with `NoHandler`
- browser URLs and invalid URLs
- file opener arguments with chooser, and its code mapping
- files without URIs
- opt-in enablement with pinned packages
- the shared DOM file input
- hook state
- server-rendering guards

`pnpm exec ultracite check`, `pnpm install --frozen-lockfile` (no `@pnpm/exe` entries), and `pnpm run ready` pass, with 231 tests.
