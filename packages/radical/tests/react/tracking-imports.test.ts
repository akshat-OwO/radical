// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

it.effect("public browser entry imports do not read the injected bridge", () =>
  Effect.gen(function* () {
    let reads = 0;
    const descriptor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        vi.resetModules();
        Object.defineProperty(window, "Capacitor", {
          configurable: true,
          get: () => {
            reads += 1;
          },
        });
      }),
      () =>
        Effect.promise(
          async () =>
            await Promise.all([
              import("../../src/plain/client.ts"),
              import("../../src/plain/react.ts"),
              import("../../src/effect/client.ts"),
            ])
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              assert.strictEqual(reads, 0);
            })
          )
        ),
      () =>
        Effect.sync(() => {
          if (descriptor) {
            Object.defineProperty(window, "Capacitor", descriptor);
          } else {
            Reflect.deleteProperty(window, "Capacitor");
          }

          vi.resetModules();
        })
    );
  })
);
