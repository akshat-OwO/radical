// oxlint-disable unicorn/throw-new-error -- Schema.TaggedError is an Effect factory.
// oxlint-disable eslint/max-classes-per-file -- Rejection tests compare required-field and tag-only error classes.
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import {
  devicePlugin,
  transitionsPlugin,
} from "../../../src/core/plugins/internal-plugins.ts";
import {
  createPluginClient,
  definePlugin,
} from "../../../src/core/plugins/plugins.ts";
import type { PluginManifest } from "../../../src/core/plugins/plugins.ts";
import { resolvePluginDependencies } from "../../../src/vite/plugins/plugin-dependencies.ts";
import {
  PluginModules,
  pluginRegistration,
  resolvePlugins,
  validatePlugins,
} from "../../../src/vite/plugins/plugin-plan.ts";
import type { EnabledPlugin } from "../../../src/vite/plugins/plugin-plan.ts";
import { composePluginSources } from "../../../src/vite/plugins/plugin-sources.ts";
import {
  pluginTypeSource,
  pluginVirtualSource,
} from "../../../src/vite/plugins/plugin-virtual.ts";

class EchoRejected extends Schema.TaggedError<EchoRejected>()("EchoRejected", {
  reason: Schema.String,
}) {}

class TagOnlyRejected extends Schema.TaggedError<
  TagOnlyRejected,
  { readonly brand: unique symbol }
>()("EchoRejected", {}) {}

const echo = definePlugin({
  id: "echo",
  bridge: "Echo",
  dependencies: {},
  commands: {
    echo: {
      args: Schema.Struct({ text: Schema.String }),
      result: Schema.Struct({ text: Schema.String }),
      errors: { EchoRejected },
    },
  },
});

const entry = (manifest: PluginManifest = echo): EnabledPlugin => ({
  manifest,
  module: "./plugins/echo.ts",
  selector: "default",
});

const modules = (
  exports: Effect.Success<ReturnType<PluginModules["Service"]["load"]>>
) => Layer.succeed(PluginModules, { load: () => Effect.succeed(exports) });

const config = {
  appId: "dev.radical.test",
  internalPlugins: { device: false, transitions: false },
  plugins: [{ manifest: "./plugins/echo.ts" }],
};

const range = (id: string, value: string) =>
  entry({ ...echo, id, bridge: id, dependencies: { pkg: value } });

const failedCall = (cause: unknown) =>
  bridgeTestLayer("ios", (plugin, method) =>
    Effect.fail(new BridgeCallFailed({ plugin, method, cause }))
  );

// Only the filesystem service sees these files. Each test owns its own map.
const memory = () => {
  const files = new Map([
    [
      "/app/plugins/Echo.java",
      "@PluginMethod public void echo(PluginCall call) {}",
    ],
    ["/app/plugins/Echo.kt", "@PluginMethod fun echo(call: PluginCall) {}"],
    [
      "/app/plugins/Echo.swift",
      'CAPPluginMethod(name: "echo", returnType: CAPPluginReturnPromise)',
    ],
    ["/out/android/app/radical.gradle", "// base"],
    ["/out/android/build.gradle", "buildscript { dependencies { } }"],
    [
      "/out/android/app/build.gradle",
      "apply plugin: 'com.android.application'",
    ],
    ["/out/ios/App/App/AppDelegate.swift", "// base"],
    [
      "/out/ios/App/CapApp-SPM/Package.swift",
      '    dependencies: [\n], targets: [.target(dependencies: [.product(name: "Cordova", package: "capacitor-swift-pm")])]',
    ],
  ]);

  const layer = FileSystem.layerNoop({
    readFileString: (file) =>
      Effect.sync(() => {
        assert.isTrue(files.has(file), file);

        return files.get(file) ?? "";
      }),
    writeFileString: (file, content) =>
      Effect.sync(() => {
        files.set(file, content);
      }),
    makeDirectory: () => Effect.void,
  });

  return { files, layer };
};

const nativeEcho = definePlugin({
  ...echo,
  android: {
    className: "Echo",
    sources: [{ file: "Echo.java", source: "Echo.java" }],
    dependencies: { "org.example:core": "^1.0.0" },
  },
  ios: {
    className: "Echo",
    sources: [{ file: "Echo.swift", source: "Echo.swift" }],
    dependencies: [
      {
        url: "https://example.test/Core.git",
        version: "^1.0.0",
        product: "Core",
      },
    ],
  },
});

