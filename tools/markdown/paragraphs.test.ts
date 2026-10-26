import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { findLongParagraphs } from "./paragraphs.ts";
import { longParagraphRule } from "./plugin.ts";

it.effect("reports four sentences at the original line after frontmatter", () =>
  Effect.gen(function* () {
    const result = yield* findLongParagraphs(
      "---\ntitle: Test\n\nsummary: Metadata. Has. Many. Sentences.\n---\n\nOne sentence. Another sentence. Third sentence. Fourth sentence."
    );

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.line, 7);
    assert.strictEqual(result[0]?.sentences, 4);
  })
);

it.effect("reports word limits independently of sentence limits", () =>
  Effect.gen(function* () {
    const result = yield* findLongParagraphs(
      Array.from({ length: 61 }, () => "word").join(" ")
    );

    assert.strictEqual(result[0]?.words, 61);
    assert.strictEqual(result[0]?.sentences, 1);
  })
);

it.effect("accepts exactly three sentences and sixty words", () =>
  Effect.gen(function* () {
    const sentence = `${Array.from({ length: 20 }, () => "Word").join(" ")}.`;
    assert.deepStrictEqual(
      yield* findLongParagraphs([sentence, sentence, sentence].join(" ")),
      []
    );
  })
);

it.effect("accepts wrapped short paragraphs", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(
      yield* findLongParagraphs(
        "One sentence spans\nseveral lines.\n\nAnother paragraph."
      ),
      []
    );
  })
);

it.effect("preserves offsets after Unicode frontmatter", () =>
  Effect.gen(function* () {
    const source = '---\ntitle: "\u{1F30D}"\n---\n\nOne. Two. Three. Four.';
    const result = yield* findLongParagraphs(source);

    assert.strictEqual(result[0]?.start, source.indexOf("One."));
    assert.strictEqual(result[0]?.sentences, 4);
  })
);

it.effect("ignores fences, indented code, headings, tables, and lists", () =>
  Effect.gen(function* () {
    const long = "One. Two. Three. Four.";

    const source = [
      `# ${long}`,
      "",
      "```md",
      long,
      "```",
      "",
      "~~~md",
      long,
      "~~~",
      "",
      `    ${long}`,
      "",
      `- ${long}`,
      "  Continued. Still a list.",
      "",
      `1. ${long}`,
      "",
      "| Column |",
      "| --- |",
      `| ${long} |`,
    ].join("\n");

    assert.deepStrictEqual(yield* findLongParagraphs(source), []);
  })
);

it.effect("ignores MDX component bodies, attributes, and expressions", () =>
  Effect.gen(function* () {
    const source =
      '<Callout title="One. Two. Three. Four.">\n\nOne. Two. Three. Four.\n\n</Callout>\n\n<Component value={{ code: "One. Two. Three. Four." }} />\n\n{"One. Two. Three. Four."}';

    assert.deepStrictEqual(yield* findLongParagraphs(source), []);
  })
);

it.effect(
  "does not count inline API names, URLs, or decimal points as sentences",
  () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* findLongParagraphs(
          "Use `app.call().read()` with version 1.2.3. See [the guide](https://example.com/a.b.c). The value is 1.5."
        ),
        []
      );
    })
);

it.effect("honors configurable limits", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      (yield* findLongParagraphs("One. Two.", { maxSentences: 1 })).length,
      1
    );
    assert.strictEqual(
      (yield* findLongParagraphs("One two three.", { maxWords: 2 })).length,
      1
    );
    assert.deepStrictEqual(
      yield* findLongParagraphs("One. Two. Three. Four.", { maxSentences: 4 }),
      []
    );
  })
);

it.effect("counts sentences that begin with inline code", () =>
  Effect.gen(function* () {
    const result = yield* findLongParagraphs(
      "`first()` returns a handle. `second()` reads it. `third()` updates it. `last()` closes it."
    );

    assert.strictEqual(result[0]?.sentences, 4);
  })
);

it.effect("checks prose in blockquotes without checking quoted lists", () =>
  Effect.gen(function* () {
    const result = yield* findLongParagraphs(
      "> > One. Two. Three. Four.\n\n> - One. Two. Three. Four."
    );

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.line, 1);
    assert.strictEqual(result[0]?.column, 5);
  })
);

it.effect("parses plain Markdown without treating braces as MDX", () =>
  Effect.gen(function* () {
    const result = yield* findLongParagraphs(
      "Use {value}. Then read it. Check it. Finish.",
      undefined,
      false
    );

    assert.strictEqual(result[0]?.sentences, 4);
  })
);

it.effect("returns a typed parse failure for malformed MDX", () =>
  Effect.gen(function* () {
    const result = yield* findLongParagraphs("<Callout>").pipe(Effect.result);
    assert.strictEqual(result._tag, "Failure");

    if (result._tag === "Failure") {
      assert.strictEqual(result.failure._tag, "MarkdownParseError");
    }
  })
);

it.effect(
  "oxlint rule reports the original Markdown location and author guidance",
  () =>
    Effect.sync(() => {
      const messages: string[] = [];

      const visitor = longParagraphRule.create({
        filename: "docs/test.mdx.js",
        options: [{ maxSentences: 1 }],
        report: ({ message }) => {
          messages.push(message);
        },
      });

      visitor.ExpressionStatement?.({
        expression: { type: "Literal", value: "# Title\n\nOne. Two." },
      });
      assert.strictEqual(messages.length, 1);
      assert.include(
        messages[0] ?? "",
        "docs/test.mdx:3:1: Break this paragraph into bullets or shorter sentences."
      );
    })
);
