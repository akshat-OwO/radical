import { Effect, Schema, flow } from "effect";
import { map as mapRecord } from "effect/Record";

import { NavigationSchema } from "../capabilities/sections/sections.ts";
import { internalPluginRegistry } from "../core/plugins/internal-plugin-registry.ts";

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

const javaKeywords = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _".split(
    " "
  )
);

export const AndroidPackageIdSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    const invalid = (reason: string) =>
      `Invalid android package id ${JSON.stringify(value)}: ${reason}. Set android.packageId to a valid package id.`;

    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u.test(value)) {
      return invalid(
        "use at least two dot-separated segments starting with a letter and containing only letters, digits and underscores"
      );
    }

    if (value.split(".").some((part) => javaKeywords.has(part))) {
      return invalid("segments must not be a Java keyword");
    }

    return true;
  })
);

export const IosBundleIdSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(value)
      ? undefined
      : `Invalid ios bundle id ${JSON.stringify(value)}: use at least two dot-separated segments containing only letters, digits and hyphens. Set ios.bundleId to a valid bundle id.`
  )
);

export const SplashColorSchema = Schema.String.check(
  Schema.isPattern(/^#[A-Fa-f0-9]{6}$/u)
);

/** Milliseconds a manually dismissed splash may stay up before the shell hides it. */
export const DEFAULT_SPLASH_TIMEOUT = 10_000;

export const SplashSchema = Schema.Struct({
  image: Schema.optional(Schema.NonEmptyString),
  backgroundColor: Schema.optional(SplashColorSchema),
  dismiss: Schema.optional(Schema.Literals(["auto", "manual"])),
  timeout: Schema.optional(
    Schema.Union([
      Schema.Literal(false),
      Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThan(0),
        Schema.isLessThanOrEqualTo(600_000)
      ),
    ])
  ),
}).check(
  Schema.makeFilter((splash) =>
    (splash.image === undefined) === (splash.backgroundColor === undefined)
      ? undefined
      : "splash.image and splash.backgroundColor must be set together"
  ),
  Schema.makeFilter((splash) =>
    splash.timeout === undefined || splash.dismiss === "manual"
      ? undefined
      : 'splash.timeout requires splash.dismiss: "manual"'
  )
);

export const DeepLinksSchema = Schema.Struct({
  ios: Schema.optional(
    Schema.Struct({
      teamId: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{10}$/u)),
    })
  ),
  android: Schema.optional(
    Schema.Struct({
      fingerprints: Schema.Array(
        Schema.String.check(
          Schema.isPattern(/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/u)
        )
      ).check(Schema.isMinLength(1)),
    })
  ),
  scheme: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9+.-]*$/u))
  ),
  exclude: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isPattern(/^\/[^?#]*$/u)))
  ),
});

export const RadicalConfigSchema = Schema.Struct({
  deepLinks: Schema.optional(DeepLinksSchema),
  version: Schema.optional(Schema.NonEmptyString),
  build: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
    )
  ),
  appearance: Schema.optional(Schema.Literals(["system", "light", "dark"])),
  navigation: Schema.optional(NavigationSchema),
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
    Schema.Struct(
      mapRecord(internalPluginRegistry, () => Schema.optional(Schema.Boolean))
    )
  ),
  notifications: Schema.optional(
    Schema.Struct({
      android: Schema.optional(
        Schema.Struct({
          googleServices: Schema.optional(Schema.NonEmptyString),
        })
      ),
      ios: Schema.optional(
        Schema.Struct({
          googleServiceInfo: Schema.optional(Schema.NonEmptyString),
          environment: Schema.optional(
            Schema.Literals(["development", "production"])
          ),
        })
      ),
    })
  ),
  mode: Schema.optional(Schema.Literals(["remote", "bundled"])),
  origin: Schema.optional(HttpOriginSchema),
  appId: Schema.String.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/u)
  ),
  allowlist: Schema.optional(Schema.Array(HttpOriginSchema)),
  devHost: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9.-]+$/u))
  ),
  appName: Schema.optional(Schema.NonEmptyString),
  name: Schema.optional(Schema.NonEmptyString),
  android: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.NonEmptyString),
      packageId: Schema.optional(AndroidPackageIdSchema),
    })
  ),
  ios: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.NonEmptyString),
      bundleId: Schema.optional(IosBundleIdSchema),
      appStoreId: Schema.optional(
        Schema.String.check(Schema.isPattern(/^[0-9]+$/u))
      ),
    })
  ),
  icon: Schema.optional(
    Schema.Union([
      Schema.NonEmptyString,
      Schema.Struct({
        image: Schema.NonEmptyString,
        backgroundColor: Schema.optional(SplashColorSchema),
      }),
    ])
  ),
  splash: Schema.optional(SplashSchema),
}).check(
  Schema.makeFilter((config) => {
    if (
      config.deepLinks?.ios === undefined &&
      config.deepLinks?.android === undefined
    ) {
      return true;
    }

    return (
      (config.origin !== undefined &&
        new URL(config.origin).protocol === "https:" &&
        new URL(config.origin).port === "") ||
      "Verified deep links require an https origin on the default port"
    );
  }),
  Schema.makeFilter(
    (config) =>
      config.mode !== "bundled" ||
      config.origin !== undefined ||
      "Bundled mode requires origin for server functions and data calls"
  )
);

export { nativeIdentity } from "../core/context/native-identity.ts";

export type RadicalConfig = typeof RadicalConfigSchema.Type;

export class InvalidConfig extends Schema.TaggedError<
  InvalidConfig,
  { readonly brand: unique symbol }
>()("InvalidConfig", { message: Schema.String }) {}

export const validateConfig = flow(
  Schema.decodeUnknownEffect(RadicalConfigSchema),
  Effect.mapError(
    (error) =>
      new InvalidConfig({
        message: `Invalid radical config: ${error.message}`,
      })
  )
);
