import { Effect } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { devicePlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import type { DeviceInfo } from "./device-info-schema.ts";

export { DeviceInfoSchema, type DeviceInfo } from "./device-info-schema.ts";

export interface BrowserDeviceSource {
  readonly userAgent: string;
  readonly userAgentData?: {
    readonly platform: string;
    readonly mobile: boolean;
  };
}

const hintSystems = new Map<string, DeviceInfo["operatingSystem"]>(
  Object.entries({
    android: "android",
    ios: "ios",
    macos: "mac",
    windows: "windows",
    linux: "linux",
    "chrome os": "linux",
  } as const)
);

/** Unknown values stay explicit. UA data does not reliably identify a model or emulator. */
export const browserDeviceInfo = (source: BrowserDeviceSource): DeviceInfo => {
  const ua = source.userAgent;
  const android = /Android\s(?<version>[\d.]+)/u.exec(ua);
  const ios = /(?:iPhone|iPad|iPod).*OS\s(?<version>[\d_]+)/u.exec(ua);
  const mac = /Mac OS X\s(?<version>[\d_]+)/u.exec(ua);
  const windows = /Windows NT\s(?<version>[\d.]+)/u.exec(ua);
  const parsed = android ?? ios ?? mac ?? windows;

  const candidates = [
    [android, "android"],
    [ios, "ios"],
    [mac, "mac"],
    [windows, "windows"],
  ] as const;

  const hint = source.userAgentData?.platform.toLowerCase();

  const operatingSystem =
    (hint === undefined ? undefined : hintSystems.get(hint)) ??
    candidates.find(([match]) => match !== null)?.[1] ??
    (/Linux/u.test(ua) ? "linux" : "unknown");

  return {
    platform: "web",
    model: "unknown",
    operatingSystem,
    // Reduced UA strings can report frozen versions. Client hints expose no OS version.
    osVersion: source.userAgentData
      ? "unknown"
      : (parsed?.groups?.version.replaceAll("_", ".") ?? "unknown"),
    manufacturer: "unknown",
    isVirtual: false,
  };
};

/** Execute after mounting. Server rendering must only read the hook's initial state. */
export const getDeviceInfo = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const runtime = yield* bridge.runtime;

  if (runtime !== "browser") {
    return yield* callPlugin(
      devicePlugin.bridge,
      "getInfo",
      devicePlugin.commands.getInfo,
      {}
    );
  }

  return yield* Effect.sync(() =>
    browserDeviceInfo(
      typeof navigator === "undefined" ? { userAgent: "" } : navigator
    )
  );
});
