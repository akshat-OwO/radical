import { Effect } from "effect";

import { getNativeContext as getContext } from "../entry/server.ts";

export { safeAreaStyle, withBundledRequests } from "../entry/server.ts";

export type { SafeArea } from "../entry/server.ts";

export const getNativeContext = (request: Request) =>
  Effect.runSync(getContext(request));

export { windowLayoutStyle } from "../capabilities/window-layout/window-layout-style.ts";

export type { WindowLayout } from "../core/context/native-context.ts";

export {
  appStoreUrl,
  resolveAppUpdate,
  AppUpdatePolicySchema,
} from "../core/update/app-update.ts";

export type {
  AppUpdatePolicy,
  AppUpdateState,
} from "../core/update/app-update.ts";

export type { AppUpdateOptions } from "../core/update/update-server.ts";
