import { Context, Effect, Layer, Ref } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { transitionsPlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import type { Transition } from "./browser-transitions.ts";
import { TransitionFailed, TransitionTimeout } from "./errors.ts";

export class NativeTransitions extends Context.Service<
  NativeTransitions,
  {
    readonly nextId: Effect.Effect<string>;
    readonly cover: (id: string) => Effect.Effect<void, TransitionFailed>;
    readonly reveal: (
      id: string,
      transition: Transition
    ) => Effect.Effect<void, TransitionFailed>;
    readonly remove: (id: string) => Effect.Effect<void, TransitionFailed>;
    readonly painted: Effect.Effect<void>;
  }
>()("radical/NativeTransitions") {}

const command = (
  method: keyof typeof transitionsPlugin.commands,
  id: string,
  options = {}
) =>
  callPlugin(
    transitionsPlugin.bridge,
    method,
    transitionsPlugin.commands[method],
    {
      id,
      ...options,
    }
  ).pipe(
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

// The native plugin has one overlay slot across routers and layer rebuilds.
const overlaySequence = Ref.makeUnsafe(0n);
const nextOverlayId = Ref.updateAndGet(overlaySequence, (id) => id + 1n).pipe(
  Effect.map(String)
);

export const NativeTransitionsLive = Layer.effect(
  NativeTransitions,
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const invoke = (
      method: keyof typeof transitionsPlugin.commands,
      id: string,
      options = {}
    ) =>
      command(method, id, options).pipe(Effect.provideService(Bridge, bridge));
    return {
      nextId: nextOverlayId,
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
    return yield* commit.pipe(
      Effect.tap(() =>
        bounded(
          native.painted.pipe(Effect.andThen(native.reveal(id, transition)))
        ).pipe(Effect.ignore)
      ),
      Effect.ensuring(remove)
    );
  });
