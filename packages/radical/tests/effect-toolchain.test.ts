import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

describe("Effect toolchain", () => {
  it.effect("runs Effect programs under vp test", () =>
    Effect.gen(function* () {
      const value = yield* Effect.succeed(21).pipe(Effect.map((n) => n * 2));
      assert.strictEqual(value, 42);
    })
  );

  it.effect("uses the virtual TestClock instead of wall time", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.sleep("1 hour").pipe(Effect.as("done"))
      );

      yield* TestClock.adjust("1 hour");
      assert.strictEqual(yield* Fiber.join(fiber), "done");
    })
  );
});
