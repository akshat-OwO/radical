import { createRequire } from "node:module";

import { assert, describe, it } from "@effect/vitest";
import {
  Effect,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Schema,
  Stdio,
  Terminal,
} from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";

import echoSource from "../../../../../apps/example/plugins/EchoPlugin.java?raw";
import { RadicalAdapter } from "../../../src/core/adapter/adapter.ts";
import {
  NATIVE_CONTEXT_COOKIE,
  ShellContextSchema,
} from "../../../src/core/context/native-context.ts";
import type { PluginManifest } from "../../../src/core/plugins/plugins.ts";
import { CliNative, cliNativeLayer, makeCli } from "../../../src/entry/cli.ts";
import { CliVite } from "../../../src/entry/prepare-native.ts";
import { generateAndroid } from "../../../src/native/android/generate.ts";
import { AssetGenerationFailed } from "../../../src/native/assets/errors.ts";
import type { AssetGeneration } from "../../../src/native/assets/native-assets.ts";
import { AssetGenerator } from "../../../src/native/assets/native-assets.ts";
import {
  NativeMetadata,
  nativeMetadataLayer,
} from "../../../src/native/shared/native-metadata.ts";
import { BuildPlanApi } from "../../../src/vite/build-plan-api.ts";
import { resolveBuildPlan } from "../../../src/vite/build-plan.ts";
import { PluginModules } from "../../../src/vite/plugins/plugin-modules.ts";
import daemonJvm from "../../../templates/android/gradle-daemon-jvm.properties?raw";
import launch from "../../../templates/android/launch.html?raw";
import activity from "../../../templates/android/MainActivity.java?raw";
import gradle from "../../../templates/android/radical.gradle?raw";
import dataProtection from "../../../templates/android/RadicalDataProtectionPlugin.java?raw";
import locationSource from "../../../templates/android/RadicalLocationPlugin.java?raw";
import settings from "../../../templates/android/RadicalSettingsPlugin.java?raw";
import transitions from "../../../templates/android/RadicalTransitionsPlugin.java?raw";
import fallback from "../../../templates/offline.html?raw";
import { adapterOutputs, fakeAdapter } from "../../fixtures/adapter.ts";
import { echo } from "../../fixtures/echo-plugin.ts";
import { image } from "../../fixtures/image.ts";

const destination = "/app/.radical/android";
const mainActivity = `${destination}/android/app/src/main/java/dev/radical/example/MainActivity.java`;

/** Per-test files and command results, with no SDK, processes or real disk. */
const defaultConfig = { appId: "dev.radical.example" };

