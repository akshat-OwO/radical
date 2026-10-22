import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";

import {
  PluginModules,
  resolvePlugins,
} from "../../../src/build/plugins/plugin-plan.ts";
import {
  BrowserNetwork,
  browserNetworkLayer,
  getNetworkStatus,
  watchNetworkStatus,
} from "../../../src/capabilities/network/network.ts";
import type { NetworkStatus } from "../../../src/capabilities/network/network.ts";
import { Bridge, bridgeTestLayer } from "../../../src/core/bridge/bridge.ts";

const PluginModulesLive = Layer.succeed(PluginModules, {
  load: () => Effect.die("Unexpected module load"),
});

const online: NetworkStatus = { connected: true, connectionType: "wifi" };
const offline: NetworkStatus = { connected: false, connectionType: "none" };
const unusedBrowser = Layer.succeed(BrowserNetwork, {
  current: Effect.die("Unexpected browser read"),
  listen: () => Effect.die("Unexpected browser subscription"),
});
const fixture = (
  runtime: "android" | "ios",
  current = Effect.succeed<unknown>(online)
) => {
  let receive: ((value: unknown) => void) | undefined;
  let removed = 0;
  const layer = Layer.merge(
    unusedBrowser,
    Layer.succeed(Bridge, {
      runtime: Effect.succeed(runtime),
      observe: () => Effect.succeed(() => {}),
      call: (plugin, method) => {
        assert.strictEqual(plugin, "Network");
        assert.strictEqual(method, "getStatus");
        return current;
      },
      listen: (plugin, event, listener) =>
        Effect.sync(() => {
          assert.strictEqual(plugin, "Network");
          assert.strictEqual(event, "networkStatusChange");
          receive = listener;
          return Effect.sync(() => {
            removed += 1;
          });
        }),
    })
  );
  return {
    layer,
    emit: (value: unknown) => {
      receive?.(value);
    },
    removed: () => removed,
  };
};

for (const runtime of ["android", "ios"] as const) {
  it.effect(
    `reports ${runtime} current status and changes, releasing on interruption`,
    () =>
      Effect.gen(function* () {
        const fake = fixture(runtime);
        assert.deepStrictEqual(
          yield* getNetworkStatus.pipe(Effect.provide(fake.layer)),
          online
        );
        const first = yield* Deferred.make<boolean>();
        const second = yield* Deferred.make<boolean>();
        const values: NetworkStatus[] = [];
        const fiber = yield* watchNetworkStatus.pipe(
          Stream.runForEach((value) =>
            Effect.gen(function* () {
              values.push(value);
              yield* Deferred.succeed(
                values.length === 1 ? first : second,
                true
              );
            })
          ),
          Effect.provide(fake.layer),
          Effect.forkChild
        );
        yield* Deferred.await(first);
        fake.emit(online);
        yield* TestClock.adjust("1 second");
        assert.deepStrictEqual(values, [online]);
        fake.emit(offline);
        yield* Deferred.await(second);
        yield* Fiber.interrupt(fiber);
        assert.deepStrictEqual(values, [online, offline]);
        assert.strictEqual(fake.removed(), 1);
      })
  );
}

it.effect("keeps an event newer than a delayed initial response", () =>
  Effect.gen(function* () {
    const requested = yield* Deferred.make<boolean>();
    const response = yield* Deferred.make<unknown>();
    const fake = fixture(
      "android",
      Deferred.succeed(requested, true).pipe(
        Effect.andThen(Deferred.await(response))
      )
    );
    const received = yield* Deferred.make<NetworkStatus>();
    const fiber = yield* watchNetworkStatus.pipe(
      Stream.runForEach((value) => Deferred.succeed(received, value)),
      Effect.provide(fake.layer),
      Effect.forkChild
    );
    yield* Deferred.await(requested);
    fake.emit(offline);
    yield* Deferred.succeed(response, online);
    assert.deepStrictEqual(yield* Deferred.await(received), offline);
    yield* Fiber.interrupt(fiber);
    assert.strictEqual(fake.removed(), 1);
  })
);

it.effect("fails malformed native events and releases the listener", () =>
  Effect.gen(function* () {
    const fake = fixture("ios");
    const started = yield* Deferred.make<boolean>();
    const fiber = yield* watchNetworkStatus.pipe(
      Stream.runForEach(() => Deferred.succeed(started, true)),
      Effect.flip,
      Effect.provide(fake.layer),
      Effect.forkChild
    );
    yield* Deferred.await(started);
    fake.emit({ connected: "invalid" });
    assert.strictEqual((yield* Fiber.join(fiber))._tag, "BridgeDecodeError");
    assert.strictEqual(fake.removed(), 1);
  })
);

it.effect(
  "reports missing native event support instead of falling back to browser",
  () =>
    Effect.gen(function* () {
      const layer = Layer.merge(
        unusedBrowser,
        bridgeTestLayer("android", () => Effect.succeed(online))
      );
      const error = yield* Stream.runCollect(watchNetworkStatus).pipe(
        Effect.provide(layer),
        Effect.flip
      );
      assert.strictEqual(error._tag, "BridgeUnavailable");
    })
);

