import { Effect, Schema } from "effect";

import { NotificationRouteSchema } from "../../capabilities/notifications/notification-schema.ts";
import type { RadicalNavigation } from "../adapter/adapter.ts";
import { Unavailable } from "../errors.ts";
import { DeepLinkPathFilter } from "./deep-links.ts";

/** Shared internal entry for notification taps and warm links. */
export const openRoute = (
  route: string,
  options: {
    readonly appId: string;
    readonly allows?: (path: string) => boolean;
    readonly restore: (
      route: string,
      appId: string
    ) => Effect.Effect<boolean, Unavailable>;
    readonly navigation: RadicalNavigation;
  }
) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(NotificationRouteSchema)(route);

    const allows =
      options.allows ??
      ((path: string) => new DeepLinkPathFilter([]).allows(path));

    if (!allows(route)) {
      return yield* new Unavailable({ reason: "Excluded deep-link path" });
    }

    const restored = yield* options
      .restore(route, options.appId)
      .pipe(Effect.orElseSucceed(() => false));

    if (!restored) {
      yield* options.navigation.navigate(route);
    }

    return yield* Effect.void;
  });
