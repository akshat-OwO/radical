import { Effect, flow } from "effect";
import type { Schema } from "effect";

import { cameraContributions } from "../capabilities/camera/camera-build.ts";
import {
  googleSignInContributions,
  googleSignInDefaults,
} from "../capabilities/google-sign-in/google-sign-in-build.ts";
import { locationContributions } from "../capabilities/location/location-build.ts";
import { pushNotificationContributions } from "../capabilities/notifications/notification-build.ts";
import { videoStreamContributions } from "../capabilities/video-stream/video-stream-build.ts";
import { resolveDeepLinks } from "../core/deep-links/deep-links.ts";
import { resolveInternalCapabilities } from "../core/plugins/internal-plugin-registry.ts";
import {
  locationPlugin,
  cameraPlugin,
  googleSignInPlugin,
  videoStreamPlugin,
} from "../core/plugins/internal-plugins.ts";
import { InvalidConfig, validateConfig } from "./config.ts";
import { escapeXml } from "./native-contributions.ts";
import type {
  NativeContributions,
  NativeEdit,
  PlistContribution,
} from "./native-contributions.ts";
import { resolvePlugins } from "./plugins/plugin-plan.ts";
import type { EnabledPlugin } from "./plugins/plugin-plan.ts";

/** Recover the concrete schema type after the single heterogeneous decoding pass. */
const optionsFor = <S extends Schema.Top>(
  plugins: readonly EnabledPlugin[],
  manifest: { readonly id: string; readonly config: { readonly schema: S } }
): S["Type"] | undefined =>
  plugins.find(
    (entry) =>
      entry.module === "@akshatowo/radical/internal-plugins" &&
      entry.manifest.id === manifest.id
  )?.options;

const trackingContributions = (
  capabilities: readonly string[]
): NativeContributions =>
  capabilities.includes("trackingSession")
    ? {
        android: [
          '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
          '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />',
        ],
        androidApplication: [
          '<service android:name=".RadicalTrackingService" android:exported="false" android:foregroundServiceType="location" />',
        ],
      }
    : {};

export const composePlist = (entries: readonly PlistContribution[]) =>
  Effect.gen(function* () {
    const keys = new Map<string, PlistContribution[]>();

    for (const entry of entries) {
      keys.set(entry.key, [...(keys.get(entry.key) ?? []), entry]);
    }

    const resolved: Record<string, string> = {};

    for (const [key, values] of keys) {
      if (values.every((value) => value.composition === "unique-purpose")) {
        const purposes = values
          .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((value) => value.value);

        resolved[key] =
          `<string>${escapeXml([...new Set(purposes)].join(" "))}</string>`;
      } else {
        if (
          values.some(
            (value) =>
              value.composition !== values[0]?.composition ||
              value.value !== values[0]?.value
          )
        ) {
          return yield* new InvalidConfig({
            message: `Conflicting iOS plist contributions for ${key}`,
          });
        }

        resolved[key] = values[0]?.value ?? "";
      }
    }

    return resolved;
  });

export const renderPlist = (entries: Readonly<Record<string, string>>) =>
  Object.entries(entries)
    .map(([key, value]) => `<key>${key}</key>${value}`)
    .join("");

/** Equal values deduplicate; different values require a capability-specific rule. */
export const composeSettings = <A>(
  kind: string,
  entries: readonly Readonly<Record<string, A>>[]
) =>
  Effect.gen(function* () {
    const resolved: Record<string, A> = {};

    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry)) {
        if (
          Object.hasOwn(resolved, key) &&
          JSON.stringify(resolved[key]) !== JSON.stringify(value)
        ) {
          return yield* new InvalidConfig({
            message: `Conflicting ${kind} contributions for ${key}`,
          });
        }

        resolved[key] = value;
      }
    }

    return resolved;
  });

