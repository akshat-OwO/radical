// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { createElement, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { LocationTimeout } from "../../src/capabilities/location/location-schema.ts";
import type { TrackingSession } from "../../src/capabilities/tracking-session/tracking-schema.ts";
import {
  startTrackingSession,
  stopTrackingSession,
  getTrackingSession,
  watchTrackingSession,
} from "../../src/capabilities/tracking-session/tracking-session.ts";
import { Bridge, BridgeCallFailed } from "../../src/core/bridge/bridge.ts";
import { Unavailable } from "../../src/core/errors.ts";
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
  notifications: { state: "granted" },
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
  let foreground: ((value: { active: boolean }) => void) | undefined;

  const layer = Layer.succeed(Bridge, {
    runtime: Effect.succeed("android" as const),
    observe: () =>
      Effect.succeed(() => {
        /* No shell events in this fixture. */
      }),
    listen: (_plugin, event, receive) =>
      Effect.sync(() => {
        if (event === "appStateChange") {
          foreground = receive;

          return Effect.sync(() => {
            foreground = undefined;
          });
        }

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
    foreground: () => foreground?.({ active: true }),
    reconcile: (value: TrackingSession) => {
      current = value;
    },
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
    `decodes bridge error "${reason}" and retains ownership until retry`,
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

// An in-memory model of the native owner's lifecycle contract. These tests
// check how the client handles each native outcome; they do not run the Java
// owner, whose behavior is verified on devices (#176).
// Task cancellation is a native completion outcome, not fiber interruption.
type NativeOutcome = "success" | "failure" | "cancellation" | "exception";

const lifecycleOwner = (
  registration: Effect.Effect<NativeOutcome>,
  removal: Effect.Effect<NativeOutcome>
) => {
  const counts = {
    registrations: 0,
    removals: 0,
    callbacks: 0,
    starts: 0,
    stops: 0,
  };

  let current: TrackingSession | null = null;

  let pending: Effect.Effect<unknown, BridgeCallFailed> | undefined;

  let cleanup = false;

  let nextId = 0;

  const starting = Deferred.makeUnsafe<undefined>();

  const stopping = Deferred.makeUnsafe<undefined>();

  const error = (method: string, reason: NativeOutcome) =>
    new BridgeCallFailed({
      plugin: "RadicalTrackingSession",
      method,
      cause: { code: "Unavailable", data: { reason } },
    });

  const invoke = (method: string, outcome: NativeOutcome) =>
    Effect.try({
      try: () => {
        if (outcome === "exception") {
          throw new Error("Synchronous native invocation failed");
        }

        return {
          canceled: outcome === "cancellation",
          successful: outcome === "success",
        };
      },
      catch: () => error(method, "exception"),
    }).pipe(
      Effect.flatMap((task) => {
        if (task.canceled) {
          return Effect.fail(error(method, "cancellation"));
        }

        return task.successful
          ? Effect.void
          : Effect.fail(error(method, "failure"));
      })
    );

  const remove = Effect.gen(function* () {
    counts.removals += 1;

    const outcome = yield* removal;

    yield* invoke("stopTrackingSession", outcome);

    counts.callbacks = 0;

    cleanup = false;
  });

  const layer = Layer.succeed(Bridge, {
    runtime: Effect.succeed("android" as const),
    observe: () => Effect.succeed(() => {}),
    call: (_plugin, method) =>
      Effect.suspend<unknown, BridgeCallFailed, never>(() => {
        if (method === "getTrackingSession") {
          return Effect.succeed({ session: current });
        }

        if (method === "startTrackingSession") {
          return Effect.gen(function* () {
            if (cleanup) {
              yield* remove;
            }

            const previous = current;

            current = { ...session, id: String((nextId += 1)) };

            counts.registrations += 1;

            counts.callbacks += 1;

            pending = yield* Effect.cached(
              Effect.gen(function* () {
                const outcome = yield* registration;

                yield* invoke(method, outcome).pipe(
                  Effect.catch((error_) =>
                    Effect.gen(function* () {
                      current = previous;

                      cleanup = true;

                      yield* Effect.ignore(remove);

                      return yield* Effect.fail(error_);
                    })
                  )
                );

                return current;
              })
            );

            yield* Deferred.succeed(starting, undefined);

            return yield* pending.pipe(
              Effect.onExit(() =>
                Effect.sync(() => {
                  counts.starts += 1;
                })
              )
            );
          });
        }

        return Effect.gen(function* () {
          yield* Deferred.succeed(stopping, undefined);

          if (pending) {
            yield* Effect.ignore(pending);
          }

          if (cleanup || counts.callbacks > 0) {
            yield* remove;
          }

          if (current === null) {
            return yield* Effect.fail(
              new BridgeCallFailed({
                plugin: "RadicalTrackingSession",
                method,
                cause: { code: "TrackingSessionNotFound", data: { id: "1" } },
              })
            );
          }

          return current;
        }).pipe(
          Effect.onExit(() =>
            Effect.sync(() => {
              counts.stops += 1;
            })
          )
        );
      }),
  });

  return { layer, counts, starting, stopping };
};

for (const outcome of ["failure", "cancellation", "exception"] as const) {
  it.effect(
    `lifecycle model recovers from registration ${outcome} and failed rollback removal`,
    () =>
      Effect.gen(function* () {
        let registrations = 0;

        let removals = 0;

        const native = lifecycleOwner(
          Effect.sync(() => ((registrations += 1) === 1 ? outcome : "success")),
          Effect.sync(() => ((removals += 1) === 1 ? "failure" : "success"))
        );

        yield* Effect.gen(function* () {
          const failed = yield* startTrackingSession({
            preset: "balanced",
          }).pipe(Effect.flip);

          assert.strictEqual(failed._tag, "Unavailable");

          assert.strictEqual(native.counts.callbacks, 1);

          assert.strictEqual(yield* getTrackingSession, null);

          const recovered = yield* startTrackingSession({ preset: "balanced" });

          assert.strictEqual(recovered.id, "2");

          assert.deepStrictEqual(native.counts, {
            registrations: 2,
            removals: 2,
            callbacks: 1,
            starts: 2,
            stops: 0,
          });

          yield* stopTrackingSession(recovered.id);

          assert.strictEqual(native.counts.callbacks, 0);
        }).pipe(Effect.provide(native.layer));
      })
  );
}

it.effect(
  "lifecycle model settles start and pending stop once after canceled registration",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const task = yield* Deferred.make<NativeOutcome>();

        const native = lifecycleOwner(
          Deferred.await(task),
          Effect.succeed("success")
        );

        yield* Effect.gen(function* () {
          const start = yield* startTrackingSession({
            preset: "balanced",
          }).pipe(Effect.flip, Effect.forkScoped);

          yield* Deferred.await(native.starting);

          const stop = yield* stopTrackingSession("1").pipe(
            Effect.flip,
            Effect.forkScoped
          );

          yield* Deferred.await(native.stopping);

          yield* Deferred.succeed(task, "cancellation");

          assert.strictEqual((yield* Fiber.join(start))._tag, "Unavailable");

          assert.strictEqual(
            (yield* Fiber.join(stop))._tag,
            "TrackingSessionNotFound"
          );

          assert.deepStrictEqual(native.counts, {
            registrations: 1,
            removals: 1,
            callbacks: 0,
            starts: 1,
            stops: 1,
          });
        }).pipe(Effect.provide(native.layer));
      })
    )
);

for (const outcome of ["failure", "cancellation", "exception"] as const) {
  it.effect(
    `lifecycle model retains callback after removal ${outcome} and retries cleanup`,
    () =>
      Effect.gen(function* () {
        let removals = 0;

        const native = lifecycleOwner(
          Effect.succeed("success"),
          Effect.sync(() => ((removals += 1) === 1 ? outcome : "success"))
        );

        yield* Effect.gen(function* () {
          const started = yield* startTrackingSession({ preset: "balanced" });

          const failed = yield* stopTrackingSession(started.id).pipe(
            Effect.flip
          );

          assert.strictEqual(failed._tag, "Unavailable");

          assert.strictEqual(native.counts.callbacks, 1);

          yield* stopTrackingSession(started.id);

          assert.deepStrictEqual(native.counts, {
            registrations: 1,
            removals: 2,
            callbacks: 0,
            starts: 1,
            stops: 2,
          });
        }).pipe(Effect.provide(native.layer));
      })
  );
}

it.effect(
  "Effect watch re-retrieves on foreground and drops stale reconciliation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = fixture();
        const ready = yield* Deferred.make<undefined>();
        const resumed = yield* Deferred.make<undefined>();
        const barrier = yield* Deferred.make<undefined>();
        const values: number[] = [];
        yield* watchTrackingSession.pipe(
          Stream.runForEach((value) =>
            Effect.gen(function* () {
              if (value !== null) {
                values.push(value.revision);
              }

              if (value?.revision === 2) {
                yield* Deferred.succeed(ready, undefined);
              }

              if (value?.revision === 5) {
                yield* Deferred.succeed(barrier, undefined);
              }

              if (value?.revision === 4) {
                yield* Deferred.succeed(resumed, undefined);
              }
            })
          ),
          Effect.provide(native.layer),
          Effect.forkScoped
        );
        yield* Deferred.await(ready);
        native.reconcile({
          ...session,
          revision: 4,
          status: { state: "suspended", reason: "servicesOff" },
        });
        native.foreground();
        yield* Deferred.await(resumed);
        native.emit({ ...session, revision: 3 });
        native.emit({ ...session, revision: 5 });
        yield* Deferred.await(barrier);
        assert.deepStrictEqual(values, [2, 4, 5]);
        assert.strictEqual(
          native.calls.filter((call) => call === "getTrackingSession").length,
          2
        );
      })
    )
);

