import { Context, Effect, Layer, Option, Schema } from "effect";

export const shouldRegister = (context: {
  readonly production: boolean;
  readonly browser: boolean;
  readonly shell: boolean;
}) => context.production && context.browser && !context.shell;

export class ServiceWorkerRegistrationError extends Schema.TaggedError<
  ServiceWorkerRegistrationError,
  { readonly brand: unique symbol }
>()("ServiceWorkerRegistrationError", { cause: Schema.Unknown }) {}

export const registerOfflineEffect = (options: {
  readonly production: boolean;
  /** Serialize this flag from the server native context. */
  readonly shell: boolean;
  readonly base?: string;
}) =>
  Effect.suspend(() => {
    const browser =
      typeof window !== "undefined" && typeof navigator !== "undefined";
    if (
      !shouldRegister({
        production: options.production,
        browser,
        shell: options.shell,
      }) ||
      !("serviceWorker" in navigator)
    ) {
      return Effect.void;
    }
    const base = options.base ?? "/";
    return Effect.tryPromise({
      try: () =>
        navigator.serviceWorker.register(`${base}radical-sw.js`, {
          scope: base,
        }),
      catch: (cause) => new ServiceWorkerRegistrationError({ cause }),
    }).pipe(Effect.asVoid);
  });

/** Promise facade for app lifecycle hooks; Effect remains available separately. */
export const registerOffline = (
  options: Parameters<typeof registerOfflineEffect>[0]
) => Effect.runPromise(registerOfflineEffect(options));

import { TransitionFailed } from "./transition-error.ts";

export { TransitionFailed } from "./transition-error.ts";

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

/** The browser boundary can be replaced by an in-memory layer. */
export class BrowserTransitions extends Context.Service<
  BrowserTransitions,
  {
    readonly start: (
      transition: Transition,
      update: () => Promise<void>
    ) => Effect.Effect<Option.Option<BrowserTransition>, TransitionFailed>;
  }
>()("radical/BrowserTransitions") {}

export const BrowserTransitionsLive = Layer.succeed(BrowserTransitions, {
  start: (transition, update) =>
    Effect.try({
      try: () => {
        if (
          typeof document === "undefined" ||
          typeof document.startViewTransition !== "function"
        ) {
          return Option.none<BrowserTransition>();
        }
        const handle = document.startViewTransition({
          update,
          types: [
            `radical-${transition.kind}`,
            `radical-${transition.direction}`,
          ],
        });
        // A skipped transition can reject ready even though its update succeeds.
        Effect.runFork(
          Effect.tryPromise({
            try: () => handle.ready,
            catch: (cause) => new TransitionFailed({ cause }),
          }).pipe(Effect.ignore)
        );
        return Option.some({
          finished: Effect.tryPromise({
            try: () => handle.finished,
            catch: (cause) => new TransitionFailed({ cause }),
          }),
          skip: Effect.sync(() => {
            handle.skipTransition();
          }),
        });
      },
      catch: (cause) => new TransitionFailed({ cause }),
    }),
});

/** Always commit once, including when capture fails, times out, or is cancelled. */
export const runBrowserTransition = (
  transition: Transition,
  update: Effect.Effect<void>,
  timeoutMs = 1000
) =>
  Effect.gen(function* () {
    const browser = yield* BrowserTransitions;
    const context = yield* Effect.context();
    const commit = yield* Effect.cached(Effect.uninterruptible(update));
    const handle = yield* browser
      .start(transition, () => Effect.runPromiseWith(context)(commit))
      .pipe(
        Effect.catchTag("TransitionFailed", () =>
          Effect.succeed(Option.none<BrowserTransition>())
        )
      );
    if (Option.isNone(handle)) {
      yield* commit;
      return;
    }
    yield* handle.value.finished.pipe(
      Effect.timeoutOption(timeoutMs),
      Effect.catchTag("TransitionFailed", () => Effect.void),
      Effect.ensuring(handle.value.skip),
      Effect.ensuring(commit)
    );
  });
