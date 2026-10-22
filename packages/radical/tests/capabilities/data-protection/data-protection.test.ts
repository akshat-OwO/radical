/* oxlint-disable typescript/promise-function-async -- In-memory browser Promise boundary. */
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  PluginModules,
  resolvePlugins,
} from "../../../src/build/plugins/plugin-plan.ts";
import {
  clearBrowserWebData,
  pauseOfflineWorker,
} from "../../../src/capabilities/data-protection/browser-web-data.ts";
import {
  BrowserDataProtection,
  clearWebData,
  setDataProtection,
  WebDataClearFailed,
} from "../../../src/capabilities/data-protection/data-protection.ts";
import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";

const unexpected = () =>
  Effect.sync(() => assert.fail("Unexpected native call"));
it.effect("sets and clears protection through both native bridges", () =>
  Effect.gen(function* () {
    for (const runtime of ["android", "ios"] as const) {
      const calls: unknown[] = [];
      const layer = bridgeTestLayer(runtime, (plugin, method, options) =>
        Effect.sync(() => {
          calls.push({ plugin, method, options });
          if (method === "setProtection") {
            return {
              enabled: options.enabled,
              screenshots: runtime === "android" && options.enabled,
              recording: options.enabled,
              appSwitcher: options.enabled,
            };
          }
          return {};
        })
      );
      for (const enabled of [true, false]) {
        const status = yield* setDataProtection(enabled).pipe(
          Effect.provide(layer)
        );
        assert.strictEqual(status.enabled, enabled);
        assert.strictEqual(
          status.screenshots,
          runtime === "android" && enabled
        );
      }
      yield* clearWebData.pipe(
        Effect.provide(layer),
        Effect.provideService(BrowserDataProtection, {
          clear: Effect.sync(() => {
            calls.push("browser cleared");
          }),
        })
      );
      assert.deepStrictEqual(calls, [
        {
          plugin: "RadicalDataProtection",
          method: "setProtection",
          options: { enabled: true },
        },
        {
          plugin: "RadicalDataProtection",
          method: "setProtection",
          options: { enabled: false },
        },
        "browser cleared",
        {
          plugin: "RadicalDataProtection",
          method: "clearWebData",
          options: {},
        },
      ]);
    }
  })
);

it.effect(
  "reports browser protection as unsupported and clears without a native call",
  () =>
    Effect.gen(function* () {
      let cleared = false;
      const bridge = bridgeTestLayer("browser", unexpected);
      assert.deepStrictEqual(
        yield* setDataProtection(true).pipe(Effect.provide(bridge)),
        {
          enabled: false,
          screenshots: false,
          recording: false,
          appSwitcher: false,
        }
      );
      yield* clearWebData.pipe(
        Effect.provide(bridge),
        Effect.provideService(BrowserDataProtection, {
          clear: Effect.sync(() => {
            cleared = true;
          }),
        })
      );
      assert.isTrue(cleared);
    })
);

it.effect(
  "preserves typed native and browser failures and decodes arguments",
  () =>
    Effect.gen(function* () {
      const error = new BridgeCallFailed({
        plugin: "RadicalDataProtection",
        method: "setProtection",
        cause: "unavailable",
      });
      assert.strictEqual(
        yield* setDataProtection(true).pipe(
          Effect.provide(bridgeTestLayer("ios", () => Effect.fail(error))),
          Effect.flip
        ),
        error
      );
      const failure = new WebDataClearFailed({ cause: "blocked database" });
      assert.strictEqual(
        yield* clearWebData.pipe(
          Effect.provide(bridgeTestLayer("browser", unexpected)),
          Effect.provideService(BrowserDataProtection, {
            clear: Effect.fail(failure),
          }),
          Effect.flip
        ),
        failure
      );
      // @ts-expect-error JavaScript callers still cross the Schema boundary.
      const invalid = setDataProtection("true");
      assert.strictEqual(
        (yield* invalid.pipe(
          Effect.provide(bridgeTestLayer("android", unexpected)),
          Effect.flip
        ))._tag,
        "BridgeDecodeError"
      );
    })
);

