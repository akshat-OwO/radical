import { Effect, Schema } from "effect";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { paragraphLimits } from "./limits.ts";

export interface ParagraphLimits {
  readonly maxSentences?: number;
  readonly maxWords?: number;
}

export interface LongParagraph {
  readonly line: number;
  readonly column: number;
  readonly start: number;
  readonly end: number;
  readonly words: number;
  readonly sentences: number;
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is an Effect class factory.
export class MarkdownParseError extends Schema.TaggedError<
  MarkdownParseError,
  { readonly brand: unique symbol }
>()("MarkdownParseError", { cause: Schema.Unknown }) {}

const markdown = unified().use(remarkParse).use(remarkGfm);
const mdx = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// Inline code and destinations are not prose. Keep link labels and image alt text.
export const proseText = (source: string): string =>
  source
    .replaceAll(/`+[^`]*`+/gu, "Code")
    .replaceAll(/!?\[(?<label>[^\]]*)\]\([^)]*\)/gu, "$<label>")
    .replaceAll(/https?:\/\/\S+/gu, "URL");

export const countSentences = (source: string): number =>
  [...segmenter.segment(proseText(source))].filter(({ segment }) =>
    /[\p{L}\p{N}]/u.test(segment)
  ).length;

export const findLongParagraphs = (
  source: string,
  limits: ParagraphLimits = paragraphLimits,
  isMdx = true
) =>
  Effect.try({
    try: () => {
      // Frontmatter is metadata, even when it contains blank lines or prose.
      const body = source.replace(
        /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u,
        (match) =>
          match.replaceAll(/[^\r\n]/gu, (character) =>
            " ".repeat(character.length)
          )
      );

      const tree = (isMdx ? mdx : markdown).parse(body);
      const results: LongParagraph[] = [];

      // Quotes contain prose too. Do not descend into lists or MDX components.
      type Content = (typeof tree.children)[number];

      const paragraphs = (nodes: readonly Content[]): Content[] =>
        nodes.flatMap((node) =>
          node.type === "blockquote" ? paragraphs(node.children) : [node]
        );

      for (const node of paragraphs(tree.children)) {
        if (node.type !== "paragraph" || !node.position) {
          continue;
        }

        const start = node.position.start.offset ?? 0;
        const end = node.position.end.offset ?? start;

        const indentation = source.slice(
          source.lastIndexOf("\n", start - 1) + 1,
          start
        );

        // MDX disables indented-code parsing; still exclude code indentation.
        if (indentation.startsWith("    ") || indentation.startsWith("\t")) {
          continue;
        }

        const text = source.slice(start, end);

        if (node.children.some((child) => child.type.startsWith("mdx"))) {
          continue;
        }

        const prose = proseText(text);

        const words =
          prose.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;

        const sentences = countSentences(text);

        if (
          words > (limits.maxWords ?? paragraphLimits.maxWords) ||
          sentences > (limits.maxSentences ?? paragraphLimits.maxSentences)
        ) {
          results.push({
            line: node.position.start.line,
            column: node.position.start.column,
            start,
            end,
            words,
            sentences,
          });
        }
      }

      return results;
    },
    catch: (cause) => new MarkdownParseError({ cause }),
  });
