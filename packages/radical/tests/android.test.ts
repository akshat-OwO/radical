import { createRequire } from "node:module";

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";

import echoSource from "../../../apps/example/plugins/EchoPlugin.java?raw";
import { generateAndroid } from "../src/android.ts";
import { AssetGenerationFailed } from "../src/asset-generation-failed.ts";
import type { AssetGeneration } from "../src/native-assets.ts";
import { AssetGenerator } from "../src/native-assets.ts";
import {
  NATIVE_CONTEXT_COOKIE,
  ShellContextSchema,
} from "../src/native-context.ts";
import { PluginModules } from "../src/plugin-modules.ts";
import type { PluginManifest } from "../src/plugins.ts";
import launch from "../templates/android/launch.html?raw";
import activity from "../templates/android/MainActivity.java?raw";
import gradle from "../templates/android/radical.gradle?raw";
import dataProtection from "../templates/android/RadicalDataProtectionPlugin.java?raw";
import transitions from "../templates/android/RadicalTransitionsPlugin.java?raw";
import fallback from "../templates/offline.html?raw";
import { echo } from "./fixtures/echo-plugin.ts";
import { image } from "./fixtures/image.ts";

const destination = "/app/.radical/android";
const mainActivity = `${destination}/android/app/src/main/java/dev/radical/example/MainActivity.java`;

/** Per-test files and command results, with no SDK, processes or real disk. */
const defaultConfig = { appId: "dev.radical.example" };
const memory = (
  fail = false,
  config: unknown = defaultConfig,
  manifest: PluginManifest = echo
) => {
  const files = new Map<string, string>([
    ["/app/plugins/EchoPlugin.java", echoSource],
    ["/package/templates/android/RadicalTransitionsPlugin.java", transitions],
    [
      "/package/templates/android/RadicalDataProtectionPlugin.java",
      dataProtection,
    ],
    [
      "/app/.radical/native.json",
      JSON.stringify({ config, url: "http://192.168.1.2:3000" }),
    ],
    ["/package/templates/android/MainActivity.java", activity],
    ["/package/templates/offline.html", fallback],
    ["/package/templates/android/launch.html", launch],
    ["/package/package.json", JSON.stringify({ version: "1.2.3" })],
    ["/package/templates/android/radical.gradle", gradle],
  ]);
  const require = createRequire(import.meta.url);
  for (const [name, version] of Object.entries({
    "@capacitor/core": "8.5.3",
    "@capacitor/android": "8.6.1",
    "@capacitor/device": "8.0.3",
  })) {
    files.set(
      require.resolve(`${name}/package.json`),
      JSON.stringify({ version })
    );
  }
  const commands: string[][] = [];
  const binaries = new Map<string, Uint8Array>();
  const assetCalls: AssetGeneration[] = [];
  const control = { failAssets: false };
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
    writeFileString: (name, content) =>
      Effect.sync(() => {
        files.set(name, content);
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

  it.effect("registers and includes the internal transitions source", () => {
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
  });

  it.effect(
    "generates a Capacitor project with the encoded shared native context",
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
    "renders one mixed-scheme cookie and keeps HTTPS-only hosts Secure",
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
    "packages SPA assets and keeps navigation local with both internal plugins",
    () => {
      const state = memory(false, {
        ...defaultConfig,
        mode: "bundled",
        origin: "https://api.example",
        allowlist: ["https://external.example"],
      });
      state.files.set(
        "/app/dist/client/_shell.html",
        "<!doctype html><title>SPA shell</title>"
      );
      state.files.set("/app/dist/client/assets/app.js", "application code");
      return Effect.gen(function* () {
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
      }).pipe(Effect.provide(state.layer));
    }
  );
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
        assert.include(error.message, "_shell.html");
        assert.strictEqual(
          state.files.get(`${destination}/previous.txt`),
          "usable shell"
        );
        assert.isEmpty(state.commands);
      }).pipe(Effect.provide(state.layer));
    }
  );
});
