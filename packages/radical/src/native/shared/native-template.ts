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
    (anchor instanceof RegExp ? anchor.test(source) : source.includes(anchor))
      ? Effect.succeed(
          anchor instanceof RegExp
            ? source.replace(anchor, () => replacement)
            : source.replaceAll(anchor, () => replacement)
        )
      : Effect.fail(
          new NativeTemplateMismatch({ file, anchor: String(anchor) })
        )
  );
