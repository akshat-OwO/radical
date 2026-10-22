import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { configureNativeNotifications } from "../src/notification-native.ts";

const app = "/shell/ios/App/App";
const project = "/shell/ios/App/App.xcodeproj/project.pbxproj";
const memory = () => {
  const files = new Map<string, string>([
    [
      `${app}/AppDelegate.swift`,
      "class AppDelegate {\n    var window: UIWindow?\n}",
    ],
    [`${app}/Info.plist`, "<plist><dict></dict></plist>"],
    [
      project,
      "/* Begin PBXBuildFile section */\n/* Begin PBXFileReference section */\n1 /* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = ();\n};\nisa = PBXResourcesBuildPhase;\n buildActionMask = 2147483647;\n files = ();\nCODE_SIGN_STYLE = Automatic;",
    ],
    ["/app/private/firebase.plist", "app-owned-plist"],
    ["/app/private/firebase.json", "app-owned-json"],
  ]);
  return {
    files,
    layer: FileSystem.layerNoop({
      readFileString: (name) =>
        Effect.sync(() => {
          assert.isTrue(files.has(name), name);
          return files.get(name) ?? "";
        }),
      writeFileString: (name, value) =>
        Effect.sync(() => {
          files.set(name, value);
        }),
      copyFile: (from, to) =>
        Effect.sync(() => {
          assert.isTrue(files.has(from), from);
          files.set(to, files.get(from) ?? "");
        }),
    }),
  };
};

it.effect(
  "copies Firebase files into the shell and wires iOS resources, APNs callbacks, and signing",
  () =>
    Effect.gen(function* () {
      const fs = memory();
      const config = {
        appId: "dev.test.app",
        internalPlugins: { pushNotifications: true },
        notifications: {
          android: { googleServices: "./private/firebase.json" },
          ios: {
            googleServiceInfo: "./private/firebase.plist",
            environment: "production" as const,
          },
        },
      };
      yield* configureNativeNotifications(
        "/app",
        "/shell",
        "android",
        config
      ).pipe(Effect.provide(fs.layer));
      yield* configureNativeNotifications("/app", "/shell", "ios", config).pipe(
        Effect.provide(fs.layer)
      );
      assert.strictEqual(
        fs.files.get("/shell/android/app/google-services.json"),
        "app-owned-json"
      );
      assert.strictEqual(
        fs.files.get(`${app}/GoogleService-Info.plist`),
        "app-owned-plist"
      );
      const pbx = fs.files.get(project) ?? "";
      assert.include(pbx, "GoogleService-Info.plist in Resources");
      assert.include(pbx, "CODE_SIGN_ENTITLEMENTS = App/App.entitlements");
      assert.include(
        fs.files.get(`${app}/App.entitlements`) ?? "",
        "<string>production</string>"
      );
      assert.include(
        fs.files.get(`${app}/Info.plist`) ?? "",
        "remote-notification"
      );
      const delegate = fs.files.get(`${app}/AppDelegate.swift`) ?? "";
      assert.include(delegate, "capacitorDidRegisterForRemoteNotifications");
      assert.include(
        delegate,
        "capacitorDidFailToRegisterForRemoteNotifications"
      );
      assert.include(
        delegate,
        'Notification.Name("didReceiveRemoteNotification")'
      );
    })
);

it.effect(
  "keeps local-only shells free of Firebase files and entitlements",
  () =>
    Effect.gen(function* () {
      const fs = memory();
      const before = [...fs.files.entries()];
      for (const platform of ["android", "ios"] as const) {
        yield* configureNativeNotifications("/app", "/shell", platform, {
          appId: "dev.test.app",
          internalPlugins: { notifications: true },
        }).pipe(Effect.provide(fs.layer));
      }
      assert.deepStrictEqual([...fs.files.entries()], before);
    })
);

it.effect(
  "generates push entitlements without inventing Firebase configuration",
  () =>
    Effect.gen(function* () {
      const fs = memory();
      yield* configureNativeNotifications("/app", "/shell", "ios", {
        appId: "dev.test.app",
        internalPlugins: { pushNotifications: true },
      }).pipe(Effect.provide(fs.layer));
      assert.isFalse(fs.files.has(`${app}/GoogleService-Info.plist`));
      assert.include(
        fs.files.get(`${app}/App.entitlements`) ?? "",
        "<string>development</string>"
      );
    })
);
