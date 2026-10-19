import { Effect, Schema } from "effect";

export const RadicalConfigSchema = Schema.Struct({
  appId: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/u)
  ),
  appName: Schema.optional(Schema.NonEmptyString),
});

export type RadicalConfig = typeof RadicalConfigSchema.Type;

export class InvalidConfig extends Schema.TaggedError<
  InvalidConfig,
  { readonly brand: unique symbol }
>()("InvalidConfig", { message: Schema.String }) {}

export const validateConfig = (input: unknown) =>
  Schema.decodeUnknownEffect(RadicalConfigSchema)(input).pipe(
    Effect.mapError(
      (error) =>
        new InvalidConfig({
          message: `Invalid radical config: ${error.message}`,
        })
    )
  );