const compose = (platform: "android" | "ios", plugins = [entry(nativeEcho)]) =>
  composePluginSources(
    "/out",
    platform,
    "dev.test.app",
    plugins,
    "/app",
    "/package"
  );

describe("native plugin manifests", () => {
  for (const module of [
    "@akshatowo/radical/internal-plugins",
    "another-package/manifests",
  ]) {
    it.effect(`copies sources from an explicit root for ${module}`, () =>
      Effect.gen(function* () {
        const { files, layer } = memory();
        files.set(
          "/package/native/Echo.java",
          "@PluginMethod public void echo(PluginCall call) {}"
        );
        yield* compose("android", [
          { ...entry(nativeEcho), module, sourceRoot: "native" },
        ]).pipe(Effect.provide(layer));
        assert.strictEqual(
          files.get("/out/android/app/src/main/java/dev/test/app/Echo.java"),
          "package dev.test.app;\n@PluginMethod public void echo(PluginCall call) {}"
        );
      })
    );
  }

  it.effect(
    "rejects qualified iOS class names because Swift sources stay in the app module",
    () =>
      Effect.gen(function* () {
        const error = yield* validatePlugins([
          entry({
            ...nativeEcho,
            ios: { ...nativeEcho.ios, className: "OtherModule.Echo" },
          }),
        ]).pipe(Effect.flip);

        assert.strictEqual(error._tag, "InvalidPlugin");
        assert.include(error.message, "className");
      })
  );

  it.effect(
    "loads only explicitly enabled exports and preserves command codecs",
    () =>
      Effect.gen(function* () {
        const plugins = yield* resolvePlugins({
          ...config,
          plugins: [{ manifest: "./plugins/echo.ts", selector: "named" }],
        }).pipe(Effect.provide(modules({ named: echo })));

        assert.strictEqual(plugins.length, 1);
        assert.strictEqual(
          plugins[0].manifest.commands.echo.args,
          echo.commands.echo.args
        );
      })
  );
  it.effect("keeps internal device and transitions on by default", () =>
    Effect.gen(function* () {
      const plugins = yield* resolvePlugins({ appId: "dev.radical.test" }).pipe(
        Effect.provide(modules({}))
      );

      assert.deepStrictEqual(
        plugins.map(({ manifest }) => manifest.id),
        ["device", "transitions"]
      );
      assert.strictEqual(plugins[0].manifest, devicePlugin);
      assert.strictEqual(plugins[1].manifest, transitionsPlugin);
    })
  );

  for (const flag of ["notifications", "pushNotifications"] as const) {
    it.effect(`includes network when only ${flag} is enabled`, () =>
      Effect.gen(function* () {
        const plugins = yield* resolvePlugins({
          appId: "dev.radical.test",
          internalPlugins: { network: false, [flag]: true },
        }).pipe(Effect.provide(modules({})));

        const network = plugins.filter(
          ({ manifest }) => manifest.id === "network"
        );

        assert.strictEqual(network.length, 1);
        assert.strictEqual(
          network[0].manifest.dependencies["@capacitor/network"],
          "8.0.1"
        );
      })
    );
  }

  it.effect("does not load or emit disabled plugins", () =>
    Effect.gen(function* () {
      const plugins = yield* resolvePlugins({ ...config, plugins: [] }).pipe(
        Effect.provide(modules({}))
      );

      assert.isEmpty(plugins);
      assert.strictEqual(pluginRegistration(plugins, "ios"), "");
      assert.notInclude(pluginVirtualSource("/app", plugins), '"echo"');
      assert.notInclude(pluginTypeSource("/app", plugins), '"device"');
    })
  );
  it.effect("reports a missing manifest export selector", () =>
    Effect.gen(function* () {
      const error = yield* resolvePlugins(config).pipe(
        Effect.provide(modules({ wrong: echo })),
        Effect.flip
      );

      assert.strictEqual(error._tag, "InvalidPlugin");
      assert.include(error.message, "selector default");
    })
  );
  it.effect(
    "rejects invalid ids, bridge names, command names and non-schema declarations",
    () =>
      Effect.gen(function* () {
        for (const invalid of [
          { ...echo, id: "bad-id" },
          { ...echo, bridge: "bad.name" },
          { ...echo, commands: { "bad-name": echo.commands.echo } },
          { ...echo, commands: { echo: { ...echo.commands.echo, args: {} } } },
        ]) {
          const error = yield* resolvePlugins(config).pipe(
            Effect.provide(modules({ default: invalid })),
            Effect.flip
          );

          assert.strictEqual(error._tag, "InvalidPlugin");
          assert.include(error.message, "./plugins/echo.ts");
        }
      })
  );
  it.effect("rejects duplicate ids and bridges", () =>
    Effect.gen(function* () {
      for (const other of [echo, { ...echo, id: "other" }]) {
        const error = yield* validatePlugins([entry(), entry(other)]).pipe(
          Effect.flip
        );

        assert.strictEqual(error._tag, "InvalidPlugin");
        assert.include(error.message, "Duplicate");
      }
    })
  );
  it.effect("rejects empty command sets and mismatched error tags", () =>
    Effect.gen(function* () {
      const manifests: PluginManifest[] = [
        { ...echo, commands: {} },
        {
          ...echo,
          commands: {
            echo: { ...echo.commands.echo, errors: { WrongTag: EchoRejected } },
          },
        },
      ];

      for (const manifest of manifests) {
        const error = yield* validatePlugins([entry(manifest)]).pipe(
          Effect.flip
        );

        assert.strictEqual(error._tag, "InvalidPlugin");
      }
    })
  );
  it.effect("validates config selectors and their schema", () =>
    Effect.gen(function* () {
      const plugin = entry({
        ...echo,
        config: {
          selector: "Echo",
          schema: Schema.Struct({ prefix: Schema.String }),
        },
      });

      for (const options of [{}, { Echo: { prefix: 1 } }]) {
        const error = yield* validatePlugins([plugin], options).pipe(
          Effect.flip
        );

        assert.strictEqual(error._tag, "InvalidPlugin");
        assert.include(error.message, "Echo");
      }

      assert.strictEqual(
        (yield* validatePlugins([plugin], { Echo: { prefix: "Hello" } }))
          .length,
        1
      );
    })
  );
  it.effect("detects npm, Gradle and SPM conflicts with both plugin ids", () =>
    Effect.gen(function* () {
      const other = {
        ...nativeEcho,
        id: "other",
        bridge: "Other",
        android: {
          ...nativeEcho.android,
          className: "Other",
          sources: [],
          dependencies: { "org.example:core": "^2.0.0" },
        },
        ios: {
          ...nativeEcho.ios,
          className: "Other",
          sources: [],
          dependencies: [
            { ...nativeEcho.ios.dependencies[0], version: "^2.0.0" },
          ],
        },
      };

      const cases = [
        [
          entry({ ...echo, dependencies: { pkg: "^1" } }),
          entry({
            ...echo,
            id: "other",
            bridge: "Other",
            dependencies: { pkg: "^2" },
          }),
        ],
        [entry(nativeEcho), entry(other)],
        [
          entry({ ...nativeEcho, android: undefined }),
          entry({ ...other, android: undefined }),
        ],
      ];

      for (const plugins of cases) {
        const error = yield* validatePlugins(plugins).pipe(Effect.flip);
        assert.strictEqual(error._tag, "PluginDependencyConflict");
        assert.include(error.message, "echo requires");
        assert.include(error.message, "other requires");
      }
    })
  );
  it.effect(
    "finds a shared version for unions and detects a three-way empty intersection",
    () =>
      Effect.gen(function* () {
        const resolved = yield* resolvePluginDependencies([
          range("one", "^1 || ^3"),
          range("two", ">=3.2 <4"),
        ]);

        assert.strictEqual(resolved.get("npm:pkg"), "3.2.0");

        const error = yield* validatePlugins([
          range("one", "1 || 2"),
          range("two", "2 || 3"),
          range("three", "1 || 3"),
        ]).pipe(Effect.flip);

        assert.strictEqual(error._tag, "PluginDependencyConflict");
      })
  );
  it.effect("rejects different SPM URLs with the same package identity", () =>
    Effect.gen(function* () {
      const error = yield* resolvePluginDependencies([
        entry(nativeEcho),
        entry({
          ...echo,
          id: "other",
          bridge: "Other",
          ios: {
            ...nativeEcho.ios,
            dependencies: [
              {
                ...nativeEcho.ios.dependencies[0],
                url: "https://other.test/core.git",
              },
            ],
          },
        }),
      ]).pipe(Effect.flip);

      assert.strictEqual(error._tag, "PluginDependencyConflict");
      assert.include(error.message, "core");
      assert.include(error.message, "other");
    })
  );
  it.effect("reports invalid dependency ranges and source collisions", () =>
    Effect.gen(function* () {
      for (const plugins of [
        [entry({ ...echo, dependencies: { pkg: "latest" } })],
        [
          entry(nativeEcho),
          entry({ ...nativeEcho, id: "other", bridge: "Other" }),
        ],
        [
          entry({
            ...nativeEcho,
            android: {
              ...nativeEcho.android,
              sources: [{ file: "../Escape.java", source: "Echo.java" }],
            },
          }),
        ],
      ]) {
        assert.strictEqual(
          (yield* validatePlugins(plugins).pipe(Effect.flip))._tag,
          "InvalidPlugin"
        );
      }
    })
  );
  it.effect(
    "generates command stubs and declarations for the selected manifest export",
    () =>
      Effect.gen(function* () {
        const enabled = [entry()];
        assert.include(
          pluginVirtualSource("/app", enabled),
          'import { default as manifest0 } from "/app/plugins/echo.ts"'
        );
        assert.include(
          pluginVirtualSource("/app", enabled),
          '"echo": createPluginClient(manifest0)'
        );
        assert.include(
          pluginTypeSource("/app", enabled),
          'PluginClient<typeof import("/app/plugins/echo.ts")["default"]>'
        );
        assert.include(
          pluginRegistration([entry(nativeEcho)], "android"),
          "registerPlugin(Echo.class)"
        );
        assert.include(
          pluginRegistration([entry(nativeEcho)], "ios"),
          "registerPluginInstance(Echo())"
        );
        yield* Effect.void;
      })
  );
});

