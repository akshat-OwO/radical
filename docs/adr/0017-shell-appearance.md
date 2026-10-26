# 0017: Shell appearance

A light-only app on a dark-mode device showed white status bar icons on its light background, because Capacitor's SystemBars style follows the device theme. Fix the cause, not the status bar: a top-level `appearance: "system" | "light" | "dark"` config field pins the whole shell. iOS writes `UIUserInterfaceStyle` and Android forces night mode before views are created. System bar icons, section bars, the keyboard, and system dialogs then agree with the app. Omitting the field means `"system"`, which keeps the device-following behavior.

## Considered Options

- A status bar style field written to `plugins.SystemBars.style`. Rejected because section bars, the keyboard, and dialogs would still follow the device and clash with a light-only app.
- Both a shell appearance and a status bar override, for apps whose top edge differs in tone. Deferred; it can be added later without breaking the field.
- Per-platform `android.appearance` and `ios.appearance` overrides. Deferred for the same reason.

## Consequences

- The WebView's `prefers-color-scheme` follows the pinned appearance, so `@media (prefers-color-scheme: dark)` stops matching in the shell under `"light"`. A plain browser still reports the device setting. The page and the shell agreeing is the intent.
- Android section bar `{ light, dark }` colors resolve against the pinned mode. Unused halves are accepted without error so switching back to `"system"` needs no config edits.
- The field is build-time only. Changing appearance at runtime needs persistence across cold starts and a rule for page versus config precedence, and is a separate decision.
