import { Effect, Schema } from "effect";

import { findLongParagraphs } from "./paragraphs.ts";
import type { ParagraphLimits } from "./paragraphs.ts";

interface LiteralStatement {
  readonly expression: { readonly type: string; readonly value?: string };
}

interface RuleContext {
  readonly filename: string;
  readonly options: readonly ParagraphLimits[];
  readonly report: (report: {
    readonly node: LiteralStatement;
    readonly message: string;
  }) => void;
}

export const longParagraphRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Keep Markdown paragraphs short and scannable." },
    schema: [
      {
        type: "object",
        properties: {
          maxWords: { type: "integer", minimum: 1 },
          maxSentences: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context: RuleContext) {
    if (
      !context.filename.endsWith(".md.js") &&
      !context.filename.endsWith(".mdx.js")
    ) {
      return {};
    }

    return {
      ExpressionStatement(node: LiteralStatement) {
        if (
          node.expression.type !== "Literal" ||
          !Schema.is(Schema.String)(node.expression.value)
        ) {
          return;
        }

        const sourcePath = context.filename.replace(/\.js$/u, "");

        const result = Effect.runSync(
          findLongParagraphs(
            node.expression.value,
            context.options[0],
            sourcePath.endsWith(".mdx")
          ).pipe(Effect.result)
        );

        if (result._tag === "Failure") {
          context.report({
            node,
            message: `${sourcePath}: Cannot parse Markdown: ${String(result.failure.cause)}`,
          });

          return;
        }

        for (const paragraph of result.success) {
          context.report({
            node,
            message: `${sourcePath}:${paragraph.line}:${paragraph.column}: Break this paragraph into bullets or shorter sentences. (${paragraph.sentences} sentences, ${paragraph.words} words)`,
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "radical-markdown" },
  rules: { "long-paragraph": longParagraphRule },
};
