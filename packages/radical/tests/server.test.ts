import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  NATIVE_CONTEXT_HEADER,
  ShellContextSchema,
} from "../src/native-context.ts";
import { getNativeContext } from "../src/server.ts";

const requestWith = (header: string) =>
  new Request("https://example.test/", {
    headers: { [NATIVE_CONTEXT_HEADER]: header },
  });

const browser = {
  platform: "browser" as const,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  shellVersion: null,
};

describe("native context", () => {
  it.effect(
    "decodes both shell platforms and fractional CSS pixel insets",
    () =>
      Effect.gen(function* () {
        for (const platform of ["android", "ios"] as const) {
          const context = {
            platform,
            safeArea: { top: 47.5, right: 1, bottom: 34, left: 2 },
            shellVersion: "1.0.0",
          };
          const header = yield* Schema.encodeEffect(
            Schema.fromJsonString(ShellContextSchema)
          )(context);
          assert.deepStrictEqual(
            yield* getNativeContext(requestWith(header)),
            context
          );
        }
      })
  );

  it.effect("returns browser context when the shell header is absent", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* getNativeContext(new Request("https://example.test/")),
        browser
      );
    })
  );

  it.effect(
    "returns browser context for malformed JSON and invalid shell fields",
    () =>
      Effect.gen(function* () {
        const valid = {
          platform: "ios" as const,
          safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
          shellVersion: "1.0.0",
        };
        const invalid = [
          "",
          "{",
          "null",
          "[]",
          "{}",
          JSON.stringify({ ...valid, platform: "browser" }),
          JSON.stringify({ ...valid, shellVersion: "" }),
          JSON.stringify({ ...valid, shellVersion: 1 }),
          JSON.stringify({ ...valid, shellVersion: undefined }),
          JSON.stringify({
            ...valid,
            safeArea: { ...valid.safeArea, top: -1 },
          }),
          JSON.stringify({
            ...valid,
            safeArea: { ...valid.safeArea, right: "0" },
          }),
          JSON.stringify({ ...valid, safeArea: { top: 0 } }),
          '{"platform":"ios","safeArea":{"top":1e400,"right":0,"bottom":0,"left":0},"shellVersion":"1"}',
        ];
        for (const header of invalid) {
          assert.deepStrictEqual(
            yield* getNativeContext(requestWith(header)),
            browser,
            header
          );
        }
      })
  );

  it.effect("ignores unknown shell fields for forward compatibility", () =>
    Effect.gen(function* () {
      const context = {
        platform: "ios" as const,
        safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
        shellVersion: "1",
      };
      assert.deepStrictEqual(
        yield* getNativeContext(
          requestWith(JSON.stringify({ ...context, future: true }))
        ),
        context
      );
    })
  );
});