describe("plugin bridge commands", () => {
  it.effect(
    "preserves BridgeCallFailed for invalid rejection data including tag-only errors",
    () =>
      Effect.gen(function* () {
        const emptyPlugin = definePlugin({
          ...echo,
          commands: {
            echo: {
              ...echo.commands.echo,
              errors: {
                EchoRejected: TagOnlyRejected,
              },
            },
          },
        });

        for (const data of [null, undefined, [], "invalid"]) {
          const cause = { code: "EchoRejected", data };

          for (const manifest of [echo, emptyPlugin]) {
            const error = yield* createPluginClient(manifest)
              .echo({ text: "deny" })
              .pipe(Effect.provide(failedCall(cause)), Effect.flip);

            assert.strictEqual(error._tag, "BridgeCallFailed");

            if (error._tag === "BridgeCallFailed") {
              assert.strictEqual(error.cause, cause);
            }
          }
        }
      })
  );

  it.effect(
    "encodes arguments and decodes results through an in-memory bridge",
    () =>
      Effect.gen(function* () {
        const client = createPluginClient(echo);

        const result = yield* client.echo({ text: "hello" }).pipe(
          Effect.provide(
            bridgeTestLayer("ios", (plugin, method, args) => {
              assert.strictEqual(plugin, "Echo");
              assert.strictEqual(method, "echo");
              assert.deepStrictEqual(args, { text: "hello" });

              return Effect.succeed({ text: "Native: hello" });
            })
          )
        );

        assert.deepStrictEqual(result, { text: "Native: hello" });
      })
  );
  it.effect(
    "maps a native rejection code and data to a declared TaggedError instance",
    () =>
      Effect.gen(function* () {
        const error = yield* createPluginClient(echo)
          .echo({ text: "deny" })
          .pipe(
            Effect.provide(
              failedCall({ code: "EchoRejected", data: { reason: "Denied" } })
            ),
            Effect.flip
          );

        assert.instanceOf(error, EchoRejected);

        if (error._tag === "EchoRejected") {
          assert.strictEqual(error.reason, "Denied");
        }
      })
  );
  it.effect(
    "preserves BridgeCallFailed for undeclared codes and malformed declared error data",
    () =>
      Effect.gen(function* () {
        for (const cause of [
          { code: "Other" },
          { code: "constructor" },
          { code: "EchoRejected", data: { reason: 1 } },
          "failure",
        ]) {
          const error = yield* createPluginClient(echo)
            .echo({ text: "deny" })
            .pipe(Effect.provide(failedCall(cause)), Effect.flip);

          assert.strictEqual(error._tag, "BridgeCallFailed");

          if (error._tag === "BridgeCallFailed") {
            assert.strictEqual(error.cause, cause);
          }
        }
      })
  );
  it.effect("reports malformed native results as BridgeDecodeError", () =>
    Effect.gen(function* () {
      const error = yield* createPluginClient(echo)
        .echo({ text: "hello" })
        .pipe(
          Effect.provide(
            bridgeTestLayer("android", () => Effect.succeed({ text: 1 }))
          ),
          Effect.flip
        );

      assert.strictEqual(error._tag, "BridgeDecodeError");
    })
  );
  it.effect(
    "preserves typed failures after a delayed bridge response using TestClock",
    () =>
      Effect.gen(function* () {
        const fiber = yield* createPluginClient(echo)
          .echo({ text: "deny" })
          .pipe(
            Effect.provide(
              bridgeTestLayer("ios", (plugin, method) =>
                Effect.fail(
                  new BridgeCallFailed({
                    plugin,
                    method,
                    cause: {
                      code: "EchoRejected",
                      data: { reason: "Delayed" },
                    },
                  })
                ).pipe(Effect.delay("1 second"))
              )
            ),
            Effect.flip,
            Effect.forkChild
          );

        yield* TestClock.adjust("1 second");
        assert.instanceOf(yield* Fiber.join(fiber), EchoRejected);
      })
  );
});

