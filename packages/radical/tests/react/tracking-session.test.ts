// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Fiber, Stream } from "effect";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type { TrackingSession } from "../../src/capabilities/tracking-session/tracking-schema.ts";
import {
  startTrackingSession,
  stopTrackingSession,
  getTrackingSession,
  watchTrackingSession,
} from "../../src/capabilities/tracking-session/tracking-session.ts";
import { Bridge, BridgeCallFailed } from "../../src/core/bridge/bridge.ts";
import { watchTrackingSession as watchPlain } from "../../src/plain/client.ts";
import { createEffectRuntime } from "../../src/plain/runtime.ts";
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

const fixture = (
  initial: TrackingSession | null = session,
  read?: Effect.Effect<{ session: TrackingSession | null }>,
  startup: Effect.Effect<void> = Effect.void,
  teardown: Effect.Effect<void, string> = Effect.void,
  destruction: Effect.Effect<void> = Effect.void
) => {
  let current = initial;
  let owned = initial?.status.state === "running";
  let stopOperation: Effect.Effect<unknown, BridgeCallFailed> | undefined;
  let revision = initial?.revision ?? 0;

  let listener:
    | ((value: {
        sessionId: string;
        revision: number;
        session: TrackingSession;
      }) => void)
    | undefined;

  const stopping = Deferred.makeUnsafe<boolean>();
  const removing = Deferred.makeUnsafe<boolean>();
  const destroying = Deferred.makeUnsafe<boolean>();
  const joinedStops = Deferred.makeUnsafe<boolean>();

  const starting = Deferred.makeUnsafe<boolean>();

  const reading = Deferred.makeUnsafe<boolean>();

  const released = Deferred.makeUnsafe<boolean>();

  const calls: string[] = [];
  let removed = 0;

  const layer = Layer.succeed(Bridge, {
    runtime: Effect.succeed("android" as const),
    observe: () =>
      Effect.succeed(() => {
        /* No shell events in this fixture. */
      }),
    listen: (_plugin, _event, receive) =>
      Effect.sync(() => {
        listener = receive;

        return Effect.sync(() => {
          removed += 1;
          Effect.runSync(Deferred.succeed(released, true));
        });
      }),
    call: (plugin, method, options) =>
      Effect.suspend<unknown, BridgeCallFailed, never>(() => {
        calls.push(method);

        if (method === "getTrackingSession") {
          Effect.runSync(Deferred.succeed(reading, true));

          return read ?? Effect.succeed({ session: current });
        }

        const fail = (code: string, id: string) =>
          Effect.fail(
            new BridgeCallFailed({
              plugin,
              method,
              cause: { code, data: { id } },
            })
          );

        if (method === "startTrackingSession") {
          if (owned && current !== null) {
            return fail("TrackingSessionAlreadyActive", current.id);
          }

          owned = true;
          current = {
            ...session,
            id: String((revision += 1)),
            revision,
            options: { preset: "balanced" },
          };

          Effect.runSync(Deferred.succeed(starting, true));

          return startup.pipe(Effect.as(current));
        }

        if (current === null || options.id !== current.id) {
          return fail("TrackingSessionNotFound", String(options.id));
        }

        Effect.runSync(Deferred.succeed(stopping, true));

        stopOperation ??= Effect.runSync(
          Effect.cached(
            startup.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (current?.status.state === "running") {
                    current = {
                      ...current,
                      revision: (revision += 1),
                      status: { state: "stopped", reason: "user" },
                    };
                  }
                })
              ),
              Effect.andThen(Deferred.succeed(removing, true)),
              Effect.andThen(teardown),
              Effect.mapError(
                (reason) =>
                  new BridgeCallFailed({
                    plugin,
                    method,
                    cause: { code: "Unavailable", data: { reason } },
                  })
              ),
              Effect.andThen(Deferred.succeed(destroying, true)),
              Effect.andThen(destruction),
              Effect.andThen(
                Effect.sync(() => {
                  owned = false;

                  return current;
                })
              ),
              Effect.onExit(() =>
                Effect.sync(() => {
                  stopOperation = undefined;
                })
              )
            )
          )
        );

        const operation = stopOperation;

        if (
          calls.filter((call) => call === "stopTrackingSession").length === 2
        ) {
          Effect.runSync(Deferred.succeed(joinedStops, true));
        }

        return operation;
      }),
  });

  return {
    layer,
    calls,
    reading,
    starting,
    stopping,
    removing,
    destroying,
    joinedStops,
    released,
    emit: (value: TrackingSession) => {
      listener?.({
        sessionId: value.id,
        revision: value.revision,
        session: value,
      });
    },
    removed: () => removed,
  };
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

