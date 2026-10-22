# Visual docs verification

Base commit: `754e2f7d70783b8801a8ea8879aaf46f6711865f`. Issue: [#92](https://github.com/akshat-OwO/radical/issues/92).

## Prose counts

Counts exclude frontmatter, fenced code, Markdown tables, and component markup, including diagram definitions and TypeTable props. Visible component children and headings count as prose. Inline symbols count as words. The same counter measures the base and working tree.

| Section      | Before | After |
| ------------ | -----: | ----: |
| Introduction |    220 |    88 |
| Tutorial     |    374 |   173 |
| Guides       |   2548 |  1222 |
| Reference    |   4066 |  2315 |
| Explanation  |   1634 |   830 |
| Total        |   8842 |  4628 |

Prose decreases by 4,214 words, or 47.7%.

### Second pass

The same counter compares first-pass commit `46561f8` with this revision. Counts exclude code and tables; the reductions measure prose, not all visible words.

| Section  | First pass | Second pass | Reduction |
| -------- | ---------: | ----------: | --------: |
| Guides   |       2514 |        1222 |     51.4% |
| Tutorial |        374 |         173 |     53.7% |
| Total    |       6103 |        4628 |     24.2% |

To compare against the first pass, replace `754e2f7` with `46561f8` in the counter below.

### Per page

| Page                                 | Before | After |
| ------------------------------------ | -----: | ----: |
| `explanation/bridge.mdx`             |    243 |   123 |
| `explanation/delivery-modes.mdx`     |    393 |   178 |
| `explanation/native-context.mdx`     |    274 |   125 |
| `explanation/native-shells.mdx`      |    237 |   149 |
| `explanation/offline-caching.mdx`    |    286 |   135 |
| `explanation/plugin-model.mdx`       |    201 |   120 |
| `guides/app-assets.mdx`              |    109 |    42 |
| `guides/bundled-mode.mdx`            |    323 |   127 |
| `guides/camera.mdx`                  |    115 |    57 |
| `guides/custom-plugins.mdx`          |    117 |    61 |
| `guides/data-protection.mdx`         |    127 |    81 |
| `guides/device-info.mdx`             |     69 |    25 |
| `guides/files.mdx`                   |    143 |    57 |
| `guides/firebase.mdx`                |    154 |    73 |
| `guides/google-sign-in.mdx`          |    163 |    60 |
| `guides/haptics.mdx`                 |    103 |    27 |
| `guides/network.mdx`                 |     64 |    33 |
| `guides/notification-navigation.mdx` |    106 |    49 |
| `guides/notifications.mdx`           |    317 |   119 |
| `guides/offline-routes.mdx`          |    138 |    92 |
| `guides/run-on-a-device.mdx`         |    188 |   147 |
| `guides/safe-area.mdx`               |     89 |    56 |
| `guides/transitions.mdx`             |     85 |    55 |
| `guides/video-stream.mdx`            |    138 |    61 |
| `index.mdx`                          |    220 |    88 |
| `reference/camera.mdx`               |    225 |    99 |
| `reference/cli.mdx`                  |    272 |   194 |
| `reference/client.mdx`               |    145 |    99 |
| `reference/config.mdx`               |    174 |   146 |
| `reference/data-protection.mdx`      |    187 |   118 |
| `reference/device-info.mdx`          |    101 |    63 |
| `reference/files.mdx`                |    246 |   176 |
| `reference/google-sign-in.mdx`       |    141 |    72 |
| `reference/haptics.mdx`              |    126 |    80 |
| `reference/network.mdx`              |    144 |   122 |
| `reference/notifications.mdx`        |    654 |   269 |
| `reference/plugins.mdx`              |    258 |   160 |
| `reference/react.mdx`                |    208 |   177 |
| `reference/safe-area.mdx`            |    203 |    12 |
| `reference/server.mdx`               |    254 |   138 |
| `reference/transitions.mdx`          |    118 |    78 |
| `reference/video-stream.mdx`         |    166 |   111 |
| `reference/vite.mdx`                 |    444 |   201 |
| `tutorials/create-an-app.mdx`        |    374 |   173 |

### Regenerate counts

Run from the repository root with Python 3:

````sh
python3 - <<'PY'
import pathlib, re, subprocess
root = pathlib.Path('apps/docs/content/docs')
def count(s):
    s = re.sub(r'\A---\n.*?\n---\n', '', s, flags=re.S)
    s = re.sub(r'^```.*?^```[^\n]*', '', s, flags=re.S | re.M)
    s = re.sub(r'<(?:Mermaid|TypeTable)\b.*?/>', '', s, flags=re.S)
    s = re.sub(r'<[^>]+>', '', s)
    s = '\n'.join(line for line in s.splitlines() if not line.lstrip().startswith('|'))
    s = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', s)
    return len(re.findall(r"[\w]+(?:[-'’][\w]+)*", s))
print('| Page | Before | After |\n| --- | ---: | ---: |')
for p in sorted(root.rglob('*.mdx')):
    base = subprocess.check_output(['git', 'show', f'754e2f7:{p}'], text=True)
    print(f'| {p.relative_to(root)} | {count(base)} | {count(p.read_text())} |')
PY
````

## Diagram source checks

Source paths below are relative to `packages/radical/`. All diagram contracts were checked against the base source. Review fixes rechecked all ten diagrams against the current source, including every decision and alternate branch. No other compound-condition branch errors were found.

| Page | Diagrams | Source |
| --- | --- | --- |
| `explanation/native-shells` | Architecture; generate, build, install, launch | `src/vite/vite.ts`, `src/vite/build-plan.ts`, `src/adapters/tanstack-start/tanstack-start.ts`, `src/entry/prepare-native.ts`, `src/entry/cli.ts`, `src/native/shared/native-project.ts`, `src/native/android/run.ts`, `src/native/ios/run.ts` |
| `explanation/delivery-modes` | Remote and bundled requests | `src/core/bundled/bundled-request.ts`, `src/core/bundled/bundled-server.ts`, `src/adapters/tanstack-start/tanstack-middleware.ts`, `src/adapters/tanstack-start/tanstack-start-server.ts`, `src/adapters/tanstack-start/tanstack-outputs.ts` |
| `explanation/bridge` | Manifest command sequence | `src/core/bridge/bridge.ts`, `src/core/plugins/plugins.ts` |
| `explanation/native-context` | Context transport and mount handoff | `src/core/context/native-context.ts`, `src/core/bundled/bundled-request.ts`, `src/entry/server.ts`, `src/capabilities/safe-area/safe-area.ts`, `src/capabilities/safe-area/safe-area-style.ts` |
| `explanation/offline-caching` | Snapshot lifecycle; shell startup recovery | `src/core/offline/offline-worker.ts`, `src/core/offline/offline-entry.ts`, `src/core/offline/native-offline.ts`, `src/core/offline/offline-protocol.ts`, `templates/android/MainActivity.java`, `templates/android/launch.html`, `templates/ios/RadicalViewController.swift` |
| `explanation/plugin-model` | Manifest resolution and internal implications | `src/core/plugins/plugins.ts`, `src/core/plugins/internal-plugin-registry.ts`, `src/vite/plugins/plugin-plan.ts`, `src/vite/native-contributions.ts` |
| `guides/transitions` | Cover, commit, reveal, remove with overlay IDs | `src/capabilities/transitions/native-transitions.ts`, `src/adapters/tanstack-start/tanstack-native-transitions.ts`, `templates/android/RadicalTransitionsPlugin.java`, `templates/ios/RadicalTransitionsPlugin.swift` |
| `guides/notification-navigation` | Tap validation and snapshot navigation | `src/capabilities/notifications/notification-navigation.ts`, `src/capabilities/notifications/notification-schema.ts` |

## Review-fix verification

- Startup recovery now separates Android target selection, registration lookup, and navigation outcomes. The lookup navigates after fulfillment or rejection, including when no registration exists.
- iOS checks launch state, prior attempt, saved URL parsing, origin allowance, and URL inequality separately. Ineligible recovery preserves worker `offline.html` for a fallback response and loads packaged HTML for a load failure. A saved-URL retry goes through the same outcome checks.
- Rechecked snapshot eligibility and storage failures, bundled request/CORS branches, CLI mode and generate-only branches, bridge resolve/reject paths, context fallback, plugin implications, transition capture failure, and notification validation/network/cache paths against their implementations.
- Browser verification used the T3 Chromium preview on the production server at `127.0.0.1:4317`. Both offline diagrams stayed visible through light → dark → light, received fresh SVG IDs and changed theme styles. A mutation observer recorded no missing SVGs; console error, page error, and unhandled rejection listeners recorded no errors. Eight rapid theme flips also finished in the requested theme without missing diagrams. Rapid clicks produced seven `AbortError: Transition was skipped` rejections from the theme toggle's View Transitions; ordinary toggles produced no errors.
- Mermaid 12.2.0 requires document layout, so rendering uses a hidden staging container outside the mounted figure. Effect finalization removes that container. Fully detached rendering was tried and failed because Mermaid looks up elements in the document.
- `pnpm --filter @radical/docs build`, `pnpm exec ultracite fix`, `pnpm exec ultracite check`, and `vp run ready`: passed.
- The verification server was stopped. No native builds or emulators ran.

## Second-pass verification

- `pnpm --filter @radical/docs build`: passed; all 44 docs pages prerendered among 48 static outputs.
- `pnpm exec ultracite fix` and `pnpm exec ultracite check`: passed.
- `vp run ready`: passed; all 11 tasks succeeded, including 519 tests across 63 files.
- All local links and fragments in edited pages resolve against the prerendered routes and HTML.
- No servers, native builds, or emulators started.

## First-pass verification

- `pnpm --filter @radical/docs build`: passed. All 44 docs routes appear in the prerender manifest; Next generated 48 static outputs including supporting routes.
- `pnpm exec ultracite fix` and `pnpm exec ultracite check`: passed.
- `vp run ready`: passed. Package builds, example type generation, docs build, Ultracite, Vite+ checks, Effect type checks, and all 519 tests across 63 test files passed.
- Production server started once on `127.0.0.1:4317`, then stopped. No native builds or emulators ran.
- Headless Chromium loaded every diagram page in light and dark mode: 20 rendered SVGs across 16 page visits, with no page or console errors. Architecture and transition screenshots were inspected in both themes.
- Platform tabs, introduction cards, and reference tables rendered.
- T3 preview DOM inspection succeeded; screenshot capture timed out twice, so browser verification used headless Chromium.

The renderer follows the [official Fumadocs Mermaid guide](https://www.fumadocs.dev/docs/markdown/mermaid), with Effect-owned Promise boundaries, serialized Mermaid initialization and rendering, strict SVG sanitization, and client-only rendering. `mermaid` and `next-themes` use the pnpm catalog. No release-age exclusions were added.
