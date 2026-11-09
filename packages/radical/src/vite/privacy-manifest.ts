import { escapeXml } from "./native-contributions.ts";
import type { NativeContributions } from "./native-contributions.ts";

export const privacyManifestFiles = (
  ordered: readonly NativeContributions[]
): NonNullable<NativeContributions["files"]> => {
  const privacy = new Map<string, Set<string>>();

  for (const contribution of ordered) {
    for (const [api, reasons] of Object.entries(
      contribution.privacyAccessedApis ?? {}
    )) {
      const values = privacy.get(api) ?? new Set<string>();

      for (const reason of reasons) {
        values.add(reason);
      }

      privacy.set(api, values);
    }
  }

  if (ordered.some((value) => value.privacyAccessedApis !== undefined)) {
    return [
      {
        platform: "ios",
        file: "ios/App/App/PrivacyInfo.xcprivacy",
        contents: `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>NSPrivacyAccessedAPITypes</key><array>${[
          ...privacy,
        ]
          .map(
            ([api, reasons]) =>
              `<dict><key>NSPrivacyAccessedAPIType</key><string>${escapeXml(api)}</string><key>NSPrivacyAccessedAPITypeReasons</key><array>${[
                ...reasons,
              ]
                .toSorted()
                .map((reason) => `<string>${escapeXml(reason)}</string>`)
                .join("")}</array></dict>`
          )
          .join("")}</array></dict></plist>`,
      },
    ];
  }

  return [];
};

/** Register the composed manifest as an app resource, rather than an unbundled project file. */
export const privacyManifestEdits = (
  ordered: readonly NativeContributions[]
): NonNullable<NativeContributions["edits"]> =>
  privacyManifestFiles(ordered).length === 0
    ? []
    : [
        {
          platform: "ios",
          file: "ios/App/App.xcodeproj/project.pbxproj",
          anchor: "/* Begin PBXBuildFile section */",
          replacement:
            "/* Begin PBXBuildFile section */\nA18000000000000000000001 = {isa = PBXBuildFile; fileRef = A18000000000000000000002; };",
        },
        {
          platform: "ios",
          file: "ios/App/App.xcodeproj/project.pbxproj",
          anchor: "/* Begin PBXFileReference section */",
          replacement:
            "/* Begin PBXFileReference section */\nA18000000000000000000002 = {isa = PBXFileReference; lastKnownFileType = text.xml; path = App/PrivacyInfo.xcprivacy; sourceTree = SOURCE_ROOT; };",
        },
        {
          platform: "ios",
          file: "ios/App/App.xcodeproj/project.pbxproj",
          anchor:
            "504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,",
          replacement:
            "504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,\nA18000000000000000000001,",
        },
      ];