it.effect(
  "reads browser status and handles online, offline, and connection changes with cleanup",
  () =>
    Effect.gen(function* () {
      const events = new EventTarget();
      const connection = Object.assign(new EventTarget(), { type: "wifi" });
      const navigator = { onLine: true, connection };
      const layer = Layer.merge(
        browserNetworkLayer(() => ({ events, navigator })),
        bridgeTestLayer("browser", () => Effect.die("Unexpected native call"))
      );
      const service = yield* Effect.service(BrowserNetwork).pipe(
        Effect.provide(layer)
      );
      assert.deepStrictEqual(
        yield* getNetworkStatus.pipe(Effect.provide(layer)),
        online
      );
      const values: NetworkStatus[] = [];
      const remove = yield* service.listen((value) => {
        values.push(value);
      });
      navigator.onLine = false;
      events.dispatchEvent(new Event("offline"));
      navigator.onLine = true;
      events.dispatchEvent(new Event("online"));
      connection.type = "cellular";
      connection.dispatchEvent(new Event("change"));
      remove();
      connection.type = "ethernet";
      connection.dispatchEvent(new Event("change"));
      events.dispatchEvent(new Event("offline"));
      assert.deepStrictEqual(values, [
        offline,
        online,
        { connected: true, connectionType: "cellular" },
      ]);
    })
);

it.effect("uses unknown for browsers without Network Information API", () =>
  Effect.gen(function* () {
    const layer = browserNetworkLayer(() => ({
      events: new EventTarget(),
      navigator: { onLine: true },
    }));
    const service = yield* Effect.service(BrowserNetwork).pipe(
      Effect.provide(layer)
    );
    assert.deepStrictEqual(yield* service.current, {
      connected: true,
      connectionType: "unknown",
    });
  })
);

it.effect(
  "subscribes through an injectable browser service and removes it on interruption",
  () =>
    Effect.gen(function* () {
      let emit: ((value: NetworkStatus) => void) | undefined;
      let removed = false;
      const first = yield* Deferred.make<boolean>();
      const changed = yield* Deferred.make<boolean>();
      const values: NetworkStatus[] = [];
      const layer = Layer.merge(
        bridgeTestLayer("browser", () => Effect.die("Unexpected native call")),
        Layer.succeed(BrowserNetwork, {
          current: Effect.succeed(online),
          listen: (receive) =>
            Effect.sync(() => {
              emit = receive;
              return () => {
                removed = true;
              };
            }),
        })
      );
      const fiber = yield* watchNetworkStatus.pipe(
        Stream.runForEach((value) =>
          Effect.gen(function* () {
            values.push(value);
            yield* Deferred.succeed(
              values.length === 1 ? first : changed,
              true
            );
          })
        ),
        Effect.provide(layer),
        Effect.forkChild
      );
      yield* Deferred.await(first);
      emit?.(offline);
      yield* Deferred.await(changed);
      yield* Fiber.interrupt(fiber);
      assert.deepStrictEqual(values, [online, offline]);
      assert.isTrue(removed);
    })
);

it.effect("enables the pinned native network plugin only when requested", () =>
  Effect.gen(function* () {
    const config = {
      appId: "dev.test.app",
      internalPlugins: { device: false, transitions: false },
    };
    assert.deepStrictEqual(
      yield* resolvePlugins(config).pipe(Effect.provide(PluginModulesLive)),
      []
    );
    const plugins = yield* resolvePlugins({
      ...config,
      internalPlugins: { ...config.internalPlugins, network: true },
    }).pipe(Effect.provide(PluginModulesLive));
    assert.strictEqual(plugins.length, 1);
    assert.deepStrictEqual(plugins[0]?.manifest.dependencies, {
      "@capacitor/network": "8.0.1",
    });
  })
);

it.effect(
  "removes the listener when interrupted during the initial native read",
  () =>
    Effect.gen(function* () {
      const requested = yield* Deferred.make<boolean>();
      const fake = fixture(
        "android",
        Deferred.succeed(requested, true).pipe(Effect.andThen(Effect.never))
      );
      const fiber = yield* Stream.runDrain(watchNetworkStatus).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild
      );
      yield* Deferred.await(requested);
      yield* Fiber.interrupt(fiber);
      assert.strictEqual(fake.removed(), 1);
    })
);

it.effect(
  "rejects malformed initial status and releases the acquired listener",
  () =>
    Effect.gen(function* () {
      const fake = fixture(
        "ios",
        Effect.succeed({ connected: true, connectionType: 42 })
      );
      const error = yield* Stream.runDrain(watchNetworkStatus).pipe(
        Effect.provide(fake.layer),
        Effect.flip
      );
      assert.strictEqual(error._tag, "BridgeDecodeError");
      assert.strictEqual(fake.removed(), 1);
    })
);