const memory = (
  fail = false,
  config: Schema.Json = defaultConfig,
  manifest: PluginManifest = echo
) => {
  const files = new Map<string, string>([
    ["/package/templates/android/RadicalSettingsPlugin.java", settings],
    ["/package/templates/android/RadicalLocationPlugin.java", locationSource],
    ["/app/plugins/EchoPlugin.java", echoSource],
    ["/package/templates/android/RadicalTransitionsPlugin.java", transitions],
    [
      "/package/templates/android/RadicalDataProtectionPlugin.java",
      dataProtection,
    ],
    [
      "/app/.radical/native.json",
      JSON.stringify({
        config,
        url: "http://192.168.1.2:3000",
        outputs: adapterOutputs,
      }),
    ],
    ["/package/templates/android/MainActivity.java", activity],
    ["/package/templates/offline.html", fallback],
    ["/package/templates/android/launch.html", launch],
    ["/package/package.json", JSON.stringify({ version: "1.2.3" })],
    ["/package/templates/android/radical.gradle", gradle],
    ["/package/templates/android/gradle-daemon-jvm.properties", daemonJvm],
  ]);

  const require = createRequire(import.meta.url);

  for (const [name, version] of Object.entries({
    "@capacitor/core": "8.5.3",
    "@capacitor/android": "8.6.1",
    "@capacitor/device": "8.0.3",
    "@capacitor/geolocation": "8.2.4",
  })) {
    files.set(
      require.resolve(`${name}/package.json`),
      JSON.stringify({ version })
    );
  }

  const commands: string[][] = [];
  const binaries = new Map<string, Uint8Array>();
  const assetCalls: AssetGeneration[] = [];
  const control = { failAssets: false, existingDaemonJvm: false };

  const fs = FileSystem.layerNoop({
    readFile: (name) =>
      Effect.suspend(() => {
        const bytes = binaries.get(name);

        return bytes === undefined
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFile",
                pathOrDescriptor: name,
              })
            )
          : Effect.succeed(bytes);
      }),
    readFileString: (name) =>
      Effect.suspend(() => {
        const content = files.get(name);

        return content === undefined
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: name,
              })
            )
          : Effect.succeed(content);
      }),
    writeFileString: (name, content, options) =>
      Effect.suspend(() => {
        if (options?.flag === "wx" && files.has(name)) {
          return Effect.fail(
            PlatformError.systemError({
              _tag: "AlreadyExists",
              module: "FileSystem",
              method: "writeFileString",
              pathOrDescriptor: name,
            })
          );
        }

        files.set(name, content);

        return Effect.void;
      }),
    copy: (from, to) =>
      Effect.sync(() => {
        for (const [key, value] of files) {
          if (key.startsWith(`${from}/`)) {
            files.set(to + key.slice(from.length), value);
          }
        }
      }),
    makeDirectory: () => Effect.void,
    symlink: (from, to) =>
      Effect.sync(() => {
        files.set(to, from);
      }),
    remove: (name) =>
      Effect.sync(() => {
        for (const key of files.keys()) {
          if (key === name || key.startsWith(`${name}/`)) {
            files.delete(key);
          }
        }
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        for (const [key, value] of files) {
          if (key === from || key.startsWith(`${from}/`)) {
            files.set(to + key.slice(from.length), value);
            files.delete(key);
          }
        }
      }),
  });

  const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
    ...ChildProcessSpawner.make(() => Effect.die("Unexpected spawn")),
    exitCode: (command) =>
      Effect.sync(() => {
        assert.strictEqual(command._tag, "StandardCommand");

        if (command._tag === "StandardCommand") {
          commands.push([...command.args]);

          if (control.existingDaemonJvm) {
            files.set(
              `${command.options.cwd}/android/gradle/gradle-daemon-jvm.properties`,
              "toolchainVersion=25"
            );
          }

          files.set(
            `${command.options.cwd}/android/app/src/main/AndroidManifest.xml`,
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"></manifest>'
          );
          files.set(
            `${command.options.cwd}/android/app/src/main/res/values/styles.xml`,
            '<resources><style name="AppTheme.NoActionBarLaunch"><item name="android:background">@drawable/splash</item></style></resources>'
          );
          files.set(
            `${command.options.cwd}/android/app/build.gradle`,
            "// Capacitor app"
          );
          files.set(
            `${command.options.cwd}/android/generated.txt`,
            "Capacitor 8"
          );
        }

        return ChildProcessSpawner.ExitCode(fail ? 1 : 0);
      }),
  });

  return {
    files,
    binaries,
    assetCalls,
    control,
    commands,
    layer: Layer.mergeAll(
      fs,
      spawner,
      Layer.succeed(AssetGenerator, {
        generate: (input) =>
          Effect.suspend(() => {
            assetCalls.push(input);

            return control.failAssets
              ? Effect.fail(
                  new AssetGenerationFailed({
                    message: "Fake generator failed",
                  })
                )
              : Effect.void;
          }),
      }),
      Layer.succeed(PluginModules, {
        load: (module) =>
          module === "./plugins/echo.ts"
            ? Effect.succeed({ default: manifest })
            : Effect.die("Unexpected manifest load"),
      })
    ),
  };
};

const generate = generateAndroid("/app", "/package");

