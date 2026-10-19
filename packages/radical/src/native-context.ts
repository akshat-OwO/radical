import { Effect, Schema } from "effect";

/**
 * Shell cookie contract, shared by the server and shell generators.
 *
 * Shells set the `radical-context` cookie natively (Android `CookieManager`,
 * iOS `WKHTTPCookieStore`) on every allowed origin before the first load. The
 * WebView then sends it with every request: navigations, fetch and XHR, form
 * posts, and service-worker requests. A WebView cannot add a request header to
 * all of those.
 *
 * The value is one URI-encoded JSON object, `encodeURIComponent(JSON.stringify(context))`:
 * {"platform":"ios","safeArea":{"top":47,"right":0,"bottom":34,"left":0},"shellVersion":"1.0.0"}
 * Shells set it with `Path=/; HttpOnly; SameSite=Lax`, plus `Secure` on HTTPS origins.
 *
 * All fields are required. Platform is `android` or `ios`; safe-area insets are
 * finite, nonnegative numbers in CSS pixels; shellVersion is a nonempty string.
 * Unknown fields are ignored for forward compatibility. A missing or invalid
 * cookie produces browser context with zero insets and a null shellVersion.
 * The cookie is untrusted presentation data, never proof of identity.
 */
export const NATIVE_CONTEXT_COOKIE = "radical-context";

const Inset = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
);

export const SafeAreaSchema = Schema.Struct({
  top: Inset,
  right: Inset,
  bottom: Inset,
  left: Inset,
});

export const ShellContextSchema = Schema.Struct({
  platform: Schema.Literals(["android", "ios"]),
  safeArea: SafeAreaSchema,
  shellVersion: Schema.NonEmptyString,
});

export type ShellContext = typeof ShellContextSchema.Type;

export const NativeContextSchema = Schema.Union([
  ShellContextSchema,
  Schema.Struct({
    platform: Schema.Literal("browser"),
    safeArea: SafeAreaSchema,
    shellVersion: Schema.Null,
  }),
]);

export type NativeContext = typeof NativeContextSchema.Type;

/** Encode shell context as the cookie value shells set. */
export const encodeNativeContextCookie = (context: ShellContext) =>
  Schema.encodeEffect(Schema.fromJsonString(ShellContextSchema))(context).pipe(
    Effect.map(encodeURIComponent)
  );
