import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { replaceAnchor } from "../../../src/native/shared/native-template.ts";

const replacement = "a $& b $' c $` d $$ e $1";

describe(replaceAnchor, () => {
  it.effect("inserts replacement patterns literally for string anchors", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* replaceAnchor(
          "file",
          "x ANCHOR y ANCHOR",
          "ANCHOR",
          replacement
        ),
        `x ${replacement} y ${replacement}`
      );
    })
  );
  it.effect("inserts replacement patterns literally for RegExp anchors", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* replaceAnchor("file", "x </end> y", /<\/end>/u, replacement),
        `x ${replacement} y`
      );
    })
  );
});
