import type { NativeContributions } from "../../vite/native-contributions.ts";
import { escapeXml } from "../../vite/native-contributions.ts";
import type { LocationConfigSchema } from "./location-schema.ts";

export const locationContributions = (
  options: typeof LocationConfigSchema.Type
): NativeContributions => ({
  defines: { __RADICAL_LOCATION__: JSON.stringify(options) },
  android: [
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  ],
  plist: [
    { key: "NSLocationDefaultAccuracyReduced", value: "<true/>" },
    ...[
      "NSLocationWhenInUseUsageDescription",
      "NSLocationAlwaysAndWhenInUseUsageDescription",
    ].map((key) => ({
      key,
      value: `<string>${escapeXml(options.usageDescription)}</string>`,
    })),
    {
      key: "NSLocationTemporaryUsageDescriptionDictionary",
      value: `<dict>${Object.entries(options.precisePurposes ?? {})
        .map(
          ([key, value]) =>
            `<key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`
        )
        .join("")}</dict>`,
    },
  ],
});
