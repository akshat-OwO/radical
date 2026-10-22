# 0003: Native plugin manifests

Native plugins use Schema-defined TypeScript modules so one declaration supplies generation validation, runtime codecs, and app types. Loose JSON cannot carry codecs or reconstruct a declared error class. `definePlugin` preserves the concrete schema types. `PluginManifestSchema` validates the module before generation.

## Capacitor import boundary

Capacitor remains replaceable. Only `packages/radical/src/core/plugins/internal-plugins.ts`, `packages/radical/src/native/shared/native-project.ts`, and `packages/radical/src/native/assets/native-assets.ts` may import its packages. These modules own plugin manifests and shell generation. Other library modules and `apps/example` use Radical's bridge and plugin manifests.

`no-restricted-imports` in `oxlint.config.ts` enforces this exact allowlist for static imports, string-literal `import()` expressions, re-exports, and type-only imports. The shared `packages/radical/tests/capacitor-boundary-policy.ts` module supplies both checks with the scope pattern and exact allowlist. Oxlint does not check template-literal import arguments or CommonJS require calls, so `capacitor-boundary.test.ts` also parses library and example sources, including tests, in a sorted, deterministic file walk. That check covers dynamic imports with string or template arguments, including templates whose known prefix names a restricted scope, and import types. It also checks `require()`, `require.resolve()`, direct `createRequire(...)(specifier)` and `createRequire(...).resolve(specifier)` calls, and calls through bound results or simple same-scope aliases. Computed specifiers remain outside the check, matching `import(name)`. It ignores comments and unrelated strings. Tests have no exception. The restriction covers the `@capacitor`, `@capacitor-community`, `@capgo`, and `@capawesome` scopes, including all package subpaths. Whole scopes cover official plugins and the third-party providers used by the manifests, including `@capgo/camera-preview` and `@capawesome/capacitor-google-sign-in`, without maintaining a list of individual plugins. When a manifest adds a provider outside these scopes, extend the shared scope pattern.

## Manifest contract

A module exports a manifest, by default as its default export. The manifest has these fields:

- `id`: the key used by web code. `bridge`: the Capacitor plugin name. Both are identifiers beginning with a letter, followed by letters, digits, or underscores. Enabled ids and bridge names must be unique.
- `dependencies`: npm package names mapped to semver ranges. This includes Capacitor plugin packages. Radical resolves installed packages from the app, checks their versions against every requirement, and includes only enabled dependencies in the generated package. Capacitor discovers and registers packaged plugins during project creation.
- `commands`: command names mapped to `{ args, result, errors }`. Arguments encode to an object. Results decode from the native response. `errors` maps rejection codes to `Schema.TaggedError` classes whose tag equals that code. Codecs must not require services.
- Optional `config`: `{ selector, schema }`. The selector names a top-level key in `pluginOptions`. Generation requires that key and validates its value. It writes the selected value under the manifest's `bridge` name in Capacitor config.
- Optional `android`: `{ className, sources, dependencies }`. With copied sources, `className` must match the basename of a copied Java or Kotlin file. It may be unqualified or qualified with exactly the Android package id, which defaults to the app id. For Android package id `dev.example.app` and `EchoPlugin.java`, both `EchoPlugin` and `dev.example.app.EchoPlugin` register the generated class; `com.other.EchoPlugin` fails with `InvalidPlugin`. An empty `sources` array instead registers a dependency-provided class and requires its fully qualified name; the declared npm or Gradle dependencies must supply it. Sources are `{ file, source }` entries. `source` resolves relative to the manifest module. `file` is a simple Java or Kotlin filename. Sources omit a package declaration; generation supplies the app package. Dependencies map Maven `group:artifact` coordinates to semver ranges. Kotlin sources enable the shell's Kotlin 2.2.21 compiler with Java 21.
- Optional `ios`: `{ className, sources, dependencies }`. `className` is unqualified because copied Swift files compile into the app module without an Android-style package rewrite. Swift filenames need not match class names. Sources name Swift files with the same relative-path convention. If `sources` is empty, the class must already be visible to the app through its compiled imports; packaged Capacitor plugins normally use npm discovery without an `ios` registration block. Each dependency has an HTTPS `url`, semver `version` range, and Swift package `product`.

Source manifests declare every exposed promise command. Java methods use `@PluginMethod public void name(...)`, Kotlin methods use `@PluginMethod fun name(...)`, and Swift uses `CAPPluginMethod(name: "name", ...)`. Android annotations may also use `@PluginMethod()` or `@PluginMethod(returnType = PluginMethod.RETURN_PROMISE)`. Generation checks these declarations against `commands` in both directions. Packaged Capacitor plugins own their implementation and registration metadata; their manifest declares the commands radical exposes. There is no native language parser or command inference for packaged plugins.

