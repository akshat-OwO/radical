import path from "node:path";

import { Effect, FileSystem } from "effect";

import type { RadicalConfig } from "../../build/config.ts";
import { replaceAnchor } from "../../native/shared/native-template.ts";

/** Copy app-owned Firebase files only into the ignored generated shell. */
export const configureNativeNotifications = (
  root: string,
  staging: string,
  platform: "android" | "ios",
  config: RadicalConfig
) =>
  Effect.gen(function* () {
    if (config.internalPlugins?.pushNotifications !== true) {
      return yield* Effect.void;
    }
    const fs = yield* FileSystem.FileSystem;
    if (platform === "android") {
      const source = config.notifications?.android?.googleServices;
      if (source !== undefined) {
        yield* fs.copyFile(
          path.resolve(root, source),
          path.join(staging, "android/app/google-services.json")
        );
      }
      return yield* Effect.void;
    }
    const app = path.join(staging, "ios/App/App");
    const delegate = path.join(app, "AppDelegate.swift");
    yield* fs.writeFileString(
      delegate,
      yield* replaceAnchor(
        delegate,
        yield* fs.readFileString(delegate),
        "    var window: UIWindow?",
        `    var window: UIWindow?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }`
      )
    );

    const source = config.notifications?.ios?.googleServiceInfo;
    if (source !== undefined) {
      yield* fs.copyFile(
        path.resolve(root, source),
        path.join(app, "GoogleService-Info.plist")
      );
      const project = path.join(
        staging,
        "ios/App/App.xcodeproj/project.pbxproj"
      );
      let contents = yield* fs.readFileString(project);
      contents = yield* replaceAnchor(
        project,
        contents,
        "/* Begin PBXBuildFile section */",
        `/* Begin PBXBuildFile section */\n\t\tAA0000000000000000000022 /* GoogleService-Info.plist in Resources */ = {isa = PBXBuildFile; fileRef = AA0000000000000000000023 /* GoogleService-Info.plist */; };`
      );
      contents = yield* replaceAnchor(
        project,
        contents,
        "/* Begin PBXFileReference section */",
        `/* Begin PBXFileReference section */\n\t\tAA0000000000000000000023 /* GoogleService-Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; };`
      );
      contents = yield* replaceAnchor(
        project,
        contents,
        "/* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (",
        "/* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\tAA0000000000000000000023 /* GoogleService-Info.plist */,"
      );
      contents = yield* replaceAnchor(
        project,
        contents,
        /isa = PBXResourcesBuildPhase;\s*buildActionMask = 2147483647;\s*files = \(/u,
        "isa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\tAA0000000000000000000022 /* GoogleService-Info.plist in Resources */,"
      );
      yield* fs.writeFileString(project, contents);
    }
    const entitlements = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>aps-environment</key><string>${config.notifications?.ios?.environment ?? "development"}</string></dict></plist>`;
    yield* fs.writeFileString(path.join(app, "App.entitlements"), entitlements);
    const project = path.join(staging, "ios/App/App.xcodeproj/project.pbxproj");
    yield* fs.writeFileString(
      project,
      (yield* fs.readFileString(project)).replaceAll(
        "CODE_SIGN_STYLE = Automatic;",
        "CODE_SIGN_STYLE = Automatic;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;"
      )
    );
    const plist = path.join(app, "Info.plist");
    yield* fs.writeFileString(
      plist,
      yield* replaceAnchor(
        plist,
        yield* fs.readFileString(plist),
        /<\/dict>\s*<\/plist>/u,
        "<key>UIBackgroundModes</key><array><string>remote-notification</string></array>\n</dict></plist>"
      )
    );
    return yield* Effect.void;
  });
