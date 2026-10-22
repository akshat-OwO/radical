import { Schema } from "effect";

export const DataProtectionStatusSchema = Schema.Struct({
  enabled: Schema.Boolean,
  screenshots: Schema.Boolean,
  recording: Schema.Boolean,
  appSwitcher: Schema.Boolean,
});

export type DataProtectionStatus = typeof DataProtectionStatusSchema.Type;

export class WebDataClearFailed extends Schema.TaggedError<
  WebDataClearFailed,
  { readonly brand: unique symbol }
>()("WebDataClearFailed", { cause: Schema.Unknown }) {}
