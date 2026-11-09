// oxlint-disable eslint/no-loop-func -- Each synchronous flush completes before the next loop iteration.
// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Schema } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { bridgeTestLayer } from "../../src/core/bridge/bridge.ts";
import { RadicalProvider, useKeyValue } from "../../src/react/react.ts";

it.effect(
  "reads on mount and refreshes after set, remove and namespace clear",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let state: ReturnType<typeof useKeyValue> | undefined;
        let settled = yield* Deferred.make<boolean>();
        let json: string | undefined;
        const operations: string[] = [];

        const layer = bridgeTestLayer("ios", (_plugin, _method, args) =>
          Effect.sync(() => {
            const request = Schema.decodeUnknownSync(
              Schema.Struct({
                operation: Schema.String,
                json: Schema.optional(Schema.String),
              })
            )(args);

            operations.push(request.operation);

            if (request.operation === "set") {
              ({ json } = request);
            }

            if (
              request.operation === "remove" ||
              request.operation === "clear"
            ) {
              json = undefined;
            }

            return json === undefined ? {} : { json };
          })
        );

        const Probe = () => {
          const storage = useKeyValue(
            { store: "settings", namespace: "user", backup: "eligible" },
            "key"
          );

          useLayoutEffect(() => {
            state = storage;

            if (!storage.loading && storage.value !== undefined) {
              const signal = settled;
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(signal, true));
              });
            }
          }, [storage]);

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
            createElement(RadicalProvider, { layer }, createElement(Probe))
          );
        });
        yield* Deferred.await(settled);
        assert.deepStrictEqual(state?.value, { found: false });

        for (const action of ["set", "remove", "clear", "refresh"] as const) {
          settled = yield* Deferred.make<boolean>();
          flushSync(() => {
            if (action === "set") {
              state?.set({ count: 2 });
            } else {
              state?.[action]();
            }
          });
          yield* Deferred.await(settled);
          assert.deepStrictEqual(
            state?.value,
            action === "set"
              ? { found: true, value: { count: 2 } }
              : { found: false }
          );
          assert.isUndefined(state?.error);
        }

        assert.deepStrictEqual(operations, [
          "get",
          "set",
          "get",
          "remove",
          "get",
          "clear",
          "get",
          "get",
        ]);
      })
    )
);

it.effect(
  "replaces a pending lookup on identity change and rejects stale actions",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let state: ReturnType<typeof useKeyValue> | undefined;
        const started = yield* Deferred.make<boolean>();
        const settled = yield* Deferred.make<boolean>();
        const interrupted = yield* Deferred.make<boolean>();
        const calls: string[] = [];

        const layer = bridgeTestLayer("android", (_plugin, _method, args) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(
              Schema.Struct({ key: Schema.String })
            )(args);

            calls.push(request.key);

            if (request.key === "old") {
              yield* Deferred.succeed(started, true);

              return yield* Effect.never.pipe(
                Effect.onInterrupt(() => Deferred.succeed(interrupted, true))
              );
            }

            return { json: '"new"' };
          }).pipe(Effect.orDie)
        );

        const Probe = ({ name }: { readonly name: string }) => {
          const storage = useKeyValue(
            { store: "settings", namespace: "user", backup: "eligible" },
            name
          );

          useLayoutEffect(() => {
            state = storage;

            if (storage.value?.found === true) {
              queueMicrotask(() => {
                Effect.runSync(Deferred.succeed(settled, true));
              });
            }
          }, [storage]);

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

        const render = (name: string) => {
          flushSync(() => {
            root.render(
              createElement(
                RadicalProvider,
                { layer },
                createElement(Probe, { name })
              )
            );
          });
        };

        render("old");
        yield* Deferred.await(started);
        const stale = state?.set;
        render("new");
        yield* Deferred.await(interrupted);
        yield* Deferred.await(settled);
        stale?.("ignored");
        assert.deepStrictEqual(state?.value, { found: true, value: "new" });
        assert.deepStrictEqual(calls, ["old", "new"]);
      })
    )
);

it.effect("reports browser Unavailable in hook state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const settled = yield* Deferred.make<boolean>();
      let tag: string | undefined;

      const layer = bridgeTestLayer("browser", () =>
        Effect.sync(() => assert.fail("Native called"))
      );

      const Probe = () => {
        const storage = useKeyValue(
          { store: "settings", namespace: "user", backup: "eligible" },
          "key"
        );

        useLayoutEffect(() => {
          tag = storage.error?._tag;

          if (tag !== undefined) {
            queueMicrotask(() => {
              Effect.runSync(Deferred.succeed(settled, true));
            });
          }
        }, [storage]);

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
          createElement(RadicalProvider, { layer }, createElement(Probe))
        );
      });
      yield* Deferred.await(settled);
      assert.strictEqual(tag, "Unavailable");
    })
  )
);
