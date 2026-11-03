import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";

import { BrowserNetwork } from "../../../src/capabilities/network/browser-network.ts";
import {
  NotificationSnapshots,
  notificationSnapshotsLayer,
} from "../../../src/capabilities/notifications/notification-navigation.ts";
import { bridgeTestLayer, Bridge } from "../../../src/core/bridge/bridge.ts";
import { DeepLinkPathFilter } from "../../../src/core/deep-links/deep-links.ts";
import { openRoute } from "../../../src/core/deep-links/open-route.ts";
import { watchWarmLinks } from "../../../src/core/deep-links/warm-links.ts";

for (const scenario of [
  {
    name: "external rejected",
    route: "https://other.test/x",
    allowed: false,
    restored: false,
  },
  {
    name: "excluded rejected",
    route: "/excluded?x=1",
    allowed: false,
    restored: false,
  },
  {
    name: "offline snapshot restored",
    route: "/page?x=1#hash",
    allowed: true,
    restored: true,
  },
  {
    name: "offline missing snapshot navigates",
    route: "/page?x=2#hash",
    allowed: true,
    restored: false,
  },
  {
    name: "online navigates",
    route: "/page?x=3#hash",
    allowed: true,
    restored: false,
  },
]) {
  it.effect(scenario.name, () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const navigation = {
        navigate: (route: string) =>
          Effect.sync(() => {
            calls.push(`navigate:${route}`);
          }),
        onBeforeNavigate: () => Effect.succeed(() => {}),
        onAfterNavigate: () => Effect.succeed(() => {}),
      };

      const connected = scenario.name === "online navigates";

      const snapshots = notificationSnapshotsLayer({
        restore: (route, appId) =>
          Effect.sync(() => {
            assert.strictEqual(appId, "test.app");
            calls.push(`snapshot:${route}`);

            return scenario.restored;
          }),
      }).pipe(
        Layer.provide(
          Layer.merge(
            bridgeTestLayer("browser", () =>
              Effect.die("Unexpected native call")
            ),
            Layer.succeed(BrowserNetwork, {
              current: Effect.succeed({
                connected,
                connectionType: connected
                  ? ("wifi" as const)
                  : ("none" as const),
              }),
              listen: () => Effect.die("Unexpected subscription"),
            })
          )
        )
      );

      const result = yield* Effect.gen(function* () {
        const storage = yield* NotificationSnapshots;

        return yield* openRoute(scenario.route, {
          appId: "test.app",
          allows: (route) =>
            new DeepLinkPathFilter(["/excluded"]).allows(route),
          restore: storage.restore,
          navigation,
        });
      }).pipe(Effect.provide(snapshots), Effect.result);

      assert.strictEqual(result._tag, scenario.allowed ? "Success" : "Failure");
      assert.deepStrictEqual(
        calls,
        scenario.allowed
          ? [
              ...(connected ? [] : [`snapshot:${scenario.route}`]),
              ...(scenario.restored ? [] : [`navigate:${scenario.route}`]),
            ]
          : []
      );
    })
  );
}

it.effect(
  "registers the listener before readiness and consumes only the latest pending link",
  () =>
    Effect.gen(function* () {
      const delivered = yield* Deferred.make<boolean>();
      const routes: string[] = [];
      let pending = "https://app.test/first";
      pending = "https://app.test/second?x=1#hash";
      let listener: Parameters<Bridge["Service"]["observe"]>[1] | undefined;
      let removed = false;

      const navigation = {
        navigate: (route: string) =>
          Effect.gen(function* () {
            routes.push(route);
            yield* Deferred.succeed(delivered, true);
          }),
        onBeforeNavigate: () => Effect.succeed(() => {}),
        onAfterNavigate: () => Effect.succeed(() => {}),
      };

      const layer = Layer.merge(
        Layer.succeed(Bridge, {
          runtime: Effect.succeed("android" as const),
          observe: (event, receive) =>
            Effect.sync(() => {
              assert.strictEqual(event, "radicalDeepLink");
              listener = receive;

              return () => {
                removed = true;
              };
            }),
          call: (plugin, method) =>
            Effect.sync(() => {
              assert.strictEqual(plugin, "RadicalSplash");
              assert.strictEqual(method, "linksReady");
              assert.isDefined(listener);
              listener?.(pending);
            }),
        }),
        Layer.succeed(NotificationSnapshots, {
          restore: () => Effect.succeed(false),
        })
      );

      const fiber = yield* Effect.scoped(
        watchWarmLinks(navigation, {
          appId: "test.app",
          origin: "https://app.test",
          excludes: [],
        })
      ).pipe(Effect.provide(layer), Effect.forkChild);

      yield* Deferred.await(delivered);
      yield* Fiber.interrupt(fiber);
      assert.deepStrictEqual(routes, ["/second?x=1#hash"]);
      assert.isTrue(removed);
    })
);
