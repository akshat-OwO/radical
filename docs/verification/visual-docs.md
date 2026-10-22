# Visual docs verification

Base commit: `754e2f7d70783b8801a8ea8879aaf46f6711865f`. Issue: [#92](https://github.com/akshat-OwO/radical/issues/92).

## Prose counts

Counts exclude frontmatter, fenced code, Markdown tables, and component markup, including diagram definitions and TypeTable props. Visible component children and headings count as prose. Inline symbols count as words. The same counter measures the base and working tree.

| Section      | Before | After |
| ------------ | -----: | ----: |
| Introduction |    220 |    88 |
| Tutorial     |    374 |   374 |
| Guides       |   2548 |  2514 |
| Reference    |   4066 |  2315 |
| Explanation  |   1634 |   812 |
| Total        |   8842 |  6103 |

Prose decreases by 2,739 words, or 31.0%.

### Per page

| Page                                 | Before | After |
| ------------------------------------ | -----: | ----: |
| `explanation/bridge.mdx`             |    243 |   123 |
| `explanation/delivery-modes.mdx`     |    393 |   178 |
| `explanation/native-context.mdx`     |    274 |   125 |
| `explanation/native-shells.mdx`      |    237 |   149 |
| `explanation/offline-caching.mdx`    |    286 |   117 |
| `explanation/plugin-model.mdx`       |    201 |   120 |
| `guides/app-assets.mdx`              |    109 |    97 |
| `guides/bundled-mode.mdx`            |    323 |   265 |
| `guides/camera.mdx`                  |    115 |   114 |
| `guides/custom-plugins.mdx`          |    117 |   122 |
| `guides/data-protection.mdx`         |    127 |   121 |
| `guides/device-info.mdx`             |     69 |    71 |
| `guides/files.mdx`                   |    143 |   149 |
| `guides/firebase.mdx`                |    154 |   155 |
| `guides/google-sign-in.mdx`          |    163 |   171 |
| `guides/haptics.mdx`                 |    103 |    97 |
| `guides/network.mdx`                 |     64 |    64 |
| `guides/notification-navigation.mdx` |    106 |   137 |
| `guides/notifications.mdx`           |    317 |   279 |
| `guides/offline-routes.mdx`          |    138 |   147 |
| `guides/run-on-a-device.mdx`         |    188 |   176 |
| `guides/safe-area.mdx`               |     89 |    94 |
| `guides/transitions.mdx`             |     85 |   110 |
| `guides/video-stream.mdx`            |    138 |   145 |
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
| `tutorials/create-an-app.mdx`        |    374 |   374 |

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

Source paths below are relative to `packages/radical/`. All diagram contracts were checked against the base source.

| Page | Diagrams | Source |
| --- | --- | --- |
| `explanation/native-shells` | Architecture; generate, build, install, launch | `src/vite/vite.ts`, `src/vite/build-plan.ts`, `src/adapters/tanstack-start/tanstack-start.ts`, `src/entry/prepare-native.ts`, `src/entry/cli.ts`, `src/native/shared/native-project.ts`, `src/native/android/run.ts`, `src/native/ios/run.ts` |
| `explanation/delivery-modes` | Remote and bundled requests | `src/core/bundled/bundled-request.ts`, `src/core/bundled/bundled-server.ts`, `src/adapters/tanstack-start/tanstack-middleware.ts`, `src/adapters/tanstack-start/tanstack-start-server.ts`, `src/adapters/tanstack-start/tanstack-outputs.ts` |
| `explanation/bridge` | Manifest command sequence | `src/core/bridge/bridge.ts`, `src/core/plugins/plugins.ts` |
| `explanation/native-context` | Context transport and mount handoff | `src/core/context/native-context.ts`, `src/core/bundled/bundled-request.ts`, `src/entry/server.ts`, `src/capabilities/safe-area/safe-area.ts`, `src/capabilities/safe-area/safe-area-style.ts` |
| `explanation/offline-caching` | Snapshot lifecycle; shell startup recovery | `src/core/offline/offline-worker.ts`, `src/core/offline/offline-entry.ts`, `src/core/offline/native-offline.ts`, `src/core/offline/offline-protocol.ts`, `templates/android/MainActivity.java`, `templates/ios/RadicalViewController.swift` |
| `explanation/plugin-model` | Manifest resolution and internal implications | `src/core/plugins/plugins.ts`, `src/core/plugins/internal-plugin-registry.ts`, `src/vite/plugins/plugin-plan.ts`, `src/vite/native-contributions.ts` |
| `guides/transitions` | Cover, commit, reveal, remove with overlay IDs | `src/capabilities/transitions/native-transitions.ts`, `src/adapters/tanstack-start/tanstack-native-transitions.ts`, `templates/android/RadicalTransitionsPlugin.java`, `templates/ios/RadicalTransitionsPlugin.swift` |
| `guides/notification-navigation` | Tap validation and snapshot navigation | `src/capabilities/notifications/notification-navigation.ts`, `src/capabilities/notifications/notification-schema.ts` |

## Verification

- `pnpm --filter @radical/docs build`: passed. All 44 docs routes appear in the prerender manifest; Next generated 48 static outputs including supporting routes.
- `pnpm exec ultracite fix` and `pnpm exec ultracite check`: passed.
- `vp run ready`: passed. Package builds, example type generation, docs build, Ultracite, Vite+ checks, Effect type checks, and all 519 tests across 63 test files passed.
- Production server started once on `127.0.0.1:4317`, then stopped. No native builds or emulators ran.
- Headless Chromium loaded every diagram page in light and dark mode: 20 rendered SVGs across 16 page visits, with no page or console errors. Architecture and transition screenshots were inspected in both themes.
- Platform tabs, introduction cards, and reference tables rendered.
- T3 preview DOM inspection succeeded; screenshot capture timed out twice, so browser verification used headless Chromium.

The renderer follows the [official Fumadocs Mermaid guide](https://www.fumadocs.dev/docs/markdown/mermaid), with Effect-owned Promise boundaries, serialized Mermaid initialization and rendering, strict SVG sanitization, and client-only rendering. `mermaid` and `next-themes` use the pnpm catalog. No release-age exclusions were added.
