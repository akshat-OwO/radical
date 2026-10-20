import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, FileSystem } from "effect";

import { NATIVE_CONTEXT_COOKIE } from "./native-context.ts";
import {
  capacitor,
  generateNativeProject,
  readNativeProject,
  renderTemplate,
} from "./native-project.ts";
import { execute } from "./shell.ts";

export const generateIos = (
  root: string,
  packageRoot = fileURLToPath(new URL("../", import.meta.url))
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const native = yield* readNativeProject(root, packageRoot, "ios");
    const template = yield* fs.readFileString(
      path.join(packageRoot, "templates/ios/RadicalViewController.swift")
    );
    const source = renderTemplate(template, {
      __ORIGINS__: native.origins
        .map((value) => JSON.stringify(value))
        .join(", "),
      __COOKIE_NAME__: JSON.stringify(NATIVE_CONTEXT_COOKIE),
      __COOKIE_VALUE__: JSON.stringify(native.cookie),
    });
    return yield* generateNativeProject(root, "ios", native, (staging) =>
      Effect.gen(function* () {
        const app = path.join(staging, "ios/App/App");
        const delegate = path.join(app, "AppDelegate.swift");
        yield* fs.writeFileString(
          delegate,
          `${yield* fs.readFileString(delegate)}\n${source}`
        );
        // Capacitor 8's scene lifecycle constructs its controller directly.
        const scene = path.join(app, "SceneDelegate.swift");
        yield* fs.writeFileString(
          scene,
          (yield* fs.readFileString(scene)).replace(
            "CAPBridgeViewController()",
            "RadicalViewController()"
          )
        );
        const storyboard = path.join(app, "Base.lproj/Main.storyboard");
        yield* fs.writeFileString(
          storyboard,
          (yield* fs.readFileString(storyboard)).replace(
            'customClass="CAPBridgeViewController" customModule="Capacitor"',
            'customClass="RadicalViewController" customModule="App" customModuleProvider="target"'
          )
        );
        const plist = path.join(app, "Info.plist");
        const contents = (yield* fs.readFileString(plist)).replace(
          /\s*<key>NSAppTransportSecurity<\/key>\s*<dict>[\s\S]*?<\/dict>/u,
          ""
        );
        // Web-content-only ATS exception permits HTTP LAN IPs. Keep native URLSession secure.
        yield* fs.writeFileString(
          plist,
          native.origins.some((origin) => origin.startsWith("http:"))
            ? contents.replace(
                /<\/dict>\s*<\/plist>/u,
                "<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>\n</dict>\n</plist>"
              )
            : contents
        );
      })
    );
  });
export const runIos = (project: string, target: string) =>
  Effect.gen(function* () {
    const { cli } = yield* capacitor("ios");
    yield* execute(
      process.execPath,
      [cli, "run", "ios", ...(target ? ["--target", target] : [])],
      project
    );
  });