describe("Android shell generation", () => {
  for (const mode of ["remote", "bundled"] as const) {
    for (const generateOnly of [false, true]) {
      it.effect(
        `pins JDK 21 with cross-platform download URLs in ${mode} mode${generateOnly ? " with --generate-only" : ""}`,
        () => {
          const config = {
            ...defaultConfig,
            mode,
            origin: "https://api.example",
          };

          const state = memory(false, config);
          state.files.set("/app/web/public/entry.html", "<!doctype html>");

          const plan = resolveBuildPlan(config).pipe(
            Effect.provide(state.layer)
          );

          const cliLayer = Layer.mergeAll(
            Path.layer,
            Stdio.layerTest({}),
            Layer.succeed(
              Terminal.Terminal,
              Terminal.make({
                columns: Effect.succeed(80),
                rows: Effect.succeed(24),
                readInput: Effect.die("Unexpected input"),
                readLine: Effect.die("Unexpected input"),
                display: () => Effect.void,
              })
            ),
            Layer.succeed(CliVite, {
              resolve: () =>
                Effect.succeed({
                  root: "/app",
                  plugins: [
                    {
                      name: "radical:config",
                      api: new BuildPlanApi(() => plan),
                    },
                  ],
                }),
              build: Effect.void,
            }),
            Layer.effect(
              CliNative,
              Effect.gen(function* () {
                const native = yield* CliNative;

                return {
                  ...native,
                  generateAndroid: (root, _packageRoot, prepared) =>
                    generateAndroid(root, "/package", prepared),
                  runAndroid: () =>
                    Effect.die("Generate-only must not launch Android"),
                };
              })
            ).pipe(Layer.provide(cliNativeLayer))
          );

          return Effect.gen(function* () {
            yield* generateOnly
              ? Command.runWith(makeCli("/app"), {
                  version: "0.0.0",
                  renderErrors: false,
                })(["android", "--generate-only"])
              : generate;

            const properties =
              state.files.get(
                `${destination}/android/gradle/gradle-daemon-jvm.properties`
              ) ?? "";

            assert.strictEqual(properties, daemonJvm);
            assert.include(properties, "toolchainVersion=21\n");

            for (const platform of [
              "MAC_OS.AARCH64",
              "MAC_OS.X86_64",
              "LINUX.AARCH64",
              "LINUX.X86_64",
              "WINDOWS.X86_64",
            ]) {
              assert.match(
                properties,
                new RegExp(
                  `^toolchainUrl\\.${platform.replaceAll(".", "\\.")}=https\\\\://api\\.foojay\\.io/disco/v3\\.0/ids/[a-f0-9]+/redirect$`,
                  "mu"
                )
              );
            }

            assert.notInclude(properties, "toolchainVendor");
            assert.notInclude(properties, "org.gradle.java.home");
            assert.strictEqual(state.commands.length, 1);
          }).pipe(Effect.provide(Layer.mergeAll(cliLayer, state.layer)));
        }
      );
    }
  }

  it.effect(
    "rejects pre-existing daemon JVM criteria and keeps the previous shell",
    () => {
      const state = memory();
      state.control.existingDaemonJvm = true;
      state.files.set(`${destination}/previous.txt`, "usable shell");

      return Effect.gen(function* () {
        const error = yield* Effect.flip(generate);
        assert.strictEqual(error._tag, "NativeTemplateMismatch");

        if (error._tag === "NativeTemplateMismatch") {
          assert.strictEqual(
            error.file,
            `${destination}.next/android/gradle/gradle-daemon-jvm.properties`
          );
          assert.include(error.anchor, "absent");
        }

        assert.strictEqual(
          state.files.get(`${destination}/previous.txt`),
          "usable shell"
        );
        assert.isFalse(
          [...state.files.keys()].some((key) =>
            key.startsWith(`${destination}.next/`)
          )
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "generates topic-record cleanup even when notifications are disabled",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        internalPlugins: {
          dataProtection: true,
          notifications: false,
          pushNotifications: false,
        },
      });

      return Effect.gen(function* () {
        yield* generate;

        const source =
          state.files.get(
            `${destination}/android/app/src/main/java/dev/radical/example/RadicalDataProtectionPlugin.java`
          ) ?? "";

        assert.include(
          source,
          'getSharedPreferences("radical.notificationTopics", android.content.Context.MODE_PRIVATE).edit().clear().commit()'
        );
        assert.include(
          source,
          'call.reject("Cannot clear notification topic membership")'
        );
        assert.notInclude(source, "class RadicalNotificationTopicsPlugin");
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "generates data protection without the disabled transitions class",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        internalPlugins: { dataProtection: true, transitions: false },
      });

      return Effect.gen(function* () {
        yield* generate;

        const source =
          state.files.get(
            `${destination}/android/app/src/main/java/dev/radical/example/RadicalDataProtectionPlugin.java`
          ) ?? "";

        assert.include(source, "class RadicalDataProtectionPlugin");
        assert.notInclude(source, "__OFFLINE_SAVED_URL_KEY__");
        assert.include(source, 'remove("lastOfflineUrl")');
        assert.notInclude(source, "RadicalTransitionsPlugin");
        assert.include(
          state.files.get(mainActivity) ?? "",
          "RadicalDataProtectionPlugin"
        );
        assert.notInclude(
          state.files.get(mainActivity) ?? "",
          "RadicalTransitionsPlugin"
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "generates Echo with matching source path, package and registered class",
    () =>
      Effect.gen(function* () {
        for (const className of [
          "EchoPlugin",
          "dev.radical.example.EchoPlugin",
        ]) {
          const state = memory(
            false,
            {
              ...defaultConfig,
              plugins: [{ manifest: "./plugins/echo.ts" }],
              pluginOptions: { Echo: { prefix: "Native: " } },
            },
            { ...echo, android: { ...echo.android, className } }
          );

          yield* generate.pipe(Effect.provide(state.layer));

          const source =
            state.files.get(
              `${destination}/android/app/src/main/java/dev/radical/example/EchoPlugin.java`
            ) ?? "";

          assert.match(source, /^package dev\.radical\.example;/u);
          assert.include(source, "public class EchoPlugin extends Plugin");
          assert.include(
            state.files.get(mainActivity) ?? "",
            `registerPlugin(${className}.class);`
          );
        }
      })
  );

  it.effect(
    "omits disabled internal dependencies, registration and sources",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        internalPlugins: { device: false, transitions: false },
      });

      return Effect.gen(function* () {
        yield* generate;
        assert.notInclude(
          state.files.get(`${destination}/package.json`) ?? "",
          "@capacitor/device"
        );
        assert.isFalse(
          state.files.has(`${destination}/node_modules/@capacitor/device`)
        );
        assert.notInclude(
          state.files.get(mainActivity) ?? "",
          "RadicalTransitionsPlugin"
        );
        assert.notInclude(
          state.files.get(
            `${destination}/android/app/src/main/java/dev/radical/example/RadicalTransitionsPlugin.java`
          ) ?? "",
          "class RadicalTransitionsPlugin"
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "emits the transitions Java class and its registration call",
    () => {
      const state = memory();

      return Effect.gen(function* () {
        yield* generate;
        assert.include(
          state.files.get(mainActivity) ?? "",
          "registerPlugin(RadicalTransitionsPlugin.class)"
        );
        assert.include(
          state.files.get(
            `${destination}/android/app/src/main/java/dev/radical/example/RadicalTransitionsPlugin.java`
          ) ?? "",
          "class RadicalTransitionsPlugin"
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "emits a Capacitor project with the native-context cookie and Java safe-area expressions",
    () => {
      const state = memory();

      return Effect.gen(function* () {
        assert.strictEqual(yield* generate, destination);
        assert.strictEqual(state.commands.length, 1);

        const generatedPackage =
          state.files.get(`${destination}/package.json`) ?? "";

        const { dependencies } = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              dependencies: Schema.Record(Schema.String, Schema.String),
            })
          )
        )(generatedPackage);

        assert.deepStrictEqual(dependencies, {
          "@capacitor/core": "8.5.3",
          "@capacitor/android": "8.6.1",
          "@capacitor/device": "8.0.3",
        });
        assert.isTrue(
          state.files
            .get(`${destination}/node_modules/@capacitor/device`)
            ?.endsWith("node_modules/@capacitor/device")
        );
        assert.deepStrictEqual(state.commands[0].slice(-2), ["add", "android"]);
        const source = state.files.get(mainActivity) ?? "";

        const cookie = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.String)
        )(/COOKIE = (?<cookie>.+);/u.exec(source)?.groups?.cookie);

        const [name, value] = cookie.split("=");
        assert.strictEqual(name, NATIVE_CONTEXT_COOKIE);

        const context = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(ShellContextSchema)
        )(decodeURIComponent(value ?? ""));

        assert.deepStrictEqual(context, {
          platform: "android",
          shellVersion: "1.2.3",
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        assert.include(source, "CookieManager");
        assert.include(
          source,
          `OFFLINE_FALLBACK = ${JSON.stringify(fallback)};`
        );
        assert.notInclude(source, "__OFFLINE_FALLBACK__");
        assert.include(source, "bars.top / density");
        assert.include(source, 'context.put("safeArea", area)');
        assert.include(
          source,
          "WindowCompat.setDecorFitsSystemWindows(getWindow(), false)"
        );
        assert.notInclude(source, "v.setPadding(");
        assert.include(source, "if (!started)");
        assert.include(source, "window.__radical");

        const nativeConfig = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              android: Schema.Struct({
                resolveServiceWorkerRequests: Schema.Boolean,
              }),
              plugins: Schema.Struct({
                SystemBars: Schema.Struct({ insetsHandling: Schema.String }),
              }),
            })
          )
        )(state.files.get(`${destination}/capacitor.config.json`) ?? "{}");

        assert.isFalse(nativeConfig.android.resolveServiceWorkerRequests);
        assert.deepStrictEqual(nativeConfig.plugins.SystemBars, {
          insetsHandling: "disable",
        });
        assert.include(source, "addDocumentStartJavaScript(view, GUARD");
        assert.include(
          state.files.get(`${destination}/android/app/build.gradle`) ?? "",
          "apply from: 'radical.gradle'"
        );
        assert.notInclude(source, "__APP_ID__");
        assert.notInclude(source, "__COOKIE__");
        assert.include(source, 'Arrays.asList("http://192.168.1.2:3000")');
        assert.include(
          state.files.get(`${destination}/capacitor.config.json`) ?? "",
          '"cleartext":true'
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "emits deduplicated Java cookie calls with Secure only for HTTPS-only hosts",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        allowlist: [
          "https://192.168.1.2",
          "https://secure.test",
          "https://secure.test:8443",
        ],
      });

      return Effect.gen(function* () {
        yield* generate;
        const source = state.files.get(mainActivity) ?? "";
        assert.include(
          source,
          'cookies.setCookie("http://192.168.1.2:3000", COOKIE + "; Path=/; HttpOnly; SameSite=Lax");'
        );
        assert.include(
          source,
          'cookies.setCookie("https://secure.test", COOKIE + "; Path=/; HttpOnly; SameSite=Lax; Secure");'
        );
        assert.strictEqual(source.match(/cookies.setCookie/gu)?.length, 2);
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect("rejects an Android template missing the cookie anchor", () => {
    const state = memory();
    state.files.set(
      "/package/templates/android/MainActivity.java",
      activity.replace("__COOKIES__", "")
    );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(generate);
      assert.strictEqual(error._tag, "NativeTemplateMismatch");
      assert.deepStrictEqual(state.commands, []);
    }).pipe(Effect.provide(state.layer));
  });

  it.effect(
    "replaces stale files and produces identical project content on rerun",
    () => {
      const state = memory();

      return Effect.gen(function* () {
        yield* generate;

        const first = [...state.files].toSorted(([a], [b]) =>
          a.localeCompare(b)
        );

        state.files.set(`${destination}/stale.txt`, "old shell");
        state.files.set(
          `${destination}.next/abandoned.txt`,
          "interrupted generation"
        );
        yield* generate;
        assert.deepStrictEqual(
          [...state.files].toSorted(([a], [b]) => a.localeCompare(b)),
          first
        );
        assert.strictEqual(state.commands.length, 2);
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "keeps the previous project and removes staging when Capacitor fails",
    () => {
      const state = memory(true);
      state.files.set(`${destination}/previous.txt`, "usable shell");

      return Effect.gen(function* () {
        const error = yield* Effect.flip(generate);
        assert.strictEqual(error._tag, "ShellCommandError");
        assert.strictEqual(
          state.files.get(`${destination}/previous.txt`),
          "usable shell"
        );
        assert.isFalse(
          [...state.files.keys()].some((key) =>
            key.startsWith(`${destination}.next/`)
          )
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "rejects invalid configuration before generating or executing commands",
    () => {
      const state = memory(false, { appId: "../outside" });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(generate);
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.deepStrictEqual(state.commands, []);
        assert.isFalse(state.files.has(mainActivity));
      }).pipe(Effect.provide(state.layer));
    }
  );
});

describe("android app identity", () => {
  it.effect(
    "reports invalid android fallback and explicit ids with an actionable typed error",
    () =>
      Effect.gen(function* () {
        for (const config of [
          { appId: "dev.class.app" },
          { ...defaultConfig, android: { packageId: "dev.class.app" } },
        ]) {
          const state = memory(false, config);

          const error = yield* Effect.flip(
            generate.pipe(Effect.provide(state.layer))
          );

          assert.strictEqual(error._tag, "InvalidConfig");
          assert.include(error.message, "android");
          assert.include(error.message, "dev.class.app");
          assert.include(error.message, "android.packageId");
          assert.include(error.message, "Java keyword");
          assert.isEmpty(state.commands);
        }

        const state = memory(false, {
          appId: "dev.class.app",
          android: { packageId: "dev.valid.app" },
        });

        yield* generate.pipe(Effect.provide(state.layer));
        assert.include(
          state.files.get(`${destination}/capacitor.config.json`) ?? "",
          "dev.valid.app"
        );
        assert.isNotEmpty(state.commands);
      })
  );

  it.effect(
    "regenerates the platform identity and passes changed icon and splash pixels to the generator",
    () => {
      const config = {
        ...defaultConfig,
        name: "Shared",
        android: { name: "Platform name", packageId: "dev.custom.shell" },
        icon: "icon.png",
        splash: { image: "splash.png", backgroundColor: "#241044" },
      };

      const state = memory(false, config);

      return Effect.gen(function* () {
        state.binaries.set("/app/icon.png", yield* image(1024));
        state.binaries.set("/app/splash.png", yield* image(2732));
        yield* generate;

        const nativeConfig = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({ appId: Schema.String, appName: Schema.String })
          )
        )(state.files.get(`${destination}/capacitor.config.json`) ?? "");

        assert.deepStrictEqual(nativeConfig, {
          appId: "dev.custom.shell",
          appName: "Platform name",
        });
        assert.strictEqual(state.assetCalls[0].platform, "android");
        assert.strictEqual(state.assetCalls[0].backgroundColor, "#241044");
        const first = state.assetCalls[0].assets;
        state.binaries.set("/app/icon.png", yield* image(1024, "#ff0000"));
        state.binaries.set("/app/splash.png", yield* image(2732, "#00ff00"));
        state.files.set(
          "/app/.radical/native.json",
          JSON.stringify({
            config: {
              ...config,
              android: { ...config.android, name: "Renamed shell" },
            },
            url: "http://192.168.1.2:3000",
          })
        );
        yield* generate;
        assert.include(
          state.files.get(`${destination}/capacitor.config.json`) ?? "",
          '"appName":"Renamed shell"'
        );
        assert.strictEqual(state.assetCalls.length, 2);
        assert.notDeepEqual(
          state.assetCalls[1].assets.find(
            ({ file }) => file === "icon-only.png"
          )?.bytes,
          first.find(({ file }) => file === "icon-only.png")?.bytes
        );
        assert.notDeepEqual(
          state.assetCalls[1].assets.find(({ file }) => file === "splash.png")
            ?.bytes,
          first.find(({ file }) => file === "splash.png")?.bytes
        );
        assert.include(
          state.files.get(
            `${destination}/android/app/src/main/res/values/styles.xml`
          ) ?? "",
          '<item name="windowSplashScreenBackground">#241044</item>'
        );
        assert.include(
          state.files.get(
            `${destination}/android/app/src/main/res/values/styles.xml`
          ) ?? "",
          '<item name="windowSplashScreenAnimatedIcon">@drawable/radical_splash_icon</item>'
        );
        const prefix = `${destination}/android/app/src/main/java/dev/custom/shell`;
        assert.include(
          state.files.get(`${prefix}/MainActivity.java`) ?? "",
          "package dev.custom.shell;"
        );
        assert.include(
          state.files.get(`${prefix}/RadicalTransitionsPlugin.java`) ?? "",
          "package dev.custom.shell;"
        );
        assert.isFalse(state.files.has(mainActivity));
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect("keeps the previous shell when the asset generator fails", () => {
    const state = memory(false, { ...defaultConfig, icon: "icon.png" });

    return Effect.gen(function* () {
      state.binaries.set("/app/icon.png", yield* image(1024));
      state.files.set(`${destination}/previous.txt`, "usable shell");
      state.control.failAssets = true;
      const error = yield* Effect.flip(generate);
      assert.strictEqual(error._tag, "AssetGenerationFailed");
      assert.strictEqual(
        state.files.get(`${destination}/previous.txt`),
        "usable shell"
      );
      assert.isFalse(
        [...state.files.keys()].some((key) =>
          key.startsWith(`${destination}.next/`)
        )
      );
    }).pipe(Effect.provide(state.layer));
  });

  it.effect("rejects a missing icon before invoking any tool", () => {
    const state = memory(false, { ...defaultConfig, icon: "missing.png" });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(generate);
      assert.strictEqual(error._tag, "InvalidAsset");
      assert.include(error.message, "/app/missing.png");
      assert.isEmpty(state.commands);
      assert.isEmpty(state.assetCalls);
    }).pipe(Effect.provide(state.layer));
  });
});

describe("bundled android shell", () => {
  it.effect(
    "packages a fake adapter's SPA outputs and emits local-navigation config and Java branches",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        mode: "bundled",
        origin: "https://api.example",
        allowlist: ["https://external.example"],
      });

      state.files.set(
        "/app/web/public/entry.html",
        "<!doctype html><title>SPA shell</title>"
      );
      state.files.set("/app/web/public/assets/app.js", "application code");

      return Effect.gen(function* () {
        const adapter = yield* RadicalAdapter;
        const outputs = yield* adapter.outputs;
        const metadata = yield* NativeMetadata;
        const saved = yield* metadata.read("/app");
        state.files.set(
          "/app/.radical/native.json",
          JSON.stringify({ config: saved.config, url: saved.url })
        );
        yield* metadata.update("/app", saved.config, undefined, outputs);
        yield* generate;
        assert.strictEqual(
          state.files.get(`${destination}/www/index.html`),
          "<!doctype html><title>SPA shell</title>"
        );
        assert.strictEqual(
          state.files.get(`${destination}/www/assets/app.js`),
          "application code"
        );

        const config = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              server: Schema.Struct({
                url: Schema.optional(Schema.String),
                allowNavigation: Schema.Array(Schema.String),
              }),
            })
          )
        )(state.files.get(`${destination}/capacitor.config.json`) ?? "");

        assert.isUndefined(config.server.url);
        assert.deepStrictEqual(config.server.allowNavigation, []);
        const source = state.files.get(mainActivity) ?? "";
        assert.include(source, "https://localhost");
        assert.notInclude(source, '"https://external.example"');
        assert.include(source, "RadicalTransitionsPlugin");
        assert.include(source, "window.__radicalNativeContext=");
        assert.include(
          state.files.get(`${destination}/package.json`) ?? "",
          "@capacitor/device"
        );
        assert.include(source, "BUNDLED = true");
        assert.include(source, "BUNDLED ? URL :");
        assert.include(source, "BUNDLED ? super.shouldInterceptRequest");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            state.layer,
            fakeAdapter,
            nativeMetadataLayer.pipe(Layer.provide(state.layer))
          )
        )
      );
    }
  );

  for (const outputs of [undefined, { clientDir: "web/public" }]) {
    it.effect(
      `rejects ${outputs === undefined ? "missing adapter outputs" : "an adapter without a SPA shell"} before replacing a bundled project`,
      () => {
        const state = memory(false, {
          ...defaultConfig,
          mode: "bundled",
          origin: "https://api.example",
        });

        state.files.set(
          "/app/.radical/native.json",
          JSON.stringify({
            config: {
              ...defaultConfig,
              mode: "bundled",
              origin: "https://api.example",
            },
            url: "https://api.example",
            outputs,
          })
        );
        state.files.set(`${destination}/previous.txt`, "usable shell");

        return Effect.gen(function* () {
          const error = yield* Effect.flip(generate);
          assert.strictEqual(error._tag, "InvalidConfig");
          assert.include(error.message, "adapter");
          assert.strictEqual(
            state.files.get(`${destination}/previous.txt`),
            "usable shell"
          );
          assert.isEmpty(state.commands);
        }).pipe(Effect.provide(state.layer));
      }
    );
  }

  it.effect(
    "rejects missing SPA output before replacing an existing shell",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        mode: "bundled",
        origin: "https://api.example",
      });

      state.files.set(`${destination}/previous.txt`, "usable shell");

      return Effect.gen(function* () {
        const error = yield* Effect.flip(generate);
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, "entry.html");
        assert.strictEqual(
          state.files.get(`${destination}/previous.txt`),
          "usable shell"
        );
        assert.isEmpty(state.commands);
      }).pipe(Effect.provide(state.layer));
    }
  );
});