for (const snapshot of [
  { ...session, status: { state: "interrupted", reason: "termination" } },
  {
    ...session,
    status: { state: "stopped", reason: "permissionRevoked" },
    permission: { state: "denied", precision: "unknown" },
  },
  { ...session, status: { state: "suspended", reason: "servicesOff" } },
  { ...session, notifications: { state: "denied" } },
] as const) {
  it.effect(
    `retrieves native ${snapshot.status.state} snapshot with notifications ${snapshot.notifications.state}`,
    () =>
      Effect.gen(function* () {
        const native = fixture(snapshot);

        const value = yield* getTrackingSession.pipe(
          Effect.provide(native.layer)
        );

        assert.deepStrictEqual(value, snapshot);
      })
  );
}

// Lifecycle model of the native contract, not a Java execution harness.
const interruptionModel = () => {
  type Metadata = Pick<TrackingSession, "id" | "options" | "startedAt"> & {
    terminalState: TrackingSession["status"] | null;
  };

  let persisted: Metadata | null = null;
  let value: TrackingSession = { ...session };
  let failCommit = false;
  let granted = true;
  let needsHydration = false;
  const counts = { registrations: 0, removals: 0, callbacks: 0 };
  const published: TrackingSession[] = [];

  const commit = (candidate: TrackingSession) =>
    Effect.gen(function* () {
      if (failCommit) {
        return yield* new Unavailable({ reason: "Metadata commit failed" });
      }

      persisted = {
        id: candidate.id,
        options: candidate.options,
        startedAt: candidate.startedAt,
        terminalState: ["stopped", "interrupted"].includes(
          candidate.status.state
        )
          ? candidate.status
          : null,
      };

      return true;
    });

  const update = (patch: Partial<TrackingSession>) => {
    value = { ...value, ...patch, revision: value.revision + 1 };
    published.push(value);
  };

  const stop = (reason: "user" | "permissionRevoked") =>
    Effect.gen(function* () {
      const candidate = {
        ...value,
        status: { state: "stopped", reason },
      } as const;

      yield* commit(candidate);
      update(candidate);
      counts.removals += 1;
      counts.callbacks = 0;
    });

  const get = Effect.gen(function* () {
    if (needsHydration && persisted !== null) {
      const candidate: TrackingSession = {
        ...session,
        ...persisted,
        latest: null,
        status:
          persisted.terminalState ??
          (granted
            ? { state: "interrupted", reason: "termination" }
            : { state: "stopped", reason: "permissionRevoked" }),
        permission: granted
          ? session.permission
          : { state: "denied", precision: "unknown" },
      };

      if (persisted.terminalState === null) {
        yield* commit(candidate);
      }

      update(candidate);
      needsHydration = false;
    }

    return value;
  });

  return {
    counts,
    published,
    read: () => value,
    metadata: () => persisted,
    failCommit: (fail: boolean) => {
      failCommit = fail;
    },
    start: Effect.gen(function* () {
      counts.registrations += 1;
      counts.callbacks += 1;
      const result = yield* commit(value).pipe(Effect.result);

      if (result._tag === "Failure") {
        counts.removals += 1;
        counts.callbacks = 0;

        return yield* new Unavailable({ reason: "Metadata commit failed" });
      }

      update({});

      return true;
    }),
    stop: stop("user"),
    reload: () => value,
    get,
    loseProcess: () => {
      counts.callbacks = 0;
      needsHydration = true;
    },
    freshProcess: () =>
      Effect.gen(function* () {
        counts.callbacks = 0;
        needsHydration = true;

        return yield* get;
      }),
    permission: (allowed: boolean, running = true) =>
      Effect.gen(function* () {
        granted = allowed;

        if (
          !allowed &&
          running &&
          ["running", "suspended"].includes(value.status.state)
        ) {
          yield* stop("permissionRevoked");
          update({ permission: { state: "denied", precision: "unknown" } });
        }
      }),
    services: (enabled: boolean) => {
      if (["running", "suspended"].includes(value.status.state)) {
        update({
          status: enabled
            ? { state: "running" }
            : { state: "suspended", reason: "servicesOff" },
        });
      }
    },
    timeout: Effect.sleep("60 seconds").pipe(
      Effect.andThen(
        Effect.sync(() => {
          update({ lastError: new LocationTimeout({}) });
        })
      )
    ),
    fix: () => {
      update({
        lastError: null,
        latest: {
          latitude: 1,
          longitude: 2,
          accuracy: 3,
          timestamp: 4,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
      });
    },
  };
};

it.effect(
  "lifecycle model commits before publishing and retains acquisition on failed stop",
  () =>
    Effect.gen(function* () {
      const model = interruptionModel();
      model.failCommit(true);
      assert.strictEqual(
        (yield* model.start.pipe(Effect.flip))._tag,
        "Unavailable"
      );
      assert.strictEqual(model.metadata(), null);
      assert.deepStrictEqual(model.published, []);
      assert.strictEqual(model.counts.callbacks, 0);
      model.failCommit(false);
      yield* model.start;
      const metadata = model.metadata();
      model.failCommit(true);
      assert.strictEqual(
        (yield* model.stop.pipe(Effect.flip))._tag,
        "Unavailable"
      );
      assert.deepStrictEqual(model.metadata(), metadata);
      assert.strictEqual(model.read().status.state, "running");
      assert.strictEqual(model.counts.callbacks, 1);
      model.failCommit(false);
      yield* model.stop;
      assert.strictEqual(model.metadata()?.terminalState?.state, "stopped");
      assert.strictEqual(model.counts.callbacks, 0);
    })
);

it.effect(
  "lifecycle model preserves owner and latest through WebView reload",
  () =>
    Effect.gen(function* () {
      const model = interruptionModel();
      yield* model.start;
      model.fix();
      const before = model.read();
      assert.isNotNull(before.latest);
      assert.strictEqual(model.reload(), before);
      assert.deepStrictEqual(model.counts, {
        registrations: 1,
        removals: 0,
        callbacks: 1,
      });
    })
);

it.effect(
  "lifecycle model detects revocation during hydration without registering",
  () =>
    Effect.gen(function* () {
      const model = interruptionModel();
      yield* model.start;
      model.fix();
      yield* model.permission(false, false);
      yield* model.freshProcess();
      assert.deepStrictEqual(model.read().status, {
        state: "stopped",
        reason: "permissionRevoked",
      });
      assert.strictEqual(model.read().latest, null);
      assert.deepStrictEqual(
        model.metadata()?.terminalState,
        model.read().status
      );
      assert.deepStrictEqual(model.counts, {
        registrations: 1,
        removals: 0,
        callbacks: 0,
      });
    })
);

it.effect(
  "lifecycle model reports termination on a fresh process without restarting",
  () =>
    Effect.gen(function* () {
      const model = interruptionModel();

      yield* model.start;
      model.fix();
      assert.isNotNull(model.read().latest);
      yield* model.freshProcess();
      assert.deepStrictEqual(model.counts, {
        registrations: 1,
        removals: 0,
        callbacks: 0,
      });

      const value = yield* getTrackingSession.pipe(
        Effect.provide(fixture(model.read()).layer)
      );

      assert.deepStrictEqual(value?.status, {
        state: "interrupted",
        reason: "termination",
      });
      assert.strictEqual(value?.latest, null);
      assert.strictEqual(value?.id, session.id);
      assert.deepStrictEqual(value?.options, session.options);
    })
);

it.effect("lifecycle model hydrates finished metadata without committing", () =>
  Effect.gen(function* () {
    const model = interruptionModel();
    yield* model.start;
    yield* model.stop;
    const metadata = model.metadata();
    model.failCommit(true);
    yield* model.freshProcess();
    assert.deepStrictEqual(model.read().status, {
      state: "stopped",
      reason: "user",
    });
    assert.strictEqual(model.read().latest, null);
    assert.deepStrictEqual(model.metadata(), metadata);
    assert.deepStrictEqual(model.counts, {
      registrations: 1,
      removals: 1,
      callbacks: 0,
    });
  })
);

it.effect(
  "lifecycle model ends on revocation and does not restart after a grant",
  () =>
    Effect.gen(function* () {
      const model = interruptionModel();
      yield* model.start;
      yield* model.permission(false);
      yield* model.permission(true);
      model.services(true);

      assert.deepStrictEqual(model.read().status, {
        state: "stopped",
        reason: "permissionRevoked",
      });
      assert.deepStrictEqual(model.counts, {
        registrations: 1,
        removals: 1,
        callbacks: 0,
      });
    })
);

it.effect(
  "lifecycle model suspends and recovers with the same id and options",
  () =>
    Effect.gen(function* () {
      const model = interruptionModel();
      yield* model.start;

      model.services(false);

      assert.deepStrictEqual(model.read().status, {
        state: "suspended",
        reason: "servicesOff",
      });

      model.services(true);

      assert.deepStrictEqual(model.read().status, { state: "running" });
      assert.strictEqual(model.read().id, session.id);
      assert.deepStrictEqual(model.read().options, session.options);
      assert.strictEqual(model.read().revision, session.revision + 3);
    })
);

it.effect(
  "lifecycle model reports timeout and recovers without ending the session",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const model = interruptionModel();
        yield* model.start;
        const fiber = yield* model.timeout.pipe(Effect.forkScoped);

        yield* TestClock.adjust("60 seconds");
        yield* Fiber.join(fiber);

        const value = yield* getTrackingSession.pipe(
          Effect.provide(fixture(model.read()).layer)
        );

        assert.strictEqual(value?.lastError?._tag, "LocationTimeout");
        assert.strictEqual(value?.status.state, "running");

        model.fix();

        assert.strictEqual(model.read().lastError, null);
        assert.strictEqual(model.read().id, session.id);
        assert.strictEqual(model.read().status.state, "running");
      })
    )
);

