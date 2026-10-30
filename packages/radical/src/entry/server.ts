export { getNativeContext } from "../core/context/request-context.ts";

export { safeAreaStyle } from "../core/context/native-context.ts";

export type { SafeArea } from "../core/context/native-context.ts";

export { withBundledRequests } from "../core/bundled/bundled-server.ts";

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
