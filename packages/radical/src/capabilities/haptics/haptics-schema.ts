import { Schema } from "effect";

export const ImpactStyleSchema = Schema.Literals(["LIGHT", "MEDIUM", "HEAVY"]);
export type ImpactStyle = typeof ImpactStyleSchema.Type;
export const NotificationTypeSchema = Schema.Literals([
  "SUCCESS",
  "WARNING",
  "ERROR",
]);
export type NotificationType = typeof NotificationTypeSchema.Type;

export class HapticFeedbackFailed extends Schema.TaggedError<
  HapticFeedbackFailed,
  { readonly brand: unique symbol }
>()("HapticFeedbackFailed", { cause: Schema.Unknown }) {}
