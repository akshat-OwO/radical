import { Schema } from "effect";

export const NotificationPermissionSchema = Schema.Literals([
  "granted",
  "denied",
  "prompt",
]);

export type NotificationPermission = typeof NotificationPermissionSchema.Type;

export const NotificationRouteSchema = Schema.String.check(
  Schema.makeFilter(
    (route) =>
      route.startsWith("/") &&
      !route.startsWith("//") &&
      !/[\\\s]/u.test(route) &&
      route.split("").every((char) => (char.codePointAt(0) ?? 0) >= 32)
  )
);

export const LocalNotificationSchema = Schema.Struct({
  id: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(2_147_483_647)
  ),
  title: Schema.NonEmptyString,
  body: Schema.optional(Schema.String),
  delaySeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  route: Schema.optional(NotificationRouteSchema),
});

export type LocalNotification = typeof LocalNotificationSchema.Type;

export const TopicSchema = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9_.~%-]{1,900}$/u)
);

export class MissingPushConfiguration extends Schema.TaggedError<MissingPushConfiguration>()(
  "MissingPushConfiguration",
  {
    reason: Schema.String,
  }
) {}

export const ExactAlarmPermissionSchema = Schema.Literals([
  "granted",
  "denied",
  "not-required",
]);

export type ExactAlarmPermission = typeof ExactAlarmPermissionSchema.Type;

export const NotificationScheduleWarningSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

export type NotificationScheduleWarning =
  typeof NotificationScheduleWarningSchema.Type;

export const NotificationScheduleResultSchema = Schema.Struct({
  notifications: Schema.Array(Schema.Struct({ id: Schema.Int })),
  warning: Schema.optional(NotificationScheduleWarningSchema),
});

export type NotificationScheduleResult =
  typeof NotificationScheduleResultSchema.Type;