it.effect("hook rehydrates after remount and reconciles on foreground", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const native = fixture();
      const mounted = yield* Deferred.make<undefined>();
      const resumed = yield* Deferred.make<undefined>();
      const remounted = yield* Deferred.make<undefined>();
      let generation = 0;

      interface Observed {
        latest: TrackingSession | null;
      }

      const observed: Observed = { latest: null };

      const Probe = () => {
        const state = useTrackingSession();
        useLayoutEffect(() => {
          observed.latest = state.value;

          if (state.value?.revision === 2) {
            Effect.runSync(Deferred.succeed(mounted, undefined));
          }

          if (state.value?.revision === 3) {
            Effect.runSync(Deferred.succeed(resumed, undefined));
          }

          if (generation === 1 && state.value?.revision === 4) {
            Effect.runSync(Deferred.succeed(remounted, undefined));
          }
        }, [state]);

        return null;
      };

      const root = createRoot(document.createElement("div"));

      const render = () => {
        flushSync(() => {
          root.render(
            createElement(
              RadicalProvider,
              { layer: native.layer },
              createElement(Probe, { key: generation })
            )
          );
        });
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          flushSync(() => {
            root.unmount();
          });
        })
      );

      render();
      yield* Deferred.await(mounted);
      yield* Effect.yieldNow;
      native.reconcile({
        ...session,
        revision: 3,
        notifications: { state: "denied" },
      });
      native.foreground();
      yield* Deferred.await(resumed);
      yield* Effect.yieldNow;
      assert.strictEqual(observed.latest?.notifications.state, "denied");
      native.reconcile({
        ...session,
        revision: 4,
        status: { state: "interrupted", reason: "termination" },
      });
      generation = 1;
      render();
      yield* Deferred.await(remounted);
      yield* Effect.yieldNow;
      assert.strictEqual(observed.latest?.status.state, "interrupted");
      assert.isFalse(native.calls.includes("startTrackingSession"));
      assert.isFalse(native.calls.includes("stopTrackingSession"));
    })
  )
);