it.effect("owns successful starts, idempotent stops and replacement", () =>
  Effect.gen(function* () {
    const native = fixture(null);

    yield* Effect.gen(function* () {
      const first = yield* startTrackingSession({ preset: "balanced" });

      const active = yield* startTrackingSession({ preset: "balanced" }).pipe(
        Effect.flip
      );

      assert.strictEqual(active._tag, "TrackingSessionAlreadyActive");

      if (active._tag === "TrackingSessionAlreadyActive") {
        assert.strictEqual(active.id, first.id);
      }

      const stopped = yield* stopTrackingSession(first.id);

      assert.strictEqual(stopped.status.state, "stopped");

      assert.deepStrictEqual(yield* stopTrackingSession(first.id), stopped);

      assert.deepStrictEqual(yield* getTrackingSession, stopped);

      const next = yield* startTrackingSession({ preset: "balanced" });

      assert.notStrictEqual(next.id, first.id);

      assert.deepStrictEqual(yield* getTrackingSession, next);

      const stale = yield* stopTrackingSession(first.id).pipe(Effect.flip);

      assert.strictEqual(stale._tag, "TrackingSessionNotFound");
    }).pipe(Effect.provide(native.layer));
  })
);

it.effect("stream drops reordered events and a delayed initial read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initial = yield* Deferred.make<{
        session: TrackingSession | null;
      }>();

      const native = fixture(session, Deferred.await(initial));

      const values: (TrackingSession | null)[] = [];

      const received = yield* Deferred.make<boolean>();

      const fiber = yield* watchTrackingSession.pipe(
        Stream.runForEach((value) =>
          Effect.sync(() => {
            values.push(value);

            if (value?.revision === 4) {
              Effect.runSync(Deferred.succeed(received, true));
            }
          })
        ),
        Effect.provide(native.layer),
        Effect.forkScoped
      );

      yield* Deferred.await(native.reading);

      assert.deepStrictEqual(values, []);

      native.emit({ ...session, revision: 3 });

      native.emit(session);

      yield* Deferred.succeed(initial, { session });

      native.emit({ ...session, id: "two", revision: 4 });

      yield* Deferred.await(received);

      yield* Fiber.interrupt(fiber);

      assert.deepStrictEqual(
        values.map((value) => value?.revision),
        [3, 4]
      );

      yield* Deferred.await(native.released);
    })
  )
);

for (const first of ["retrieval", "event"] as const) {
  it.effect(
    `hook waits for ${first}, drops older revisions and only unsubscribes`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const initial = yield* Deferred.make<{
            session: TrackingSession | null;
          }>();

          const native = fixture(session, Deferred.await(initial));
          let latest: ReturnType<typeof useTrackingSession> | undefined;

          const ready = yield* Deferred.make<boolean>();

          const updated = yield* Deferred.make<boolean>();

          const revisions: number[] = [];

          const Probe = () => {
            const state = useTrackingSession();
            useLayoutEffect(() => {
              latest = state;

              if (state.value !== null) {
                revisions.push(state.value.revision);
              }

              if (state.value?.revision === 4) {
                Effect.runSync(Deferred.succeed(updated, true));
              }

              if (!state.loading && state.value?.id === session.id) {
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

          yield* Deferred.await(native.reading);

          assert.strictEqual(latest?.loading, true);

          if (first === "event") {
            native.emit({ ...session, revision: 3 });

            yield* Deferred.await(ready);

            yield* Deferred.succeed(initial, { session });
          } else {
            yield* Deferred.succeed(initial, { session });

            yield* Deferred.await(ready);
          }

          native.emit({ ...session, revision: 3 });

          native.emit(session);

          native.emit({ ...session, id: "two", revision: 4 });

          yield* Deferred.await(updated);

          yield* Effect.yieldNow;

          assert.strictEqual(latest?.value?.id, "two");

          assert.isTrue(
            revisions.every(
              (revision, index) =>
                index === 0 || revision >= revisions[index - 1]
            )
          );
          flushSync(() => {
            root.unmount();
          });

          yield* Deferred.await(native.released);

          assert.deepStrictEqual(native.calls, ["getTrackingSession"]);

          assert.strictEqual(native.removed(), 1);
        })
      )
  );
}

it.effect(
  "Plain callbacks discard reordered events and delayed retrieval",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initial = yield* Deferred.make<{
          session: TrackingSession | null;
        }>();

        const native = fixture(session, Deferred.await(initial));

        const runtime = createEffectRuntime(native.layer);

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await runtime.dispose();
          })
        );

        const values: (TrackingSession | null)[] = [];

        const done = yield* Deferred.make<boolean>();

        const release = watchPlain(
          (value) => {
            values.push(value);

            if (value?.revision === 4) {
              Effect.runSync(Deferred.succeed(done, true));
            }
          },
          (error) => {
            assert.fail(String(error));
          },
          runtime
        );

        yield* Effect.addFinalizer(() => Effect.sync(release));

        yield* Deferred.await(native.reading);

        assert.deepStrictEqual(values, []);

        native.emit({ ...session, revision: 3 });

        native.emit(session);

        yield* Deferred.succeed(initial, { session });

        native.emit({ ...session, id: "two", revision: 4 });

        yield* Deferred.await(done);
        release();

        yield* Deferred.await(native.released);

        assert.deepStrictEqual(
          values.map((value) => value?.revision),
          [3, 4]
        );
      })
    )
);

