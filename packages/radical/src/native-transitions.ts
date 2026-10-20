import { Context, Effect, Layer, Schema } from "effect";

import { Bridge, callBridge } from "./bridge.ts";
import type { Transition } from "./browser-transitions.ts";
import { TransitionFailed } from "./transition-error.ts";
import { TransitionTimeout } from "./transition-timeout.ts";

const acknowledgement = Schema.Struct({ id: Schema.String });

export class NativeTransitions extends Context.Service<
  NativeTransitions,
  {
    readonly cover: (id: string) => Effect.Effect<void, TransitionFailed>;
    readonly reveal: (
      id: string,
      transition: Transition
    ) => Effect.Effect<void, TransitionFailed>;
    readonly remove: (id: string) => Effect.Effect<void, TransitionFailed>;
    readonly painted: Effect.Effect<void>;
  }
>()("radical/NativeTransitions") {}

const command = (method: string, id: string, options = {}) =>
  callBridge("RadicalTransitions", method, acknowledgement, {
    id,
    ...options,
  }).pipe(
    Effect.filterOrFail(
      (result) => result.id === id,
      () =>
        new TransitionFailed({ cause: "Mismatched overlay acknowledgement" })
    ),
    Effect.mapError((cause) => new TransitionFailed({ cause })),
    Effect.asVoid
  );

const frame = Effect.callback<number>((resume) => {
  const handle = requestAnimationFrame(() => {
    resume(Effect.succeed(0));
  });
  return Effect.sync(() => {
    cancelAnimationFrame(handle);
  });
});

export const NativeTransitionsLive = Layer.effect(
  NativeTransitions,
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const invoke = (method: string, id: string, options = {}) =>
      command(method, id, options).pipe(Effect.provideService(Bridge, bridge));
    return {
      cover: (id: string) => invoke("cover", id),
      reveal: (id: string, transition: Transition) =>
        invoke("reveal", id, {
          ...transition,
          reducedMotion:
            globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
              .matches ?? false,
        }),
      remove: (id: string) => invoke("remove", id),
      painted: frame.pipe(Effect.andThen(frame), Effect.asVoid),
    };
  })
);

/** The commit callback always runs once, even when capture fails or stalls. */
export const nativeTransition = <A, E>(
  id: string,
  transition: Transition,
  commit: Effect.Effect<A, E>,
  timeoutMs = 1000
) =>
  Effect.gen(function* () {
    const native = yield* NativeTransitions;
    const bounded = <B, F>(effect: Effect.Effect<B, F>) =>
      effect.pipe(
        Effect.timeout(timeoutMs),
        Effect.catchTag("TimeoutError", (cause) =>
          Effect.fail(new TransitionTimeout({ cause }))
        )
      );
    const remove = native
      .remove(id)
      .pipe(Effect.timeout(timeoutMs), Effect.ignore);
    const captured = yield* bounded(native.cover(id)).pipe(
      Effect.onInterrupt(() => remove),
      Effect.result
    );
    if (captured._tag === "Failure") {
      yield* remove;
      return yield* commit;
    }
    return yield* bounded(commit).pipe(
      Effect.tap(() =>
        bounded(
          native.painted.pipe(Effect.andThen(native.reveal(id, transition)))
        ).pipe(Effect.ignore)
      ),
      Effect.ensuring(remove)
    );
  });