## Enablement and composition

Custom plugins are off until listed in config:

```ts
radical({
  appId: "dev.example.app",
  plugins: [{ manifest: "./plugins/echo.ts", selector: "default" }],
  pluginOptions: { Echo: { prefix: "Native: " } },
  internalPlugins: { device: true, transitions: true },
});
```

`selector` selects a module export and defaults to `default`. It is separate from the manifest's config selector. Local manifest paths resolve from Vite's root. Package exports resolve from the app. Manifest modules must be importable by Node, including its native TypeScript support, and browser-safe because the virtual module imports them. Keep filesystem and other build-only work outside manifest modules.

Camera is opt-in with `internalPlugins.camera: true` and validated `pluginOptions.Camera.usageDescription`. Its manifest pins `@capacitor/camera@8.2.6`; generation adds Android camera permission and optional camera hardware, and the iOS camera and photo-library usage descriptions. See [ADR 0005](0005-camera-capability-hooks.md) for its hook and permission contract. The file picker (`internalPlugins.filePicker`) and intents (`internalPlugins.intents`, two manifests for URLs and files) are also opt-in internal plugins; see [ADR 0006](0006-files-and-intents.md).

Device info and Transitions are on by default to preserve the existing `getDeviceInfo` and navigation behavior. Either can be disabled with `internalPlugins`. They use the same validation, client codecs, dependency planning, and composition as custom plugins. Device adds `@capacitor/device`; Transitions contributes native source and explicit shell registration. Safe-area events and native context remain shell infrastructure.

Generation copies Android sources into `android.packageId`, or `appId` when no package override is set, and registers their classes before bridge creation. It appends Swift source contents to the compiled AppDelegate file and registers instances in `capacitorDidLoad`. Combining Swift files avoids editing Xcode project references. Gradle dependencies enter `radical.gradle`. SPM dependencies enter the generated package's dependency list and target products. Several products can share one SPM package. Package identities use the lowercase repository name; different URLs with the same identity conflict. The shell owns `capacitor-swift-pm`, so manifests do not add it again.

All enabled requirements for each npm package, Maven coordinate, or SPM URL must have a common semver intersection. Native dependencies pin the lowest version in that intersection. npm dependencies use the installed version, which must satisfy every manifest. These rules do not resolve transitive dependency conflicts. Generation stages the project and replaces the previous project only after successful composition.

## Validation and errors

`InvalidPlugin` reports the offending manifest or plugin and constraint. Invalid module export selectors, identifiers, codecs, config selectors, error tags, dependency ranges, source filenames, duplicate native classes or filenames, missing native command declarations, and undeclared exposed commands fail generation. Examples include `Plugin echo: config selector Echo does not resolve` and `Plugin echo: ios command hidden is not declared in the manifest`.

`PluginDependencyConflict` names the dependency and each plugin's requirement, such as `Conflicting dependency npm:pkg: one requires ^1, two requires ^2`. Disabled manifests are never loaded, validated, imported into the virtual module, or copied into projects. Their dependencies and config are omitted.

## Web types and typed failures

`virtual:radical/plugins` exports `plugins`, keyed by enabled manifest ids. `plugins.echo.echo({ text: "hello" })` returns an Effect whose success, error, and argument types come from that command's schemas. It requires the `Bridge` service. Apps supply `BridgeLive` or a test layer.

Vite writes `.radical/plugins.d.ts` during config resolution. Each enabled property references `PluginClient<typeof import("...")["exportName"]>`. This preserves exact schema and error class types without duplicating them in a declaration generator. Apps include that file in tsconfig. `radical typegen` resolves Vite config without starting a server, so clean checkouts can generate types before typechecking. Generated declarations stay gitignored.

The stub encodes arguments, calls the bridge, and decodes successful results. Encoding or result validation failures become `BridgeDecodeError`. Native code rejects with a code and data, for example Android `call.reject("Rejected", "EchoRejected", data)` or iOS `call.reject("Rejected", "EchoRejected", nil, data)`. The stub decodes `{ ...data, _tag: code }` with the command's declared error schema and fails with that error instance. Unknown codes and invalid declared error data retain the original `BridgeCallFailed`. Explicit null, array, or non-object rejection data is invalid even for tag-only errors. `BridgeUnavailable` retains its existing meaning.

The example app enables Echo with typed arguments, results, and `EchoRejected`. A compile-only assertion checks incorrect arguments, undeclared commands, and disabled plugins. Bridge tests use in-memory layers and TestClock. React hook generation remains in #16.
