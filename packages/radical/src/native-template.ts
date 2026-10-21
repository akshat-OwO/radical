import { Effect, Schema } from "effect";

export class NativeTemplateMismatch extends Schema.TaggedError<
  NativeTemplateMismatch,
  { readonly brand: unique symbol }
>()("NativeTemplateMismatch", { file: Schema.String, anchor: Schema.String }) {
  override get message() {
    return `Missing template anchor in ${this.file}: ${this.anchor}`;
  }
}

/** Function replacements keep user text literal; a string would expand `$&`, `$'`, `` $` `` and `$$`. */
export const replaceAnchor = (
  file: string,
  source: string,
  anchor: string | RegExp,
  replacement: string
) =>
  Effect.suspend(() =>
    (typeof anchor === "string" ? source.includes(anchor) : anchor.test(source))
      ? Effect.succeed(
          typeof anchor === "string"
            ? source.replaceAll(anchor, () => replacement)
            : source.replace(anchor, () => replacement)
        )
      : Effect.fail(
          new NativeTemplateMismatch({ file, anchor: String(anchor) })
        )
  );
