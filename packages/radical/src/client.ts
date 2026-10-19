import { Effect, Schema } from "effect";

/** Isolated until the native-context implementation supplies shell detection. */
export const isShell = (scope: {
  readonly Capacitor?: { readonly isNativePlatform?: () => boolean };
}) => scope.Capacitor?.isNativePlatform?.() === true;

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
  readonly base?: string;
}) =>
  Effect.suspend(() => {
    const browser =
      typeof window !== "undefined" && typeof navigator !== "undefined";
    if (
      !shouldRegister({
        production: options.production,
        browser,
        shell:
          browser && isShell(window as Window & Parameters<typeof isShell>[0]),
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
