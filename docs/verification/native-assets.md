# Native asset generation

Verification for issue #45, starting from main at `3fe36dce5a16c70acc52058d37347199ae4d124b`.

## Baseline and output comparison

Before changing the generator, built Radical with `pnpm exec vp run radical#build`, then ran `pnpm exec radical android --generate-only` and `pnpm exec radical ios --generate-only` from `apps/example`. The [baseline inventory](native-assets-baseline.json) records every generated platform asset path, PNG dimensions, adaptive XML, and catalog JSON. It includes three unreferenced 2732px splash PNGs inherited from Capacitor's iOS template. The tool's reported 74 Android outputs count repeated adaptive XML writes; the final resource set contains 53 distinct files.

After replacing the writer, regenerated both shells and read the PNG metadata with `sharp`. The [comparison](native-assets-diff.json) records the full resulting inventory and additions. All 65 baseline files remain with identical dimensions. Content-derived `RadicalSplash<hash>.imageset` paths normalize to `Splash.imageset` only for inventory comparison. The generated catalog, storyboard, and startup overlay share a SHA-256 name derived from the prepared splash PNG bytes. Identical pixels keep the name stable; changed pixels change it. Regeneration removes stale hashed catalogs. Catalog contents remain semantically identical.

Android has 61 asset files, compared with 53 before. Its eight additions are six monochrome images and two API 33 adaptive XML files. The baseline and config support one icon artwork. No night launcher rasters are written, so night mode still resolves `ic_launcher` and `ic_launcher_round` to adaptive XML on API 26 and later. Night splash drawables remain unchanged. API 33 XML references the monochrome alpha mask. iOS retains all 12 catalog files, including the three inherited template PNGs. Those unreferenced images do not enter the launch catalog's `Contents.json`.

iOS launch images are encoded directly at 2048×2048, rather than encoding 2732px outputs and then downsampling. The 2048px bound and 1024-point storyboard declaration retain the independent iOS allocation constraint documented in ADR 0001. The separate square Android 12 system splash also remains necessary independently of the previous writer.

## Automated verification

- `pnpm exec ultracite fix` and `pnpm exec ultracite check` pass.
- `pnpm install` regenerated the lockfile, removing 971 lines. `pnpm install --frozen-lockfile` passes. The catalog, Radical package, generator code, error messages, and lockfile contain no removed asset-tool dependency. The lockfile contains no `@pnpm/exe` entries.
- `pnpm exec vp run ready` passes build, example type generation, Ultracite, `vp check`, Effect type checks, and all tests.
- `packages/radical/tests/native/assets/native-assets.test.ts` uses `it.effect`, `assert`, and test-local in-memory filesystems. It compares file sets, PNG sizes, and catalog metadata with the independently captured baseline; checks the absence of night launcher rasters, content-derived iOS names and stale-catalog removal, adaptive and monochrome references, transparency, padding, round masks, square system artwork, distinct dark artwork, optional inputs, and typed encoding and filesystem failures. Tests do not invoke a CLI, network, timer, or device.

## Native builds

Both builds pass. [Captured build results](native-assets-builds.txt) include the final build messages and artifact hashes.

Android's generated Gradle project is nested under the Radical staging container. Ran from `apps/example/.radical/android/android`:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew assembleDebug
```

Result: `BUILD SUCCESSFUL`, 458 actionable tasks executed. Capacitor's earlier automatic Gradle sync used the host Java and reported unsupported class-file version 69; the explicit build above uses the requested Android Studio JBR and succeeds.

Ran from the repository root:

```sh
xcodebuild -project apps/example/.radical/ios/ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination id=88BEE7A3-757E-40C4-A789-5E3259B6B673 -derivedDataPath apps/example/.radical/ios/build build
```

Result: `** BUILD SUCCEEDED **`. Xcode compiled the asset catalog and launch storyboard for the simulator target.

## Device verification

Installed the debug builds from this branch on Pixel_9 (`emulator-5554`, Android 16) and iPhone Duo (`88BEE7A3-757E-40C4-A789-5E3259B6B673`, iOS 27.1), both open in the T3 Device panel.

- [Android launcher](native-assets/android-launcher.png): "Radical Android" shows the adaptive icon, a white mark on the purple background.
- [Android launcher, dark mode](native-assets/android-launcher-dark.png): after installing the rebuilt APK and setting `cmd uimode night yes`, the app drawer shows the adaptive launcher icon. Night mode was restored to `no` after capture.
- [Android splash](native-assets/android-splash.png): the Android 12 system splash shows the centered mark on the brand background.
- [Android splash, dark mode](native-assets/android-splash-dark.png): with `cmd uimode night yes`, the splash uses the night resources. The capture caught the mark mid fade-in.
- [iOS home screen](native-assets/ios-home.png): "Radical iOS" shows the app icon from `AppIcon.appiconset`.
- [iOS splash](native-assets/ios-splash.png): the original pre-review capture shows the launch artwork with the former stable resource name, captured with `simctl io ... screenshot --display=1`. The revised build installs and launches to the offline fallback; this image is not evidence of a changed-artwork reinstall.

Not verified: the Android 13 themed (monochrome) launcher icon and a changed-artwork same-version reinstall on iOS. Content-derived resource names restore the previous cache-busting mechanism; automated tests cover name stability, changes, and shared references.
