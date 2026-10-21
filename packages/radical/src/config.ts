import { Effect, Schema } from "effect";

export const HttpOriginSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value &&
      !url.hostname.includes("*")
    );
  })
);

export const RadicalConfigSchema = Schema.Struct({
  plugins: Schema.optional(
    Schema.Array(
      Schema.Struct({
        manifest: Schema.NonEmptyString,
        selector: Schema.optional(
          Schema.String.check(Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/u))
        ),
      })
    )
  ),
  pluginOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  internalPlugins: Schema.optional(
    Schema.Struct({
      device: Schema.optional(Schema.Boolean),
      transitions: Schema.optional(Schema.Boolean),
    })
  ),
  appId: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/u)
  ),
  allowlist: Schema.optional(Schema.Array(HttpOriginSchema)),
  devHost: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9.-]+$/u))
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
