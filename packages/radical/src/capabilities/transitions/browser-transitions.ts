import { Context, Effect, Layer, Option, Schema } from "effect";

import { TransitionFailed } from "./errors.ts";

export { TransitionFailed } from "./errors.ts";

export const TransitionSchema = Schema.Struct({
  kind: Schema.Literals(["slide", "fade"]),
  direction: Schema.Literals(["forward", "back"]),
});

/** Shared with the shell transition implementation. */
export type Transition = typeof TransitionSchema.Type;

export interface BrowserTransition {
  readonly finished: Effect.Effect<void, TransitionFailed>;
  readonly skip: Effect.Effect<void>;
}

/** Router owns capture and DOM updates; this boundary only controls animation. */
export class BrowserTransitions extends Context.Service<
  BrowserTransitions,
  {
    /** Router only honours transition types where typed selectors are supported. */
    readonly supportsTypes: Effect.Effect<boolean>;
    readonly active: Effect.Effect<Option.Option<BrowserTransition>>;
  }
>()("radical/BrowserTransitions") {}

export const BrowserTransitionsLive = Layer.succeed(BrowserTransitions, {
  supportsTypes: Effect.sync(() =>
    globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))")
  ),
  active: Effect.sync(() => {
    const handle =
      typeof document === "undefined"
        ? undefined
        : document.activeViewTransition;
    return handle === undefined || handle === null
      ? Option.none()
      : Option.some({
          finished: Effect.tryPromise({
            try: () => handle.finished,
            catch: (cause) => new TransitionFailed({ cause }),
          }),
          skip: Effect.sync(() => {
            handle.skipTransition();
          }),
        });
  }),
});

export const cancelBrowserTransition = Effect.gen(function* () {
  const browser = yield* BrowserTransitions;
  const active = yield* browser.active;
  if (Option.isSome(active)) {
    yield* active.value.skip;
  }
});

/** Animation completion never gates Router's DOM update or navigation promise. */
export const watchBrowserTransition = (timeoutMs: number) =>
  Effect.gen(function* () {
    const browser = yield* BrowserTransitions;
    const active = yield* browser.active;
    if (Option.isNone(active)) {
      return;
    }
    const result = yield* active.value.finished.pipe(
      Effect.as(true),
      Effect.timeoutOption(timeoutMs),
      Effect.catchTag("TransitionFailed", () =>
        Effect.succeed(Option.some(true))
      )
    );
    if (Option.isNone(result)) {
      yield* active.value.skip;
    }
  });