it.effect(
  "generates coarse and fine location declarations and registers settings and lifecycle support",
  () => {
    const state = memory(false, {
      ...defaultConfig,
      internalPlugins: { location: true },
      pluginOptions: { Location: { usageDescription: "Find me" } },
    });

    return Effect.gen(function* () {
      yield* generateAndroid("/app", "/package");

      const manifest =
        state.files.get(
          `${destination}/android/app/src/main/AndroidManifest.xml`
        ) ?? "";

      assert.include(manifest, "android.permission.ACCESS_COARSE_LOCATION");
      assert.include(manifest, "android.permission.ACCESS_FINE_LOCATION");
      assert.notInclude(manifest, "ACCESS_BACKGROUND_LOCATION");

      const source =
        state.files.get(
          `${destination}/android/app/src/main/java/dev/radical/example/RadicalLocationPlugin.java`
        ) ?? "";

      assert.include(source, "ACTION_LOCATION_SOURCE_SETTINGS");
      assert.include(source, "super.checkPermissions(call)");
      assert.include(source, "super.requestPermissions(call)");
      assert.include(
        source,
        '@Permission(alias = "coarseLocation", strings = { Manifest.permission.ACCESS_COARSE_LOCATION })'
      );
      assert.include(
        source,
        '@Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION })'
      );
      assert.include(
        source,
        "@PermissionCallback @PluginMethod public void checkPermissions"
      );
      assert.include(
        source,
        "GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS"
      );
      assert.include(source, "if (playServicesAvailable == null)");
      assert.include(
        state.files.get(`${destination}/android/app/radical.gradle`) ?? "",
        "com.google.android.gms:play-services-base:18.5.0"
      );
      assert.include(source, "handleOnPause");
      assert.include(
        state.files.get(mainActivity) ?? "",
        "RadicalLocationPlugin.class"
      );
      assert.include(
        state.files.get(`${destination}/package.json`) ?? "",
        '"@capacitor/geolocation":"8.2.4"'
      );
    }).pipe(Effect.provide(state.layer));
  }
);
