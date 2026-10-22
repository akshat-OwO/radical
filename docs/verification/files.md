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

Runtime verified on 2026-10-22 at `9dc298b` on iPhone Duo, UDID `88BEE7A3-757E-40C4-A789-5E3259B6B673`. Built the library with `vp run radical#build`, built the example with `vp build`, regenerated the shell with `pnpm exec radical ios --generate-only`, and built the Debug simulator app with `xcodebuild`. Installed and launched `dev.radical.example.ios` with `xcrun simctl`, with the production preview at `http://localhost:4173`.

The agent-device CLI reported "Remote daemon is unavailable". The simulator stayed visible in the T3 Device panel and was driven through that panel with computer use. Screenshots from `simctl io ... screenshot --display=primary` confirmed the results. Seeded `radical-note.txt`, containing `hello from radical` and a newline, and `radical-icon.png` in the simulator's Files storage under On My iPhone.

- **Pick file** opened the system document picker. Selecting the text file displayed `radical-note.txt text/plain 19`, matching its name, MIME type, and 19-byte contents. The page showed `Intent: Idle`.
- **Open picked file** opened Quick Look with the title `radical-note` and the contents `hello from radical`. Closing the preview returned to the example with `Intent: Opened`.
- **Open URL** opened Safari at `example.com` and loaded the domain's documentation notice. Returning to the example showed `Intent: Opened`.
- **Cancel** dismissed the document picker with its close button. The page showed `Cancelled`, cleared the file list, and disabled **Open picked file**, with no unexpected error. The intent status remained `Opened`.
- **Pick images or PDFs** disabled the text file. Tapping it did not select it. The PNG remained selectable, and selecting it followed by **Open** displayed `radical-icon.png image/png 6340`, matching the source file's 6340 bytes. The intent status remained `Opened`. PDF selection was not exercised.

No runtime bugs were found in these checks. The seeded files were removed, the preview server was stopped, and the device was closed in the Device panel afterwards.

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
