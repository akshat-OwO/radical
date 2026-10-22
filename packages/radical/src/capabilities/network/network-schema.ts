import { Schema } from "effect";

export const NetworkTypeSchema = Schema.Literals([
  "wifi",
  "cellular",
  "none",
  "unknown",
  "ethernet",
  "bluetooth",
  "wimax",
  "other",
]);
export const NetworkStatusSchema = Schema.Struct({
  connected: Schema.Boolean,
  connectionType: NetworkTypeSchema,
});
export type NetworkStatus = typeof NetworkStatusSchema.Type;
export type NetworkType = typeof NetworkTypeSchema.Type;