/** Resolve enablement and decode each enabled plugin's options before project mutation. */
export const resolveBuildPlan = flow(
  validateConfig,
  Effect.flatMap((config) =>
    Effect.gen(function* () {
      const plugins = yield* resolvePlugins(config);
      const capabilities = resolveInternalCapabilities(config.internalPlugins);
      const location = optionsFor(plugins, locationPlugin);
      const camera = optionsFor(plugins, cameraPlugin);
      const videoStream = optionsFor(plugins, videoStreamPlugin);
      const googleSignIn = optionsFor(plugins, googleSignInPlugin);

      // Build-only handlers stay outside the browser-safe registry and manifest graph.
      const contributions: Partial<
        Record<(typeof capabilities)[number], NativeContributions>
      > = {};

      if (googleSignIn !== undefined) {
        contributions.googleSignIn = googleSignInContributions(googleSignIn);
      }

      if (location !== undefined) {
        contributions.location = locationContributions(location);
      }

      if (camera !== undefined) {
        contributions.camera = cameraContributions(camera);
      }

      if (videoStream !== undefined) {
        contributions.videoStream = videoStreamContributions(videoStream);
      }

      if (capabilities.includes("pushNotifications")) {
        contributions.pushNotifications = pushNotificationContributions(config);
      }

      {
        contributions.trackingSession = trackingContributions(capabilities);
      }

      // Preserve declaration order independently of enablement order.
      const ordered = [
        contributions.trackingSession,
        contributions.location,
        contributions.camera,
        contributions.videoStream,
        contributions.googleSignIn,
        contributions.pushNotifications,
      ].filter((value): value is NativeContributions => value !== undefined);

      const scheme = config.deepLinks?.scheme;

      if (
        scheme !== undefined &&
        googleSignIn &&
        scheme.toLowerCase() ===
          googleSignIn.iosClientId
            .split(".")
            .toReversed()
            .join(".")
            .toLowerCase()
      ) {
        return yield* new InvalidConfig({
          message:
            "deepLinks.scheme collides with Google sign-in's registered scheme",
        });
      }

      const plistEntries = ordered.flatMap((value) => value.plist ?? []);

      if (scheme !== undefined) {
        const existing = plistEntries.findIndex(
          (entry) => entry.key === "CFBundleURLTypes"
        );

        const entry = `<dict><key>CFBundleURLSchemes</key><array><string>${escapeXml(scheme)}</string></array></dict>`;

        const previous = plistEntries[existing];

        if (previous === undefined) {
          plistEntries.push({
            key: "CFBundleURLTypes",
            value: `<array>${entry}</array>`,
          });
        } else {
          plistEntries[existing] = {
            ...previous,
            value: previous.value.replace(/<\/array>$/u, `${entry}</array>`),
          };
        }
      }

      const plist = yield* composePlist(plistEntries);

      const declarations = yield* composePlist(
        plistEntries.filter((entry) => entry.stage === undefined)
      );

      const postprocess = yield* composePlist(
        plistEntries.filter((entry) => entry.stage === "postprocess")
      );

      const deepLinks = resolveDeepLinks(config);

      const entitlements = yield* composeSettings("iOS entitlement", [
        ...ordered.map((value) => value.entitlements ?? {}),
        ...(deepLinks.ios
          ? [
              {
                "com.apple.developer.associated-domains": `<array><string>applinks:${new URL(config.origin ?? "https://radical.invalid").hostname}${config.notifications?.ios?.environment === "production" ? "" : "?mode=developer"}</string></array>`,
              },
            ]
          : []),
      ]);

      const appDelegateHooks = [
        ...new Set(ordered.flatMap((value) => value.appDelegateHooks ?? [])),
      ];

      const defines = {
        __RADICAL_LOCATION__: "null",
        ...googleSignInDefaults,
        ...(yield* composeSettings(
          "Vite define",
          ordered.map((value) => value.defines ?? {})
        )),
      };

      const spm = yield* composeSettings(
        "SPM setting",
        ordered.map((value) => value.spm ?? {})
      );

      const edits: NativeEdit[] = ordered.flatMap((value) => value.edits ?? []);
      const files = ordered.flatMap((value) => value.files ?? []);

      if (appDelegateHooks.length > 0) {
        edits.push({
          platform: "ios",
          file: "ios/App/App/AppDelegate.swift",
          anchor: "    var window: UIWindow?",
          replacement: `    var window: UIWindow?\n\n${appDelegateHooks.join("\n\n")}`,
        });
      }

      if (Object.keys(entitlements).length > 0) {
        files.push({
          platform: "ios",
          file: "ios/App/App/App.entitlements",
          contents: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${renderPlist(entitlements)}</dict></plist>`,
        });
        edits.push({
          platform: "ios",
          file: "ios/App/App.xcodeproj/project.pbxproj",
          anchor: /CODE_SIGN_STYLE = Automatic;/gu,
          replacement:
            "CODE_SIGN_STYLE = Automatic;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;",
        });
      }

      if (Object.keys(postprocess).length > 0) {
        edits.push({
          platform: "ios",
          file: "ios/App/App/Info.plist",
          anchor: /<\/dict>\s*<\/plist>/u,
          replacement: `${renderPlist(postprocess)}\n</dict></plist>`,
        });
      }

      return {
        config,
        navigation: config.navigation,
        deepLinks,
        capabilities,
        plugins,
        options: { location, camera, videoStream, googleSignIn },
        pluginConfig: Object.fromEntries(
          plugins.flatMap((entry) =>
            entry.manifest.config
              ? [[entry.manifest.bridge, entry.encodedOptions]]
              : []
          )
        ),
        contributions,
        android: {
          application: ordered.flatMap(
            (value) => value.androidApplication ?? []
          ),
          declarations: [
            ...new Set(ordered.flatMap((value) => value.android ?? [])),
          ],
        },
        ios: { plist, declarations, entitlements, appDelegateHooks },
        defines,
        spm,
        edits,
        files,
        copies: ordered.flatMap((value) => value.copies ?? []),
      };
    })
  )
);

export type BuildPlan = Effect.Success<ReturnType<typeof resolveBuildPlan>>;
