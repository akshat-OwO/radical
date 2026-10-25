import { Context, Effect, Layer, Ref, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { transitionsPlugin } from "../../core/plugins/internal-plugins.ts";
import { callPlugin } from "../../core/plugins/plugins.ts";
import type { Transition } from "./browser-transitions.ts";
import { TransitionFailed, TransitionTimeout } from "./errors.ts";

/** Whether the shell should route system back to the page, and how. */
export interface BackState {
  readonly handles: boolean;
  /** iOS tracks the edge swipe only for history pops. */
  readonly pop: boolean;
  readonly index: number;
}

export interface BackRequest {
  /** The shell already animated the pop and waits for `settle`. */
  readonly interactive: boolean;
}

export class NativeTransitions extends Context.Service<
  NativeTransitions,
  {
    readonly nextId: Effect.Effect<string>;
    readonly cover: (id: string) => Effect.Effect<void, TransitionFailed>;
    readonly reveal: (
      id: string,
      transition: Transition,
      index?: number
    ) => Effect.Effect<void, TransitionFailed>;
    readonly remove: (id: string) => Effect.Effect<void, TransitionFailed>;
    readonly painted: Effect.Effect<void>;
    readonly setBack: (state: BackState) => Effect.Effect<void>;
    /** Leave the app through the platform's own back handling. */
    readonly exit: Effect.Effect<void>;
    /** Remove the interactive back overlay once the popped page painted. */
    readonly settle: Effect.Effect<void>;
    readonly onBack: (
      receive: (request: BackRequest) => void
    ) => Effect.Effect<() => void>;
  }
>()("radical/NativeTransitions") {}

const backRequest = Schema.is(Schema.Struct({ interactive: Schema.Boolean }));

const command = (
  method: "cover" | "remove" | "reveal",
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
      method: "cover" | "remove" | "reveal",
      id: string,
      options = {}
    ) =>
      command(method, id, options).pipe(Effect.provideService(Bridge, bridge));

    // Back state is advisory; a shell without these commands keeps its default.
    const notify = <M extends "setBack" | "exit" | "settle">(
      method: M,
      args: (typeof transitionsPlugin.commands)[M]["args"]["Type"]
    ) =>
      callPlugin(
        transitionsPlugin.bridge,
        method,
        transitionsPlugin.commands[method],
        args
      ).pipe(Effect.provideService(Bridge, bridge), Effect.ignore);

    return {
      nextId: nextOverlayId,
      cover: (id: string) => invoke("cover", id),
      reveal: (id: string, transition: Transition, index?: number) =>
        invoke("reveal", id, {
          ...transition,
          reducedMotion:
            globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
              .matches ?? false,
          index,
        }),
      remove: (id: string) => invoke("remove", id),
      painted: frame.pipe(Effect.andThen(frame), Effect.asVoid),
      setBack: (state: BackState) => notify("setBack", { ...state }),
      exit: notify("exit", {}),
      settle: notify("settle", {}),
      onBack: (receive: (request: BackRequest) => void) =>
        bridge.observe("radicalBack", (value) => {
          if (backRequest(value)) {
            receive(value);
          }
        }),
    };
  })
);

/** The commit callback always runs once, even when capture fails or stalls. */
export const nativeTransition = <A, E>(
  id: string,
  transition: Transition,
  commit: Effect.Effect<A, E>,
  timeoutMs = 1000,
  index?: number
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
          native.painted.pipe(
            Effect.andThen(native.reveal(id, transition, index))
          )
        ).pipe(Effect.ignore)
      ),
      Effect.ensuring(remove)
    );
  });