it.effect("clears every accessible cache, storage area and cookie path", () =>
  Effect.gen(function* () {
    const local = new Map([["secret", "local"]]);
    const session = new Map([["secret", "session"]]);
    const caches = new Set([
      "radical:app:build:snapshots",
      "radical:app:previous-build:snapshots",
      "radical:other-app:build:snapshots",
      "radical:app:build:assets",
      "manifest",
      "other",
    ]);
    const cookies: string[] = [];
    let snapshotsDisabled = false;
    yield* clearBrowserWebData(() => ({
      disableSnapshots: () => {
        snapshotsDisabled = true;
      },
      localStorage: {
        clear: () => {
          local.clear();
        },
      },
      sessionStorage: {
        clear: () => {
          session.clear();
        },
      },
      document: {
        get cookie() {
          return "secret=value; __Host-session=value";
        },
        set cookie(value: string) {
          cookies.push(value);
        },
      },
      location: {
        hostname: "app.example.test",
        pathname: "/private/page",
        protocol: "https:",
      },
      caches: {
        keys: () => Promise.resolve([...caches]),
        delete: (key) => Promise.resolve(caches.delete(key)),
      },
      indexedDB: {
        databases: () => Promise.resolve([]),
        deleteDatabase: () => assert.fail("No database to delete"),
      },
    }));
    assert.isTrue(snapshotsDisabled);
    assert.strictEqual(local.size, 0);
    assert.strictEqual(session.size, 0);
    assert.strictEqual(caches.size, 0);
    assert.include(
      cookies,
      "secret=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/private; Domain=.example.test; Secure"
    );
    assert.include(
      cookies,
      "__Host-session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure"
    );
  })
);

it.effect("times out an unresponsive offline worker with TestClock", () =>
  Effect.gen(function* () {
    const messages: unknown[] = [];
    const fiber = yield* pauseOfflineWorker({
      postMessage: (value: unknown) => {
        messages.push(value);
      },
    }).pipe(Effect.flip, Effect.forkChild);
    yield* TestClock.adjust("10 seconds");
    assert.deepStrictEqual(messages, ["radical-clear-web-data"]);
    assert.strictEqual((yield* Fiber.join(fiber))._tag, "WebDataClearFailed");
  })
);

it.effect("enables only the opted-in radical-owned native templates", () =>
  Effect.gen(function* () {
    for (const enabled of [undefined, false, true]) {
      const plugins = yield* resolvePlugins({
        appId: "dev.test.app",
        internalPlugins: { dataProtection: enabled },
      }).pipe(
        Effect.provide(Layer.succeed(PluginModules, { load: unexpected }))
      );
      const plugin = plugins.find(
        ({ manifest }) => manifest.id === "dataProtection"
      );
      assert.strictEqual(plugin !== undefined, enabled === true);
      if (plugin) {
        assert.deepStrictEqual(plugin.manifest.dependencies, {});
        assert.strictEqual(
          plugin.manifest.android?.sources[0]?.file,
          "RadicalDataProtectionPlugin.java"
        );
        assert.strictEqual(
          plugin.manifest.ios?.sources[0]?.file,
          "RadicalDataProtectionPlugin.swift"
        );
      }
    }
  })
);

for (const event of ["success", "error", "blocked"]) {
  it.effect(
    `waits for discoverable IndexedDB deletion and handles ${event}`,
    () =>
      Effect.gen(function* () {
        const names = new Set(["offline-manifest", "session"]);
        let request: (EventTarget & { error: unknown }) | undefined;
        const databaseError = new Error("database unavailable");
        const fiber = yield* clearBrowserWebData(() => ({
          localStorage: { clear: () => {} },
          sessionStorage: { clear: () => {} },
          document: { cookie: "" },
          location: { hostname: "app.test", pathname: "/", protocol: "https:" },
          indexedDB: {
            databases: () =>
              Promise.resolve([...names].map((name) => ({ name }))),
            deleteDatabase: (name) => {
              request = Object.assign(new EventTarget(), {
                error: databaseError,
              });
              request.addEventListener("success", () => {
                names.delete(name);
              });
              return request;
            },
          },
        })).pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("1 millis");
        assert.isDefined(request);
        assert.strictEqual(names.size, 2);
        request?.dispatchEvent(new Event(event));
        yield* TestClock.adjust("1 millis");
        if (event === "success") {
          assert.strictEqual(names.size, 1);
          request?.dispatchEvent(new Event("success"));
        }
        const result = yield* Fiber.join(fiber);
        if (event === "success") {
          assert.strictEqual(result._tag, "Success");
          assert.strictEqual(names.size, 0);
        } else {
          assert.strictEqual(result._tag, "Failure");
        }
      })
  );
}

for (const acknowledgement of [
  "radical-data-cleared",
  "radical-data-clear-failed",
]) {
  it.effect(`handles offline worker acknowledgement ${acknowledgement}`, () =>
    Effect.gen(function* () {
      const result = yield* pauseOfflineWorker({
        postMessage: (
          message: unknown,
          transfer?: StructuredSerializeOptions | Transferable[]
        ) => {
          assert.strictEqual(message, "radical-clear-web-data");
          const port = Array.isArray(transfer) ? transfer[0] : undefined;
          assert.instanceOf(port, MessagePort);
          if (port instanceof MessagePort) {
            port.postMessage(acknowledgement);
          }
        },
      }).pipe(Effect.result);
      assert.strictEqual(
        result._tag,
        acknowledgement === "radical-data-cleared" ? "Success" : "Failure"
      );
    })
  );
}
