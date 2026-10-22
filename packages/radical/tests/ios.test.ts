import { createRequire } from "node:module";

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";

import echoSource from "../../../apps/example/plugins/EchoPlugin.swift?raw";
import { AssetGenerationFailed } from "../src/asset-generation-failed.ts";
import { generateIos } from "../src/ios.ts";
import type { AssetGeneration } from "../src/native-assets.ts";
import { AssetGenerator } from "../src/native-assets.ts";
import {
  NATIVE_CONTEXT_COOKIE,
  ShellContextSchema,
} from "../src/native-context.ts";
import { PluginModules } from "../src/plugin-modules.ts";
import launchScreen from "../templates/ios/LaunchScreen.storyboard?raw";
import dataProtection from "../templates/ios/RadicalDataProtectionPlugin.swift?raw";
import transitions from "../templates/ios/RadicalTransitionsPlugin.swift?raw";
import activity from "../templates/ios/RadicalViewController.swift?raw";
import offlinePage from "../templates/offline.html?raw";
import { echo } from "./fixtures/echo-plugin.ts";
import { image } from "./fixtures/image.ts";

const destination = "/app/.radical/ios";
const appDelegate = `${destination}/ios/App/App/AppDelegate.swift`;

/** Per-test files and command results, with no SDK, processes or real disk. */
const defaultConfig = { appId: "dev.radical.example" };
const memory = (
  fail = false,
  config: unknown = defaultConfig,
  url = "http://192.168.1.2:3000",
  mismatch = ""
) => {
  const files = new Map<string, string>([
    ["/app/plugins/EchoPlugin.swift", echoSource],
    ["/package/templates/ios/RadicalTransitionsPlugin.swift", transitions],
    [
      "/package/templates/ios/RadicalDataProtectionPlugin.swift",
      dataProtection,
    ],
    ["/app/.radical/native.json", JSON.stringify({ config, url })],
    ["/package/templates/ios/RadicalViewController.swift", activity],
    ["/package/templates/ios/LaunchScreen.storyboard", launchScreen],
    ["/package/templates/offline.html", offlinePage],
    ["/package/package.json", JSON.stringify({ version: "1.2.3" })],
  ]);
  const require = createRequire(import.meta.url);
  for (const [name, version] of Object.entries({
    "@capacitor/assets": "3.0.5",
    "@capacitor/core": "8.5.3",
    "@capacitor/ios": "8.6.1",
    "@capacitor/device": "8.0.3",
    "@capacitor/camera": "8.2.6",
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
          const app = `${command.options.cwd}/ios/App/App`;
          files.set(
            `${app}/AppDelegate.swift`,
            "import UIKit\n// Capacitor app"
          );
          files.set(
            `${app}/SceneDelegate.swift`,
            "window?.rootViewController = CAPBridgeViewController()"
          );
          files.set(
            `${app}/Base.lproj/Main.storyboard`,
            '<viewController customClass="CAPBridgeViewController" customModule="Capacitor"/>'
          );
          files.set(
            `${app}/Info.plist`,
            "<plist><dict><key>Nested</key><dict><key>Keep</key><true/></dict></dict></plist>"
          );
          if (mismatch) {
            files.set(`${app}/${mismatch}`, "upstream template changed");
          }
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
            ? Effect.succeed({ default: echo })
            : Effect.die("Unexpected manifest load"),
      })
    ),
  };
};

const generate = generateIos("/app", "/package");

