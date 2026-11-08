// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type { TrackingSession } from "../../src/capabilities/tracking-session/tracking-schema.ts";
import {
  startTrackingSession,
  stopTrackingSession,
  newerTrackingSnapshot,
} from "../../src/capabilities/tracking-session/tracking-session.ts";
import { Bridge, BridgeCallFailed } from "../../src/core/bridge/bridge.ts";
import { RadicalProvider } from "../../src/react/react.ts";
import { useTrackingSession } from "../../src/react/use-tracking-session.ts";

const session: TrackingSession = {
  id: "one",
  revision: 2,
  startedAt: 1,
  options: { preset: "balanced" },
  status: { state: "running" },
  latest: null,
  permission: { state: "granted", precision: "approximate" },
  lastError: null,
};

const fixture = () => {
  const calls: string[] = [];
  let removed = 0;

  const layer = Layer.succeed(Bridge, {
    runtime: Effect.succeed("android" as const),
    observe: () =>
      Effect.succeed(() => {
        /* No shell events in this fixture. */
      }),
    listen: () =>
      Effect.succeed(
        Effect.sync(() => {
          removed += 1;
        })
      ),
    call: (plugin, method, options) => {
      calls.push(method);

      if (method === "getTrackingSession") {
        return Effect.succeed({ session });
      }

      const code =
        method === "startTrackingSession"
          ? "TrackingSessionAlreadyActive"
          : "TrackingSessionNotFound";

      return Effect.fail(
        new BridgeCallFailed({
          plugin,
          method,
          cause: {
            code,
            data: {
              id: method === "startTrackingSession" ? session.id : options.id,
            },
          },
        })
      );
    },
  });

  return { layer, calls, removed: () => removed };
};

it.effect("rejects invalid options before calling native", () =>
  Effect.gen(function* () {
    const native = fixture();

    for (const options of [
      { preset: "balanced", interval: 0 },
      { preset: "fitness", minimumDistance: -1 },
      { preset: "navigation", interval: Number.NaN },
    ] as const) {
      const error = yield* startTrackingSession(options).pipe(
        Effect.flip,
        Effect.provide(native.layer)
      );

      assert.strictEqual(error._tag, "InvalidTrackingOptions");
    }

    assert.deepStrictEqual(native.calls, []);
  })
);

it.effect("decodes the second-start error with the existing id", () =>
  Effect.gen(function* () {
    const native = fixture();

    const error = yield* startTrackingSession({ preset: "balanced" }).pipe(
      Effect.flip,
      Effect.provide(native.layer)
    );

    assert.strictEqual(error._tag, "TrackingSessionAlreadyActive");

    if (error._tag === "TrackingSessionAlreadyActive") {
      assert.strictEqual(error.id, "one");
    }
  })
);

it.effect("rejects stopping a stale id", () =>
  Effect.gen(function* () {
    const native = fixture();

    const error = yield* stopTrackingSession("old").pipe(
      Effect.flip,
      Effect.provide(native.layer)
    );

    assert.strictEqual(error._tag, "TrackingSessionNotFound");

    if (error._tag === "TrackingSessionNotFound") {
      assert.strictEqual(error.id, "old");
    }
  })
);

it.effect(
  "drops older snapshots including delayed previous-session events",
  () =>
    Effect.sync(() => {
      assert.strictEqual(
        newerTrackingSnapshot(session, { ...session, revision: 1 }),
        session
      );
      const next = { ...session, id: "two", revision: 3 };

      assert.strictEqual(newerTrackingSnapshot(next, session), next);

      assert.strictEqual(newerTrackingSnapshot(session, next), next);
    })
);

it.effect("mount retrieves and observes and unmount only unsubscribes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const native = fixture();
      const ready = yield* Deferred.make<boolean>();

      const Probe = () => {
        const state = useTrackingSession();
        useLayoutEffect(() => {
          if (!state.loading) {
            Effect.runSync(Deferred.succeed(ready, true));
          }
        }, [state]);

        return null;
      };

      const root = createRoot(document.createElement("div"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          flushSync(() => {
            root.unmount();
          });
        })
      );
      flushSync(() => {
        root.render(
          createElement(
            RadicalProvider,
            { layer: native.layer },
            createElement(Probe)
          )
        );
      });
      yield* Deferred.await(ready);
      flushSync(() => {
        root.unmount();
      });
      yield* Effect.yieldNow;

      assert.deepStrictEqual(native.calls, ["getTrackingSession"]);

      assert.strictEqual(native.removed(), 1);
    })
  )
);
