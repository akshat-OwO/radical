import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  subscribeWindowLayout,
  watchWindowLayout,
} from "../../../src/capabilities/window-layout/window-layout.ts";
import { Bridge } from "../../../src/core/bridge/bridge.ts";
import type { WindowLayout } from "../../../src/core/context/native-context.ts";

const flat: WindowLayout = {
  widthClass: "compact",
  posture: "flat",
  hinge: null,
};

const tabletop: WindowLayout = {
  widthClass: "expanded",
  posture: "tabletop",
  hinge: { x: 0, y: 400, width: 900, height: 12.5 },
};

describe("window layout", () => {
  it.effect(
    "replays layout, ignores malformed events, and removes its scoped listener",
    () =>
      Effect.gen(function* () {
        const values: WindowLayout[] = [];
        let publish: Parameters<Bridge["Service"]["observe"]>[1] | undefined;
        let removed = false;

        const layer = Layer.succeed(Bridge, {
          runtime: Effect.succeed("android" as const),
          call: () => Effect.never,
          observe: (event, receive) =>
            Effect.sync(() => {
              assert.strictEqual(event, "radicalWindowLayout");
              publish = receive;
              receive(flat);

              return () => {
                removed = true;
              };
            }),
        });

        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            watchWindowLayout((value) => {
              values.push(value);
            }).pipe(Effect.andThen(Effect.never))
          ).pipe(Effect.provide(layer))
        );

        yield* Effect.yieldNow;

        const fold = yield* Effect.forkChild(
          Effect.sleep("1 second").pipe(
            Effect.andThen(Effect.sync(() => publish?.(tabletop)))
          )
        );

        yield* TestClock.adjust("1 second");
        yield* Fiber.join(fold);

        for (const value of [
          null,
          {},
          { ...flat, widthClass: "large" },
          { ...flat, posture: "folded" },
          { ...tabletop, hinge: { ...tabletop.hinge, x: -1 } },
          { ...tabletop, hinge: { ...tabletop.hinge, width: Infinity } },
        ]) {
          publish?.(value);
        }

        assert.deepStrictEqual(values, [flat, tabletop]);
        yield* Fiber.interrupt(fiber);
        assert.isTrue(removed);
      })
  );

  it.effect(
    "uses matchMedia at 600 and 840 CSS pixels and releases both listeners",
    () =>
      Effect.gen(function* () {
        let width = 599;
        const listeners = new Set<() => void>();
        const queries: string[] = [];
        const removedQueries: string[] = [];
        const values: WindowLayout[] = [];

        const matchMedia = (query: string) => {
          queries.push(query);

          return {
            get matches() {
              return width >= (query.includes("600") ? 600 : 840);
            },
            addEventListener: (_: string, listener: () => void) => {
              listeners.add(listener);
            },
            removeEventListener: (_: string, listener: () => void) => {
              listeners.delete(listener);
              removedQueries.push(query);
            },
          };
        };

        const remove = yield* subscribeWindowLayout((value) => {
          values.push(value);
        }, matchMedia).pipe(
          Effect.provide(
            Layer.succeed(Bridge, {
              runtime: Effect.succeed("browser" as const),
              call: () => Effect.never,
              observe: () => Effect.never,
            })
          )
        );

        for (const next of [600, 839, 840, 1200, 599]) {
          width = next;

          for (const listener of listeners) {
            listener();
          }
        }

        assert.deepStrictEqual(queries, [
          "(min-width: 600px)",
          "(min-width: 840px)",
        ]);
        assert.deepStrictEqual(
          values.map((value) => value.widthClass),
          ["compact", "medium", "medium", "expanded", "expanded", "compact"]
        );
        assert.isTrue(
          values.every(
            (value) => value.posture === "flat" && value.hinge === null
          )
        );
        remove();
        assert.strictEqual(listeners.size, 0);
        assert.deepStrictEqual(removedQueries, queries);
      })
  );
});
