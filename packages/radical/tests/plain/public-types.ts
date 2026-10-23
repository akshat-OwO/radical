import type { getDeviceInfo, registerOffline } from "../../src/plain/client.ts";
import type { encodeNativeContextCookie } from "../../src/plain/native-context.ts";
import type {
  RadicalProvider,
  useRadicalRuntime,
} from "../../src/plain/react.ts";
import type { RadicalRuntime } from "../../src/plain/runtime.ts";
import type { getNativeContext } from "../../src/plain/server.ts";
import type { browserTransitions } from "../../src/plain/tanstack-start-client.ts";

type Assert<T extends true> = T;

export type ProviderHasNoLayer = Assert<
  "layer" extends keyof Parameters<typeof RadicalProvider>[0] ? false : true
>;

export type RuntimeHandle = Assert<
  ReturnType<typeof useRadicalRuntime> extends RadicalRuntime ? true : false
>;

export type DevicePromise = Assert<
  ReturnType<typeof getDeviceInfo> extends Promise<object> ? true : false
>;

export type RegistrationPromise = Assert<
  ReturnType<typeof registerOffline> extends Promise<void> ? true : false
>;

export type ContextPromise = Assert<
  ReturnType<typeof getNativeContext> extends Promise<object> ? true : false
>;

export type CookiePromise = Assert<
  ReturnType<typeof encodeNativeContextCookie> extends Promise<string>
    ? true
    : false
>;

export type TransitionHasNoLayer = Assert<
  Parameters<typeof browserTransitions>["length"] extends 1 | 2 ? true : false
>;
