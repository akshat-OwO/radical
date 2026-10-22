// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { browserFileInput } from "../../../src/capabilities/files/browser-file-input.ts";

it.effect(
  "applies accept and multiple, returns every selected file, and removes the input",
  () =>
    Effect.gen(function* () {
      const doc = document.implementation.createHTMLDocument();

      const fiber = yield* browserFileInput(doc, {
        accept: "application/pdf,image/*",
        multiple: true,
      }).pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      const input = doc.querySelector("input");
      assert.strictEqual(input?.accept, "application/pdf,image/*");
      assert.isTrue(input?.multiple);
      assert.isNull(input?.getAttribute("capture"));

      const files = [
        new File(["a"], "a.pdf", { type: "application/pdf" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ] satisfies readonly [File, ...File[]];

      Object.defineProperty(input, "files", { value: files });
      input?.dispatchEvent(new Event("change"));
      assert.deepStrictEqual(yield* Fiber.join(fiber), files);
      assert.isNull(doc.querySelector("input"));
    })
);

it.effect("treats an empty change as cancellation", () =>
  Effect.gen(function* () {
    const doc = document.implementation.createHTMLDocument();
    const fiber = yield* browserFileInput(doc).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    const input = doc.querySelector("input");
    assert.isFalse(input?.multiple);
    assert.strictEqual(input?.accept, "");
    Object.defineProperty(input, "files", { value: [] });
    input?.dispatchEvent(new Event("change"));
    assert.strictEqual(
      (yield* Fiber.join(fiber).pipe(Effect.flip))._tag,
      "Cancelled"
    );
    assert.isNull(doc.querySelector("input"));
  })
);
