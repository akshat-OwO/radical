import { Clock, Effect, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { PermissionDenied, Unavailable } from "../../core/errors.ts";
import { createPluginClient } from "../../core/plugins/plugins.ts";
import {
  BrowserNotifications,
  BrowserNotificationsLive,
} from "./browser-notifications.ts";
import {
  badgePlugin,
  firebaseMessagingPlugin,
  localNotificationsPlugin,
  notificationTopicsPlugin,
} from "./notification-plugins.ts";
import {
  LocalNotificationSchema,
  MissingPushConfiguration,
  TopicSchema,
} from "./notification-schema.ts";
import type { LocalNotification } from "./notification-schema.ts";

export {
  ExactAlarmPermissionSchema,
  NotificationScheduleResultSchema,
  NotificationScheduleWarningSchema,
  LocalNotificationSchema,
  NotificationPermissionSchema,
  NotificationRouteSchema,
  TopicSchema,
  MissingPushConfiguration,
} from "./notification-schema.ts";
export type {
  ExactAlarmPermission,
  NotificationScheduleResult,
  NotificationScheduleWarning,
  LocalNotification,
  NotificationPermission,
} from "./notification-schema.ts";
export {
  BrowserNotifications,
  BrowserNotificationsLive,
  browserNotificationsLayer,
} from "./browser-notifications.ts";
const local = createPluginClient(localNotificationsPlugin);
const badge = createPluginClient(badgePlugin);
const messaging = createPluginClient(firebaseMessagingPlugin);
const topics = createPluginClient(notificationTopicsPlugin);
const validate = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new Unavailable({ reason: cause.message }))
  );
const permission = (request: boolean) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      const browser = yield* BrowserNotifications;
      return yield* request ? browser.request : browser.check;
    }
    const result = yield* request
      ? local.requestPermissions({})
      : local.checkPermissions({});
    return result.display === "prompt-with-rationale"
      ? ("prompt" as const)
      : result.display;
  });
export const checkNotificationPermission = permission(false);
export const requestNotificationPermission = permission(true);
const exactAlarmPermission = (request: boolean) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) !== "android") {
      return "not-required" as const;
    }
    const result = yield* request
      ? local.changeExactNotificationSetting({})
      : local.checkExactNotificationSetting({});
    return result.exact_alarm;
  });
export const checkExactAlarmPermission = exactAlarmPermission(false);
export const requestExactAlarmPermission = exactAlarmPermission(true);
const requireNotificationPermission = Effect.gen(function* () {
  const current = yield* checkNotificationPermission;
  const result =
    current === "prompt" ? yield* requestNotificationPermission : current;
  if (result !== "granted") {
    return yield* new PermissionDenied({});
  }
  return yield* Effect.void;
});
export const scheduleNotification = (options: LocalNotification) =>
  Effect.gen(function* () {
    const notification = yield* validate(LocalNotificationSchema, options);
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      yield* (yield* BrowserNotifications).schedule(notification);
      return { notifications: [{ id: notification.id }] };
    }
    yield* requireNotificationPermission;
    const now = yield* Clock.currentTimeMillis;
    const at = new Date(now + notification.delaySeconds * 1000);
    if (!Number.isFinite(at.getTime())) {
      return yield* new Unavailable({
        reason: "Notification date is out of range",
      });
    }
    return yield* local.schedule({
      notifications: [
        {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          schedule: { at: at.toISOString() },
          extra: { route: notification.route },
        },
      ],
    });
  });
export const cancelNotification = (id: number) =>
  Effect.gen(function* () {
    yield* validate(LocalNotificationSchema.fields.id, id);
    const bridge = yield* Bridge;
    if ((yield* bridge.runtime) === "browser") {
      return yield* (yield* BrowserNotifications).cancel(id);
    }
    return yield* local.cancel({ notifications: [{ id }] });
  });
const requirePush = Effect.gen(function* () {
  const bridge = yield* Bridge;
  if ((yield* bridge.runtime) === "browser") {
    return yield* new Unavailable({
      reason: "Push and topics require a native Firebase shell",
    });
  }
  const { configured } = yield* topics.status({});
  if (!configured) {
    return yield* new MissingPushConfiguration({
      reason:
        "Enable internalPlugins.pushNotifications and provide notifications.android.googleServices or notifications.ios.googleServiceInfo for this shell",
    });
  }
  return yield* Effect.void;
});
export const registerPush = requirePush.pipe(
  Effect.andThen(
    Effect.gen(function* () {
      yield* requireNotificationPermission;
      return (yield* messaging.getToken({})).token;
    })
  )
);
export const subscribeToTopic = (topic: string) =>
  validate(TopicSchema, topic).pipe(
    Effect.andThen(requirePush),
    Effect.andThen(topics.subscribe({ topic })),
    Effect.asVoid
  );
export const unsubscribeFromTopic = (topic: string) =>
  validate(TopicSchema, topic).pipe(
    Effect.andThen(requirePush),
    Effect.andThen(topics.unsubscribe({ topic })),
    Effect.asVoid
  );
/** Confirmed subscriptions on this installation, not an FCM server query. */
export const getNotificationTopics = requirePush.pipe(
  Effect.andThen(topics.list({})),
  Effect.map((result) => result.topics)
);
export const isSubscribedToTopic = (topic: string) =>
  validate(TopicSchema, topic).pipe(
    Effect.andThen(getNotificationTopics),
    Effect.map((values) => values.includes(topic))
  );
export const setNotificationBadge = (count: number) =>
  Effect.gen(function* () {
    yield* validate(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), count);
    const bridge = yield* Bridge;
    if (
      (yield* bridge.runtime) === "browser" ||
      !(yield* badge.isSupported({})).isSupported
    ) {
      return yield* new Unavailable({
        reason:
          "Notification badges are unavailable on this platform or launcher",
      });
    }
    return yield* badge.set({ count });
  });
export const clearNotificationBadge = setNotificationBadge(0);
export const notificationsLive = <A, E, R>(
  effect: Effect.Effect<A, E, R | BrowserNotifications>
) => effect.pipe(Effect.provide(BrowserNotificationsLive));
export type NotificationError =
  | Effect.Error<ReturnType<typeof scheduleNotification>>
  | Effect.Error<typeof requestExactAlarmPermission>
  | Effect.Error<typeof registerPush>
  | Effect.Error<ReturnType<typeof setNotificationBadge>>;