describe("iOS shell generation", () => {
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
        const source = state.files.get(appDelegate) ?? "";
        assert.include(
          source,
          'UserDefaults.standard.removeObject(forKey: "radical.notificationTopics")'
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
        const source = state.files.get(appDelegate) ?? "";
        assert.include(source, "class RadicalDataProtectionPlugin");
        assert.notInclude(source, "RadicalTransitionsPlugin");
        assert.include(
          state.files.get(appDelegate) ?? "",
          "RadicalDataProtectionPlugin"
        );
        assert.notInclude(
          state.files.get(appDelegate) ?? "",
          "RadicalTransitionsPlugin"
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect("includes the Echo Swift class used by shell registration", () => {
    const state = memory(false, {
      ...defaultConfig,
      plugins: [{ manifest: "./plugins/echo.ts" }],
      pluginOptions: { Echo: { prefix: "Native: " } },
    });
    return Effect.gen(function* () {
      yield* generate;
      const source = state.files.get(appDelegate) ?? "";
      assert.include(source, "bridge?.registerPluginInstance(EchoPlugin())");
      assert.include(
        source,
        "public class EchoPlugin: CAPPlugin, CAPBridgedPlugin"
      );
    }).pipe(Effect.provide(state.layer));
  });

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
          state.files.get(appDelegate) ?? "",
          "RadicalTransitionsPlugin"
        );
        assert.notInclude(
          state.files.get(appDelegate) ?? "",
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
        state.files.get(appDelegate) ?? "",
        "registerPluginInstance(RadicalTransitionsPlugin())"
      );
      assert.include(
        state.files.get(appDelegate) ?? "",
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
          "@capacitor/ios": "8.6.1",
          "@capacitor/device": "8.0.3",
        });
        assert.isTrue(
          state.files
            .get(`${destination}/node_modules/@capacitor/device`)
            ?.endsWith("node_modules/@capacitor/device")
        );
        assert.deepStrictEqual(state.commands[0].slice(-2), ["add", "ios"]);
        const source = state.files.get(appDelegate) ?? "";
        const value = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.String)
        )(
          /let seed = (?<cookie>"[^"]+")\.removingPercentEncoding/u.exec(source)
            ?.groups?.cookie
        );
        assert.include(source, `.name: "${NATIVE_CONTEXT_COOKIE}"`);
        const context = yield* Schema.decodeEffect(
          Schema.fromJsonString(ShellContextSchema)
        )(decodeURIComponent(value ?? ""));
        assert.deepStrictEqual(context, {
          platform: "ios",
          shellVersion: "1.2.3",
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        assert.include(source, "httpCookieStore.setCookie");
        assert.include(source, "view.window != nil");
        assert.include(source, "let insets = view.safeAreaInsets");
        assert.include(source, "override func viewSafeAreaInsetsDidChange()");
        assert.include(source, "self.view.safeAreaInsets != insets");
        assert.include(source, "contentInsetAdjustmentBehavior = .automatic");
        assert.include(source, "window.__radical");
        assert.include(source, 'HTTPCookiePropertyKey("HttpOnly"): "TRUE"');
        assert.include(
          source,
          ".sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax"
        );
        assert.include(source, "if secure");
        assert.include(
          source,
          "private func startNavigation() { super.viewDidLoad() }"
        );
        assert.notInclude(source, "__COOKIE_VALUE__");
        assert.include(source, '["http://192.168.1.2:3000"]');
        assert.include(
          state.files.get(
            `${destination}/ios/App/App/Base.lproj/Main.storyboard`
          ) ?? "",
          'customClass="RadicalViewController" customModule="App" customModuleProvider="target"'
        );
        assert.strictEqual(
          state.files.get(`${destination}/ios/App/App/SceneDelegate.swift`),
          "window?.rootViewController = RadicalViewController()"
        );
        assert.strictEqual(
          state.files.get(`${destination}/ios/App/App/Info.plist`),
          "<plist><dict><key>Nested</key><dict><key>Keep</key><true/></dict><key>WKAppBoundDomains</key><array><string>192.168.1.2</string></array><key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>\n</dict>\n</plist>"
        );
        assert.include(source, "decisionHandler(.cancel)");
        assert.include(
          source,
          'origins.contains("\\(scheme)://\\(host)\\(suffix)")'
        );
        assert.include(source, "configuration.websiteDataStore = .default()");
        assert.include(source, "loadHTMLString(");
        assert.include(source, "x-radical-offline-fallback");
        assert.include(source, "radical.lastOfflineURL");
        assert.include(source, "errorPathURL: bridge?.config.errorPathURL");
        assert.include(source, "guard allowed(url) || url == errorPathURL");
        assert.include(source, "recoveryCancellations.insert(navigation)");
        assert.include(source, "recoveryCancellations.remove($0) != nil");
        assert.include(
          source,
          "handleFailure(webView, navigation: navigation, error: error)"
        );
        const config = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              ios: Schema.Struct({
                limitsNavigationsToAppBoundDomains: Schema.Boolean,
              }),
            })
          )
        )(state.files.get(`${destination}/capacitor.config.json`) ?? "{}");
        assert.isTrue(config.ios.limitsNavigationsToAppBoundDomains);
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "deduplicates exact origins and omits ATS exceptions for HTTPS",
    () => {
      const state = memory(
        false,
        {
          ...defaultConfig,
          allowlist: [
            "https://app.test",
            "https://app.test:8443",
            "https://app.test:8443",
          ],
        },
        "https://app.test"
      );
      return Effect.gen(function* () {
        yield* generate;
        const source = state.files.get(appDelegate) ?? "";
        assert.include(source, '["https://app.test", "https://app.test:8443"]');
        const plist =
          state.files.get(`${destination}/ios/App/App/Info.plist`) ?? "";
        assert.include(
          plist,
          "<key>WKAppBoundDomains</key><array><string>app.test</string></array>"
        );
        assert.notInclude(plist, "NSAppTransportSecurity");
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "writes camera usage text with replacement patterns literally into Info.plist",
    () => {
      const usageDescription = "Price $& tax $' after $` before $$ total";
      const photoLibraryUsageDescription = "Pick $& or $$";
      const state = memory(false, {
        ...defaultConfig,
        internalPlugins: { camera: true },
        pluginOptions: {
          Camera: { usageDescription, photoLibraryUsageDescription },
        },
      });
      return Effect.gen(function* () {
        yield* generate;
        const plist =
          state.files.get(`${destination}/ios/App/App/Info.plist`) ?? "";
        assert.include(
          plist,
          `<key>NSCameraUsageDescription</key><string>${usageDescription.replaceAll("&", "&amp;")}</string><key>NSPhotoLibraryUsageDescription</key><string>${photoLibraryUsageDescription.replaceAll("&", "&amp;")}</string>\n</dict>\n</plist>`
        );
        assert.strictEqual(plist.match(/<\/plist>/gu)?.length, 1);
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "accepts ten app-bound hosts and rejects an eleventh before spawning",
    () =>
      Effect.gen(function* () {
        const allowlist = Array.from(
          { length: 9 },
          (_, index) => `https://host${index}.test`
        );
        const accepted = memory(
          false,
          { ...defaultConfig, allowlist },
          "https://app.test"
        );
        yield* generate.pipe(Effect.provide(accepted.layer));
        assert.strictEqual(accepted.commands.length, 1);
        const rejected = memory(
          false,
          {
            ...defaultConfig,
            allowlist: [...allowlist, "https://eleven.test"],
          },
          "https://app.test"
        );
        const error = yield* Effect.flip(
          generate.pipe(Effect.provide(rejected.layer))
        );
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.isEmpty(rejected.commands);
        assert.isFalse(rejected.files.has(appDelegate));
      })
  );

  it.effect("renders one cookie per host with the shared Secure policy", () => {
    const state = memory(
      false,
      {
        ...defaultConfig,
        allowlist: [
          "https://app.test",
          "https://secure.test",
          "https://secure.test:8443",
        ],
      },
      "http://app.test:3000"
    );
    return Effect.gen(function* () {
      yield* generate;
      const source = state.files.get(appDelegate) ?? "";
      assert.include(
        source,
        'for (hostname, origin, secure) in [("app.test", "http://app.test:3000", false), ("secure.test", "https://secure.test", true)]'
      );
      assert.include(source, 'if secure { properties[.secure] = "TRUE" }');
      assert.include(source, "decisionHandler(.allow)");
      assert.include(source, 'fatalError("Radical requires Capacitor WebView');
    }).pipe(Effect.provide(state.layer));
  });

  it.effect(
    "keeps the previous shell when Capacitor controller or ATS anchors change",
    () =>
      Effect.gen(function* () {
        for (const file of [
          "SceneDelegate.swift",
          "Base.lproj/Main.storyboard",
          "Info.plist",
        ]) {
          const state = memory(false, defaultConfig, "http://app.test", file);
          state.files.set(`${destination}/previous.txt`, "usable shell");
          const error = yield* Effect.flip(
            generate.pipe(Effect.provide(state.layer))
          );
          assert.strictEqual(error._tag, "NativeTemplateMismatch");
          if (error._tag === "NativeTemplateMismatch") {
            assert.isTrue(error.file.endsWith(file));
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
        }
      })
  );

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
        assert.isFalse(state.files.has(appDelegate));
      }).pipe(Effect.provide(state.layer));
    }
  );
});

