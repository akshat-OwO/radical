import { Schema } from "effect";

/**
 * Shell header contract, shared by the server and shell generators.
 *
 * `x-radical-context` contains one JSON object, without base64 or URI encoding:
 * {"platform":"ios","safeArea":{"top":47,"right":0,"bottom":34,"left":0},"shellVersion":"1.0.0"}
 *
 * All fields are required. Platform is `android` or `ios`; safe-area insets are
 * finite, nonnegative numbers in CSS pixels; shellVersion is a nonempty string.
 * Unknown fields are ignored for forward compatibility. Missing or invalid
 * headers produce browser context with zero insets and a null shellVersion.
 * This header is untrusted presentation data, never proof of identity.
 */
export const NATIVE_CONTEXT_HEADER = "x-radical-context";

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

export const NativeContextSchema = Schema.Union([
  ShellContextSchema,
  Schema.Struct({
    platform: Schema.Literal("browser"),
    safeArea: SafeAreaSchema,
    shellVersion: Schema.Null,
  }),
]);

export type NativeContext = typeof NativeContextSchema.Type;