for (const granted of [true, false]) {
  it.effect(
    `lifecycle model retries failed hydration commit with permission ${granted}`,
    () =>
      Effect.gen(function* () {
        const model = interruptionModel();
        yield* model.start;
        model.fix();
        yield* model.permission(granted, false);
        model.loseProcess();
        const before = model.read();
        const publications = model.published.length;
        const metadata = model.metadata();
        model.failCommit(true);
        const failure = yield* model.get.pipe(Effect.flip);
        assert.strictEqual(failure._tag, "Unavailable");
        assert.strictEqual(model.read(), before);
        assert.strictEqual(model.published.length, publications);
        assert.deepStrictEqual(model.metadata(), metadata);
        model.failCommit(false);
        const reconstructed = yield* model.get;
        assert.isDefined(reconstructed);

        const value = yield* getTrackingSession.pipe(
          Effect.provide(fixture(reconstructed).layer)
        );

        assert.isNotNull(value);
        assert.deepStrictEqual(
          value?.status,
          granted
            ? { state: "interrupted", reason: "termination" }
            : { state: "stopped", reason: "permissionRevoked" }
        );
        assert.strictEqual(value?.latest, null);
        assert.isAbove(value?.revision ?? 0, before.revision);
        assert.strictEqual(model.published.length, publications + 1);
        assert.deepStrictEqual(model.counts, {
          registrations: 1,
          removals: 0,
          callbacks: 0,
        });
      })
  );
}