describe("ios app identity", () => {
  it.effect(
    "reports invalid ios fallback and explicit ids with an actionable typed error",
    () =>
      Effect.gen(function* () {
        for (const config of [
          { appId: "dev.my_app" },
          { ...defaultConfig, ios: { bundleId: "dev.my_app" } },
        ]) {
          const state = memory(false, config);
          const error = yield* Effect.flip(
            generate.pipe(Effect.provide(state.layer))
          );
          assert.strictEqual(error._tag, "InvalidConfig");
          assert.include(error.message, "ios");
          assert.include(error.message, "dev.my_app");
          assert.include(error.message, "ios.bundleId");
          assert.include(error.message, "letters, digits and hyphens");
          assert.isEmpty(state.commands);
        }
        const state = memory(false, {
          appId: "dev.my_app",
          ios: { bundleId: "dev.valid.app" },
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
        ios: { name: "Platform name", bundleId: "dev.custom.shell" },
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
        assert.include(
          state.files.get(`${destination}/package.json`) ?? "",
          '"@capacitor/assets":"3.0.5"'
        );
        assert.strictEqual(state.assetCalls[0].platform, "ios");
        const storyboard =
          state.files.get(
            `${destination}/ios/App/App/Base.lproj/LaunchScreen.storyboard`
          ) ?? "";
        assert.include(
          storyboard,
          `red="${0x24 / 255}" green="${0x10 / 255}" blue="${0x44 / 255}"`
        );
        assert.include(
          storyboard,
          'secondItem="launch-view" secondAttribute="top"'
        );
        const source = state.files.get(appDelegate) ?? "";
        assert.match(source, /let splashName = "RadicalSplash[a-f0-9]+"/u);
        assert.include(source, "view.addSubview(splash)");
        assert.include(source, "proxy.onDocumentReady = { [weak self] in");
        assert.include(source, "self?.startupSplash?.removeFromSuperview()");
        assert.include(source, "onDocumentReady?()");
        assert.strictEqual(state.assetCalls[0].backgroundColor, "#241044");
        const first = state.assetCalls[0].assets;
        state.binaries.set("/app/icon.png", yield* image(1024, "#ff0000"));
        state.binaries.set("/app/splash.png", yield* image(2732, "#00ff00"));
        state.files.set(
          "/app/.radical/native.json",
          JSON.stringify({
            config: {
              ...config,
              ios: { ...config.ios, name: "Renamed shell" },
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

describe("bundled ios shell", () => {
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
        const source = state.files.get(appDelegate) ?? "";
        assert.include(source, "capacitor://localhost");
        assert.notInclude(source, '"https://external.example"');
        assert.include(source, "RadicalTransitionsPlugin");
        assert.include(source, "window.__radicalNativeContext=");
        assert.include(
          state.files.get(`${destination}/package.json`) ?? "",
          "@capacitor/device"
        );
        assert.notInclude(
          state.files.get(`${destination}/ios/App/App/Info.plist`) ?? "",
          "WKAppBoundDomains"
        );
        assert.include(
          state.files.get(`${destination}/capacitor.config.json`) ?? "",
          '"limitsNavigationsToAppBoundDomains":false'
        );
        assert.include(source, "if !true {");
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
