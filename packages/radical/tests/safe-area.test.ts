import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { Bridge } from "../src/bridge.ts";
import { safeAreaStyle } from "../src/native-context.ts";
import type { SafeArea } from "../src/native-context.ts";
import { watchSafeArea } from "../src/safe-area.ts";

const portrait = { top: 62, right: 0, bottom: 34, left: 0 };
const landscape = { top: 0, right: 62, bottom: 21, left: 62 };

describe("safe area", () => {
  it.effect(
    "keeps bundled shell styles identical during prerender and first client render",
    () =>
      Effect.sync(() => {
        const prerender = renderToString(
          createElement("html", {
            style: safeAreaStyle(
              {
                platform: "browser",
                shellVersion: null,
                safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              "bundled"
            ),
          })
        );
        const firstClient = renderToString(
          createElement("html", {
            style: safeAreaStyle(
              { platform: "ios", shellVersion: "1", safeArea: portrait },
              "bundled"
            ),
          })
        );
        assert.strictEqual(firstClient, prerender);
        assert.include(firstClient, "env(safe-area-inset-top, 0px)");
      })
  );
  it.effect("serializes fractional CSS pixels for the first shell paint", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        safeAreaStyle({
          platform: "android",
          shellVersion: "1",
          safeArea: { ...portrait, top: 24.5 },
        }),
        {
          "--radical-safe-area-top": "24.5px",
          "--radical-safe-area-right": "0px",
          "--radical-safe-area-bottom": "34px",
          "--radical-safe-area-left": "0px",
        }
      );
    })
  );
  it.effect("leaves browser variables bound to CSS env", () =>
    Effect.sync(() => {
      const style = safeAreaStyle({
        platform: "browser",
        shellVersion: null,
        safeArea: portrait,
      });
      assert.strictEqual(
        style["--radical-safe-area-top"],
        "env(safe-area-inset-top, 0px)"
      );
      assert.strictEqual(
        style["--radical-safe-area-left"],
        "env(safe-area-inset-left, 0px)"
      );
    })
  );
  it.effect(
    "receives rotation and bar updates and releases its bridge listener",
    () =>
      Effect.gen(function* () {
        const values: SafeArea[] = [];
        let removed = false;
        let publish: ((value: unknown) => void) | undefined;
        const layer = Layer.succeed(Bridge, {
          runtime: Effect.succeed("ios" as const),
          call: () => Effect.never,
          observe: (event, receive) =>
            Effect.sync(() => {
              assert.strictEqual(event, "radicalSafeArea");
              publish = receive;
              receive(portrait);
              return () => {
                removed = true;
              };
            }),
        });
        const subscription = yield* Effect.forkChild(
          Effect.scoped(
            watchSafeArea((value) => {
              values.push(value);
            }).pipe(Effect.andThen(Effect.never))
          ).pipe(Effect.provide(layer))
        );
        yield* Effect.yieldNow;
        const rotation = yield* Effect.forkChild(
          Effect.sleep("1 second").pipe(
            Effect.andThen(
              Effect.sync(() => {
                publish?.(landscape);
              })
            )
          )
        );
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(rotation);
        publish?.({ ...landscape, bottom: 0 });
        publish?.({ top: -1, right: 0, bottom: 0, left: 0 });
        publish?.({ ...portrait, right: Number.NaN });
        publish?.({ ...portrait, bottom: Number.POSITIVE_INFINITY });
        publish?.({ ...portrait, left: "0" });
        publish?.({ top: 0, right: 0, bottom: 0 });
        publish?.(null);
        assert.deepStrictEqual(values, [
          portrait,
          landscape,
          { ...landscape, bottom: 0 },
        ]);
        yield* Fiber.interrupt(subscription);
        assert.isTrue(removed);
      })
  );
});
