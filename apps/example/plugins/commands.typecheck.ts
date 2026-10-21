// oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Negative type assertions intentionally call missing properties.
import type { Effect } from "effect";
import type {
  Bridge,
  BridgeCallFailed,
  BridgeDecodeError,
  BridgeUnavailable,
} from "radical/client";
import { plugins } from "virtual:radical/plugins";

import type { EchoRejected } from "./echo.ts";

/** Compile-time assertions for the generated virtual module. Never invoked. */
export const checkPluginTypes = () => {
  const result: Effect.Effect<
    { readonly text: string },
    EchoRejected | BridgeCallFailed | BridgeDecodeError | BridgeUnavailable,
    Bridge
  > = plugins.echo.echo({ text: "hello" });
  // @ts-expect-error Native commands require the manifest's argument type.
  plugins.echo.echo({ text: 1 });
  // @ts-expect-error Only declared commands exist.
  plugins.echo.missing({});
  // @ts-expect-error Only enabled plugins exist.
  plugins.disabled.echo({});
  return result;
};