it.effect("watch preserves a genuine null retrieved from native", () =>
  Effect.gen(function* () {
    const native = fixture(null);

    const values = yield* watchTrackingSession.pipe(
      Stream.take(1),
      Stream.runCollect,
      Effect.provide(native.layer)
    );

    assert.deepStrictEqual([...values], [null]);
  })
);

it.effect(
  "rejects replacement during registration and teardown until release",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const delivered = yield* Deferred.make<boolean>();

        const teardown = yield* Deferred.make<undefined>();
        const destruction = yield* Deferred.make<undefined>();

        const native = fixture(
          null,
          undefined,
          Deferred.await(delivered).pipe(Effect.asVoid),
          Deferred.await(teardown),
          Deferred.await(destruction)
        );

        yield* Effect.gen(function* () {
          const first = yield* startTrackingSession({
            preset: "balanced",
          }).pipe(Effect.forkScoped);

          yield* Deferred.await(native.starting);

          const stop = yield* stopTrackingSession("1").pipe(Effect.forkScoped);

          yield* Deferred.await(native.stopping);

          const blocked = yield* startTrackingSession({
            preset: "balanced",
          }).pipe(Effect.flip);

          assert.strictEqual(blocked._tag, "TrackingSessionAlreadyActive");

          if (blocked._tag === "TrackingSessionAlreadyActive") {
            assert.strictEqual(blocked.id, "1");
          }

          yield* Deferred.succeed(delivered, true);

          const started = yield* Fiber.join(first);

          yield* Deferred.await(native.removing);

          const duringRemoval = yield* startTrackingSession({
            preset: "balanced",
          }).pipe(Effect.flip);

          assert.strictEqual(
            duringRemoval._tag,
            "TrackingSessionAlreadyActive"
          );
          yield* Deferred.succeed(teardown, undefined);

          yield* Deferred.await(native.destroying);

          const duringDestruction = yield* startTrackingSession({
            preset: "balanced",
          }).pipe(Effect.flip);

          assert.strictEqual(
            duringDestruction._tag,
            "TrackingSessionAlreadyActive"
          );

          yield* Deferred.succeed(destruction, undefined);

          const stopped = yield* Fiber.join(stop);

          assert.strictEqual(started.id, "1");

          assert.strictEqual(stopped.id, "1");

          assert.strictEqual(stopped.status.state, "stopped");

          const next = yield* startTrackingSession({ preset: "balanced" });

          assert.notStrictEqual(next.id, started.id);
        }).pipe(Effect.provide(native.layer));
      })
    )
);

for (const reason of [
  "removal failed",
  "removal canceled",
  "synchronous removal exception",
]) {
  it.effect(
    `maps ${reason}, retains ownership and settles concurrent stops once`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const teardown = yield* Deferred.make<undefined, string>();

          let attempts = 0;

          const native = fixture(
            session,
            undefined,
            Effect.void,
            Effect.suspend(() => {
              attempts += 1;

              return attempts === 1 ? Deferred.await(teardown) : Effect.void;
            })
          );

          let settlements = 0;
          yield* Effect.gen(function* () {
            const stop = stopTrackingSession(session.id).pipe(
              Effect.flip,
              Effect.tap(() =>
                Effect.sync(() => {
                  settlements += 1;
                })
              )
            );

            const first = yield* stop.pipe(Effect.forkScoped);
            yield* Deferred.await(native.removing);
            const second = yield* stop.pipe(Effect.forkScoped);
            yield* Deferred.await(native.joinedStops);
            yield* Deferred.fail(teardown, reason);

            for (const fiber of [first, second]) {
              const error = yield* Fiber.join(fiber);
              assert.strictEqual(error._tag, "Unavailable");

              if (error._tag === "Unavailable") {
                assert.strictEqual(error.reason, reason);
              }
            }

            assert.strictEqual(settlements, 2);

            const blocked = yield* startTrackingSession({
              preset: "balanced",
            }).pipe(Effect.flip);

            assert.strictEqual(blocked._tag, "TrackingSessionAlreadyActive");
            const retried = yield* stopTrackingSession(session.id);

            assert.strictEqual(retried.status.state, "stopped");

            const replacement = yield* startTrackingSession({
              preset: "balanced",
            });

            assert.notStrictEqual(replacement.id, session.id);

            assert.strictEqual(attempts, 2);

            assert.strictEqual(settlements, 2);
          }).pipe(Effect.provide(native.layer));
        })
      )
  );
}
