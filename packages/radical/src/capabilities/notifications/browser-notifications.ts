import { Context, Effect, Fiber, Layer } from "effect";

import { PermissionDenied, Unavailable } from "../../core/errors.ts";
import type {
  LocalNotification,
  NotificationPermission,
} from "./notification-schema.ts";

export class BrowserNotifications extends Context.Service<
  BrowserNotifications,
  {
    readonly check: Effect.Effect<NotificationPermission, Unavailable>;
    readonly request: Effect.Effect<NotificationPermission, Unavailable>;
    readonly schedule: (
      notification: LocalNotification
    ) => Effect.Effect<void, Unavailable | PermissionDenied>;
    readonly cancel: (id: number) => Effect.Effect<void>;
  }
>()("radical/BrowserNotifications") {}

export interface NotificationAPI {
  readonly permission: NotificationPermission;
  readonly request: () => Promise<NotificationPermission>;
  readonly show: (notification: LocalNotification) => void;
}
const unavailable = (cause: unknown) =>
  new Unavailable({ reason: String(cause) });
/** A page owns its schedules. Closing the page ends browser delivery. */
export const browserNotificationsLayer = (
  read: () => NotificationAPI | undefined
) => {
  const pending = new Map<number, Effect.Effect<void>>();
  const cancel = (id: number) =>
    Effect.suspend(() => {
      const stop = pending.get(id);
      pending.delete(id);
      return stop ?? Effect.void;
    });
  const api = Effect.suspend(() => {
    const value = read();
    return value
      ? Effect.succeed(value)
      : Effect.fail(unavailable("Notification API is unavailable"));
  });
  return Layer.succeed(BrowserNotifications, {
    check: api.pipe(Effect.map((value) => value.permission)),
    request: api.pipe(
      Effect.flatMap((value) =>
        Effect.tryPromise({ try: value.request, catch: unavailable })
      )
    ),
    cancel,
    schedule: (notification) =>
      Effect.gen(function* () {
        const value = yield* api;
        if (value.permission !== "granted") {
          return yield* new PermissionDenied({});
        }
        yield* cancel(notification.id);
        const fiber = yield* Effect.sleep(
          notification.delaySeconds * 1000
        ).pipe(
          Effect.andThen(
            Effect.try({
              try: () => {
                value.show(notification);
              },
              catch: unavailable,
            })
          ),
          Effect.ensuring(
            Effect.sync(() => {
              pending.delete(notification.id);
            })
          ),
          Effect.ignore,
          Effect.forkDetach
        );
        pending.set(
          notification.id,
          Fiber.interrupt(fiber).pipe(Effect.asVoid)
        );
        return yield* Effect.void;
      }),
  });
};
export const BrowserNotificationsLive = browserNotificationsLayer(() =>
  typeof window === "undefined" || !("Notification" in window)
    ? undefined
    : {
        permission:
          Notification.permission === "default"
            ? "prompt"
            : Notification.permission,
        request: () =>
          Effect.runPromise(
            Effect.promise(() => Notification.requestPermission()).pipe(
              Effect.map((value) =>
                value === "default" ? ("prompt" as const) : value
              )
            )
          ),
        show: (options) => {
          const notification = new Notification(options.title, {
            body: options.body,
            tag: String(options.id),
          });
          notification.addEventListener("click", () => {
            window.focus();
            if (options.route !== undefined) {
              window.dispatchEvent(
                new CustomEvent("radical-notification", {
                  detail: { route: options.route },
                })
              );
            }
            notification.close();
          });
        },
      }
);
