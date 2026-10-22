import { Schema } from "effect";

export { PermissionDenied } from "../../core/errors.ts";

export { Cancelled } from "../../core/errors.ts";

export { Unavailable } from "../../core/errors.ts";

export const CameraPermissionSchema = Schema.Literals([
  "granted",
  "denied",
  "prompt",
]);

export type CameraPermission = typeof CameraPermissionSchema.Type;

export const PhotoSchema = Schema.Struct({
  dataUrl: Schema.String.check(
    Schema.isPattern(/^data:image\/[a-zA-Z0-9.+-]+;base64,/u)
  ),
  mimeType: Schema.String.check(Schema.isPattern(/^image\/[a-zA-Z0-9.+-]+$/u)),
  width: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  height: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
});

export type Photo = typeof PhotoSchema.Type;

const usageDescription = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      text.trim().length > 0 &&
      text
        .split("")
        .every(
          (char) => (char.codePointAt(0) ?? 0) >= 32 || "\t\n\r".includes(char)
        )
  )
);

export const CameraConfigSchema = Schema.Struct({
  usageDescription,
  photoLibraryUsageDescription: usageDescription,
});
