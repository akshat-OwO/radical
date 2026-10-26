import path from "node:path";

import { Effect, FileSystem } from "effect";

import { NATIVE_CONTEXT_COOKIE } from "../../core/context/native-context.ts";
import { offlineSnapshotCheckScript } from "../../core/offline/native-offline.ts";
import { savedOfflineURLKeys } from "../../core/offline/offline-protocol.ts";
import type { BuildPlan } from "../../vite/build-plan.ts";
import { renderPlist } from "../../vite/build-plan.ts";
import { InvalidConfig } from "../../vite/config.ts";
import { resolvePackageRoot } from "../../vite/package-paths.ts";
import { pluginRegistration } from "../../vite/plugins/plugin-plan.ts";
import { composePluginSources } from "../../vite/plugins/plugin-sources.ts";
import { iosSplashResourceName } from "../assets/native-assets.ts";
import { applyBuildPlan } from "../shared/apply-build-plan.ts";
import {
  generateNativeProject,
  readNativeProject,
  renderTemplate,
} from "../shared/native-project.ts";
import { replaceAnchor } from "../shared/native-template.ts";
import {
  safeAreaUpdateScript,
  windowLayoutUpdateScript,
} from "../shared/shell-events.ts";

export const generateIos = (
  root: string,
  packageRoot = resolvePackageRoot(import.meta.url),
  plan?: BuildPlan
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const native = yield* readNativeProject(root, packageRoot, "ios", plan);

    const domains = [
      ...new Set(native.origins.map((origin) => new URL(origin).hostname)),
    ];

    if (!native.bundled && domains.length > 10) {
      return yield* Effect.fail(
        new InvalidConfig({
          message:
            "iOS WKAppBoundDomains supports at most 10 domains, including the server hostname.",
        })
      );
    }

    const template = yield* fs.readFileString(
      path.join(packageRoot, "templates/ios/RadicalViewController.swift")
    );

    const navigation =
      native.plan.navigation?.bar?.ios === "web"
        ? undefined
        : native.plan.navigation;

    const rootController = navigation
      ? "RadicalTabController()"
      : "RadicalViewController()";

    const navigationSource = navigation
      ? yield* renderTemplate(
          "RadicalNavigation.swift",
          yield* fs.readFileString(
            path.join(packageRoot, "templates/ios/RadicalNavigation.swift")
          ),
          {
            __SECTIONS__: navigation.sections
              .map((section) => {
                const image = `UIImage(systemName: ${JSON.stringify(section.icon.ios)})`;

                const selected = JSON.stringify(
                  section.selectedIcon?.ios ?? section.icon.ios
                );

                return `({ let tab = UITab(title: ${JSON.stringify(section.title)}, image: ${image}, identifier: ${JSON.stringify(section.id)}) { _ in UIViewController() }; tab.preferredPlacement = .fixed; tab.userInfo = ["icon": ${JSON.stringify(section.icon.ios)}, "selectedIcon": ${selected}]; return tab })()`;
              })
              .join(",\n"),
          }
        )
      : "";

    const source = yield* renderTemplate(
      "RadicalViewController.swift",
      template,
      {
        __NAVIGATION_HOST__: navigation
          ? "@available(iOS 18.0, *) weak var navigationHost: RadicalTabController?"
          : "",
        __NAVIGATION_REGISTRATION__: navigation
          ? "bridge?.registerPluginInstance(RadicalNavigationPlugin())"
          : "",
        __OFFLINE_SAVED_URL_KEY__: JSON.stringify(savedOfflineURLKeys.ios),
        __BUNDLED__: String(native.bundled),
        __PLUGIN_REGISTRATION__: pluginRegistration(native.plugins, "ios"),
        __SPLASH_NAME__: JSON.stringify(iosSplashResourceName(native.assets)),
        __URL__: JSON.stringify(native.url),
        __SNAPSHOT_CHECK__: JSON.stringify(
          `(() => { const radicalOffline = window.webkit.messageHandlers.radicalOffline; return (${offlineSnapshotCheckScript(native.config.appId)})(location.href); })()`
        ),
        __OFFLINE_HTML__: JSON.stringify(
          yield* fs.readFileString(
            path.join(packageRoot, "templates/offline.html")
          )
        ),
        __ORIGINS__: native.origins
          .map((value) => JSON.stringify(value))
          .join(", "),
        __COOKIES__: native.cookies
          .map(
            ({ hostname, origin, secure }) =>
              `(${JSON.stringify(hostname)}, ${JSON.stringify(origin)}, ${secure})`
          )
          .join(", "),
        __COOKIE_NAME__: JSON.stringify(NATIVE_CONTEXT_COOKIE),
        __SAFE_AREA_SCRIPT__: JSON.stringify(safeAreaUpdateScript),
        __WINDOW_LAYOUT_SCRIPT__: JSON.stringify(windowLayoutUpdateScript),
        __COOKIE_VALUE__: JSON.stringify(native.cookie),
      }
    );

    return yield* generateNativeProject(root, "ios", native, (staging) =>
      Effect.gen(function* () {
        const app = path.join(staging, "ios/App/App");

        {
          const color = native.splash.backgroundColor;
          const storyboard = "LaunchScreen.storyboard";
          yield* fs.writeFileString(
            path.join(app, "Base.lproj", storyboard),
            yield* renderTemplate(
              storyboard,
              yield* fs.readFileString(
                path.join(packageRoot, "templates/ios", storyboard)
              ),
              {
                __SPLASH_NAME__: iosSplashResourceName(native.assets),
                __BACKGROUND_RED__: String(
                  Number.parseInt(color.slice(1, 3), 16) / 255
                ),
                __BACKGROUND_GREEN__: String(
                  Number.parseInt(color.slice(3, 5), 16) / 255
                ),
                __BACKGROUND_BLUE__: String(
                  Number.parseInt(color.slice(5, 7), 16) / 255
                ),
              }
            )
          );
        }

        const delegate = path.join(app, "AppDelegate.swift");
        yield* fs.writeFileString(
          delegate,
          `${yield* fs.readFileString(delegate)}\n${source}\n${navigationSource}`
        );
        // Capacitor 8's scene lifecycle constructs its controller directly.
        const scene = path.join(app, "SceneDelegate.swift");
        yield* fs.writeFileString(
          scene,
          yield* replaceAnchor(
            scene,
            yield* fs.readFileString(scene),
            "CAPBridgeViewController()",
            rootController
          )
        );
        const storyboard = path.join(app, "Base.lproj/Main.storyboard");
        yield* fs.writeFileString(
          storyboard,
          yield* replaceAnchor(
            storyboard,
            yield* fs.readFileString(storyboard),
            'customClass="CAPBridgeViewController" customModule="Capacitor"',
            `customClass="${navigation ? "RadicalTabController" : "RadicalViewController"}" customModule="App" customModuleProvider="target"`
          )
        );

        if (navigation) {
          for (const [file, anchor, replacement] of [
            [
              "ios/App/App.xcodeproj/project.pbxproj",
              /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/gu,
              "IPHONEOS_DEPLOYMENT_TARGET = 18.0;",
            ],
            ["ios/App/CapApp-SPM/Package.swift", ".iOS(.v15)", '.iOS("18.0")'],
          ] as const) {
            const target = path.join(staging, file);
            yield* fs.writeFileString(
              target,
              yield* replaceAnchor(
                target,
                yield* fs.readFileString(target),
                anchor,
                replacement
              )
            );
          }
        }

        const plist = path.join(app, "Info.plist");
        const contents = yield* fs.readFileString(plist);

        // Exact origin validation remains in the navigation delegate.
        const bound = native.bundled
          ? ""
          : `<key>WKAppBoundDomains</key><array>${domains.map((domain) => `<string>${domain.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`).join("")}</array>`;

        const ats = [
          native.config.origin ?? native.url,
          ...native.origins,
        ].some((origin) => origin.startsWith("http:"))
          ? "<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>"
          : "";

        const { appearance } = native.config;

        const style =
          appearance === "light" || appearance === "dark"
            ? `<key>UIUserInterfaceStyle</key><string>${appearance === "light" ? "Light" : "Dark"}</string>`
            : "";

        yield* fs.writeFileString(
          plist,
          yield* replaceAnchor(
            plist,
            contents,
            /<\/dict>\s*<\/plist>/u,
            `${bound}${ats}${style}${renderPlist(native.plan.ios.declarations)}\n</dict>\n</plist>`
          )
        );
        yield* applyBuildPlan(root, staging, "ios", native.plan);
        yield* composePluginSources(
          staging,
          "ios",
          native.config.appId,
          native.plugins,
          root,
          packageRoot
        );
      })
    );
  });
