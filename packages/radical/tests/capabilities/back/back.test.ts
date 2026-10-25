import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { decideBack } from "../../../src/capabilities/back/back.ts";
import type { BackSections } from "../../../src/capabilities/back/back.ts";
import { sectionOwnership } from "../../../src/capabilities/sections/sections.ts";
import type { Section } from "../../../src/capabilities/sections/sections.ts";

const section = (id: string, route: string): Section => ({
  id,
  title: id,
  route,
  icon: { ios: "circle", android: "./circle.svg" },
});

const declared = [
  section("home", "/"),
  section("inbox", "/inbox"),
  section("settings", "/settings"),
];

const sections: BackSections = {
  sections: declared,
  ownership: sectionOwnership(declared),
  root: (owner) => owner.route,
};

const pop = { _tag: "Pop" } as const;
const exit = { _tag: "Exit" } as const;
const select = (id: string) => ({ _tag: "Select", id }) as const;

const decide = (
  current: string,
  previous: string | null,
  options: { readonly hidden?: boolean; readonly withSections?: boolean } = {}
) =>
  Effect.sync(() =>
    decideBack(
      { current, previous, hidden: options.hidden ?? false },
      options.withSections === false ? null : sections
    )
  );

describe("back decisions", () => {
  it.effect("pops history inside a section", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide("/inbox/42", "/inbox"), pop);
      assert.deepStrictEqual(
        yield* decide("/inbox/42/reply", "/inbox/42"),
        pop
      );
    })
  );

  it.effect("returns to the section root when history left the section", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* decide("/inbox/42", "/settings"),
        select("inbox")
      );
      assert.deepStrictEqual(yield* decide("/inbox/42", null), select("inbox"));
    })
  );

  it.effect("goes to the start section from another section's root", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* decide("/settings", "/inbox/42"),
        select("home")
      );
      assert.deepStrictEqual(yield* decide("/settings/", null), select("home"));
    })
  );

  it.effect("exits at the start section's root", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide("/", "/settings"), exit);
      assert.deepStrictEqual(yield* decide("/", null), exit);
    })
  );

  it.effect("exits when the entry below repeats the start section's root", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide("/", "/"), exit);
      assert.deepStrictEqual(
        yield* decide("/settings", "/settings/"),
        select("home")
      );
    })
  );

  it.effect("pops a start-section page back to its root", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide("/details", "/"), pop);
      assert.deepStrictEqual(
        yield* decide("/details", "/inbox"),
        select("home")
      );
    })
  );

  it.effect(
    "pops hidden routes and selects the start section without history",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* decide("/inbox/compose", "/inbox", { hidden: true }),
          pop
        );
        assert.deepStrictEqual(
          yield* decide("/inbox/compose", "/settings", { hidden: true }),
          pop
        );
        assert.deepStrictEqual(
          yield* decide("/inbox/compose", null, { hidden: true }),
          select("home")
        );
      })
  );

  it.effect("follows router history only without sections", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* decide("/inbox/42", "/settings", { withSections: false }),
        pop
      );
      assert.deepStrictEqual(
        yield* decide("/inbox", null, { withSections: false }),
        exit
      );
    })
  );

  it.effect("treats routes outside every section as unowned", () =>
    Effect.sync(() => {
      const nested = [
        section("inbox", "/inbox"),
        section("settings", "/settings"),
      ];

      const scoped: BackSections = {
        sections: nested,
        ownership: sectionOwnership(nested),
        root: (owner) => owner.route,
      };

      assert.deepStrictEqual(
        decideBack(
          { current: "/login", previous: "/inbox", hidden: false },
          scoped
        ),
        pop
      );
      assert.deepStrictEqual(
        decideBack(
          { current: "/login", previous: null, hidden: false },
          scoped
        ),
        select("inbox")
      );
    })
  );
});