describe("native plugin source composition", () => {
  it.effect(
    "requires fully qualified Android classes when sources are dependency-provided",
    () => {
      const state = memory();

      return Effect.gen(function* () {
        const android = { className: "Echo", sources: [], dependencies: {} };

        const error = yield* compose("android", [
          entry({ ...echo, android }),
        ]).pipe(Effect.flip);

        assert.strictEqual(error._tag, "InvalidPlugin");

        if (error._tag === "InvalidPlugin") {
          assert.include(
            error.message,
            "fully qualified dependency-provided class"
          );
        }

        const plugins = [
          entry({
            ...echo,
            android: { ...android, className: "com.example.Echo" },
          }),
        ];

        yield* compose("android", plugins);
        assert.strictEqual(
          pluginRegistration(plugins, "android"),
          "registerPlugin(com.example.Echo.class);"
        );
        assert.isFalse(
          state.files.has(
            "/out/android/app/src/main/java/dev/test/app/Echo.java"
          )
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "rejects Android source classes that do not match the generated package and filename",
    () =>
      Effect.gen(function* () {
        for (const className of [
          "com.example.Echo",
          "Missing",
          "dev.test.app.Missing",
        ]) {
          const state = memory();

          const plugin = entry({
            ...nativeEcho,
            android: { ...nativeEcho.android, className },
          });

          const error = yield* compose("android", [plugin]).pipe(
            Effect.provide(state.layer),
            Effect.flip
          );

          assert.strictEqual(error._tag, "InvalidPlugin");

          if (error._tag === "InvalidPlugin") {
            assert.include(error.message, "Plugin echo: android class");
            assert.include(error.message, className);
            assert.include(error.message, "dev.test.app.Echo");
          }

          assert.isFalse(
            state.files.has(
              "/out/android/app/src/main/java/dev/test/app/Echo.java"
            )
          );
        }
      })
  );

  it.effect(
    "rejects undeclared Java and Kotlin commands with parenthesized annotations",
    () =>
      Effect.gen(function* () {
        for (const extension of ["java", "kt"]) {
          for (const annotation of [
            "@PluginMethod()",
            "@PluginMethod(returnType = PluginMethod.RETURN_PROMISE)",
          ]) {
            const state = memory();

            const method =
              extension === "java"
                ? "public void hidden(PluginCall call) {}"
                : "fun hidden(call: PluginCall) {}";

            const file = `/app/plugins/Echo.${extension}`;
            state.files.set(
              file,
              `${state.files.get(file)} ${annotation} ${method}`
            );

            const plugin = entry({
              ...nativeEcho,
              android: {
                ...nativeEcho.android,
                sources: [
                  { file: `Echo.${extension}`, source: `Echo.${extension}` },
                ],
              },
            });

            const error = yield* compose("android", [plugin]).pipe(
              Effect.provide(state.layer),
              Effect.flip
            );

            assert.strictEqual(error._tag, "InvalidPlugin");

            if (error._tag === "InvalidPlugin") {
              assert.include(error.message, "command hidden is not declared");
            }
          }
        }
      })
  );

  it.effect(
    "composes Java and Kotlin commands with every PluginMethod annotation form",
    () =>
      Effect.gen(function* () {
        for (const extension of ["java", "kt"]) {
          for (const annotation of [
            "@PluginMethod",
            "@PluginMethod()",
            "@PluginMethod(returnType = PluginMethod.RETURN_PROMISE)",
          ]) {
            const state = memory();

            const method =
              extension === "java"
                ? "public void echo(PluginCall call) {}"
                : "public fun echo(call: PluginCall) {}";

            state.files.set(
              `/app/plugins/Echo.${extension}`,
              `${annotation} ${method}`
            );

            const plugin = entry({
              ...nativeEcho,
              android: {
                ...nativeEcho.android,
                sources: [
                  { file: `Echo.${extension}`, source: `Echo.${extension}` },
                ],
              },
            });

            yield* compose("android", [plugin]).pipe(
              Effect.provide(state.layer)
            );
            assert.include(
              state.files.get(
                `/out/android/app/src/main/java/dev/test/app/Echo.${extension}`
              ) ?? "",
              `${annotation} ${method}`
            );
          }
        }
      })
  );

  it.effect(
    "copies Java sources with the app package and shared Gradle versions",
    () => {
      const state = memory();

      return Effect.gen(function* () {
        yield* compose("android", [
          entry(nativeEcho),
          entry({
            ...echo,
            id: "other",
            bridge: "Other",
            android: {
              className: "org.example.Other",
              sources: [],
              dependencies: { "org.example:core": ">=1.5 <2" },
            },
          }),
        ]);
        assert.include(
          state.files.get(
            "/out/android/app/src/main/java/dev/test/app/Echo.java"
          ) ?? "",
          "package dev.test.app;"
        );
        assert.include(
          state.files.get("/out/android/app/radical.gradle") ?? "",
          'implementation "org.example:core:1.5.0"'
        );
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("copies Kotlin sources", () => {
    const state = memory();

    return Effect.gen(function* () {
      yield* compose("android", [
        entry({
          ...nativeEcho,
          android: {
            ...nativeEcho.android,
            sources: [{ file: "Echo.kt", source: "Echo.kt" }],
          },
        }),
      ]);
      assert.include(
        state.files.get(
          "/out/android/app/src/main/java/dev/test/app/Echo.kt"
        ) ?? "",
        "fun echo"
      );
      assert.include(
        state.files.get("/out/android/build.gradle") ?? "",
        "kotlin-gradle-plugin:2.2.21"
      );
      assert.include(
        state.files.get("/out/android/app/build.gradle") ?? "",
        "org.jetbrains.kotlin.android"
      );
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("adds Swift sources and SPM package products", () => {
    const state = memory();

    return Effect.gen(function* () {
      yield* compose("ios");
      assert.include(
        state.files.get("/out/ios/App/App/AppDelegate.swift") ?? "",
        'CAPPluginMethod(name: "echo"'
      );

      const spm =
        state.files.get("/out/ios/App/CapApp-SPM/Package.swift") ?? "";

      assert.include(
        spm,
        '.package(url: "https://example.test/Core.git", exact: "1.0.0")'
      );
      assert.include(spm, '.product(name: "Core", package: "core")');
    }).pipe(Effect.provide(state.layer));
  });
  it.effect(
    "rejects missing and undeclared native commands on both platforms",
    () =>
      Effect.gen(function* () {
        for (const platform of ["android", "ios"] as const) {
          for (const content of [
            "// no command",
            platform === "android"
              ? "@PluginMethod public void echo(PluginCall call) {} @PluginMethod public void hidden(PluginCall call) {}"
              : 'CAPPluginMethod(name: "echo") CAPPluginMethod(name: "hidden")',
          ]) {
            const state = memory();
            state.files.set(
              `/app/plugins/Echo.${platform === "android" ? "java" : "swift"}`,
              content
            );

            const error = yield* compose(platform).pipe(
              Effect.provide(state.layer),
              Effect.flip
            );

            assert.strictEqual(error._tag, "InvalidPlugin");

            if (error._tag === "InvalidPlugin") {
              assert.include(error.message, "command");
            }
          }
        }
      })
  );
  it.effect("omits disabled sources and native dependencies", () => {
    const state = memory();

    return Effect.gen(function* () {
      yield* compose("android", []);
      yield* compose("ios", []);
      assert.isFalse(
        state.files.has("/out/android/app/src/main/java/dev/test/app/Echo.java")
      );
      assert.strictEqual(
        state.files.get("/out/android/app/radical.gradle"),
        "// base"
      );
      assert.notInclude(
        state.files.get("/out/ios/App/App/AppDelegate.swift") ?? "",
        "CAPPluginMethod"
      );
      assert.notInclude(
        state.files.get("/out/ios/App/CapApp-SPM/Package.swift") ?? "",
        "example.test"
      );
    }).pipe(Effect.provide(state.layer));
  });
});
