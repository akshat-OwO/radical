// @vitest-environment happy-dom
import { assert, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { browserCapture } from "../../../src/capabilities/camera/browser-camera.ts";

it.effect(
  "creates a capture input and removes it on cancellation and interruption",
  () =>
    Effect.gen(function* () {
      for (const cancel of [true, false]) {
        const doc = document.implementation.createHTMLDocument();
        const fiber = yield* browserCapture(doc).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const input = doc.querySelector("input");
        assert.isNotNull(input);
        assert.strictEqual(input?.type, "file");
        assert.strictEqual(input?.accept, "image/*");
        assert.strictEqual(input?.getAttribute("capture"), "environment");
        if (cancel) {
          input?.dispatchEvent(new Event("cancel"));
          assert.strictEqual(
            (yield* Fiber.join(fiber).pipe(Effect.flip))._tag,
            "Cancelled"
          );
        } else {
          yield* Fiber.interrupt(fiber);
        }
        assert.isNull(doc.querySelector("input"));
      }
    })
);

it.effect(
  "returns the selected image and removes the input after success",
  () =>
    Effect.gen(function* () {
      const doc = document.implementation.createHTMLDocument();
      const fiber = yield* browserCapture(doc).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const input = doc.querySelector("input");
      const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
      Object.defineProperty(input, "files", { value: [file] });
      input?.dispatchEvent(new Event("change"));
      assert.strictEqual(yield* Fiber.join(fiber), file);
      assert.isNull(doc.querySelector("input"));
    })
);
