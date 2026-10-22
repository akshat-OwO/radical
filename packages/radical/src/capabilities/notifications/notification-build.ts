import type { RadicalConfig } from "../../vite/config.ts";
import type {
  NativeContributions,
  NativeEdit,
} from "../../vite/native-contributions.ts";

/** Firebase files stay app-owned; only the generated shell receives copies. */
export const pushNotificationContributions = (
  config: RadicalConfig
): NativeContributions => {
  const app = "ios/App/App";
  const project = "ios/App/App.xcodeproj/project.pbxproj";
  const appDelegateHook = `    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }`;
  const edits: NativeEdit[] = [];
  const copies: NonNullable<NativeContributions["copies"]>[number][] = [];
  const android = config.notifications?.android?.googleServices;
  if (android !== undefined) {
    copies.push({
      platform: "android",
      source: android,
      file: "android/app/google-services.json",
    });
  }
  const ios = config.notifications?.ios?.googleServiceInfo;
  if (ios !== undefined) {
    copies.push({
      platform: "ios",
      source: ios,
      file: `${app}/GoogleService-Info.plist`,
    });
    for (const [anchor, replacement] of [
      [
        "/* Begin PBXBuildFile section */",
        `/* Begin PBXBuildFile section */\n\t\tAA0000000000000000000022 /* GoogleService-Info.plist in Resources */ = {isa = PBXBuildFile; fileRef = AA0000000000000000000023 /* GoogleService-Info.plist */; };`,
      ],
      [
        "/* Begin PBXFileReference section */",
        `/* Begin PBXFileReference section */\n\t\tAA0000000000000000000023 /* GoogleService-Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; };`,
      ],
      [
        "/* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (",
        "/* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\tAA0000000000000000000023 /* GoogleService-Info.plist */,",
      ],
      [
        /isa = PBXResourcesBuildPhase;\s*buildActionMask = 2147483647;\s*files = \(/u,
        "isa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\tAA0000000000000000000022 /* GoogleService-Info.plist in Resources */,",
      ],
    ] as const) {
      edits.push({ platform: "ios", file: project, anchor, replacement });
    }
  }
  return {
    spm: { "@capacitor-firebase/messaging": { symlink: true } },
    edits,
    copies,
    plist: [
      {
        key: "UIBackgroundModes",
        value: "<array><string>remote-notification</string></array>",
        stage: "postprocess",
      },
    ],
    entitlements: {
      "aps-environment": `<string>${config.notifications?.ios?.environment ?? "development"}</string>`,
    },
    appDelegateHooks: [appDelegateHook],
  };
};

/** Exact alarms remain opt-in and require separate Android user consent. */
export const localNotificationContributions = (
  config: RadicalConfig
): NativeContributions => ({
  android:
    config.notifications?.android?.exactAlarms === true
      ? [
          '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
        ]
      : [],
});
