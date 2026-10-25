import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  encodeNativeContextCookie,
  NATIVE_CONTEXT_COOKIE,
} from "../../src/core/context/native-context.ts";
import type { WindowLayout } from "../../src/core/context/native-context.ts";
import { getNativeContext } from "../../src/entry/server.ts";

/** Surround the context cookie with unrelated cookies, as a WebView sends them. */
const requestWithCookie = (value: string) =>
  new Request("https://example.test/", {
    headers: {
      cookie: `session=abc; ${NATIVE_CONTEXT_COOKIE}=${value}; theme=dark`,
    },
  });

const requestWith = (json: string) =>
  requestWithCookie(encodeURIComponent(json));

const browser = {
  platform: "browser" as const,
  windowLayout: {
    widthClass: "compact" as const,
    posture: "flat" as const,
    hinge: null,
  },
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
            windowLayout: {
              widthClass: "compact" as const,
              posture: "flat" as const,
              hinge: null,
            },
            safeArea: { top: 47.5, right: 1, bottom: 34, left: 2 },
            shellVersion: "1.0.0",
          };

          const cookie = yield* encodeNativeContextCookie(context);
          assert.deepStrictEqual(
            yield* getNativeContext(requestWithCookie(cookie)),
            context
          );
        }
      })
  );

  it.effect("returns browser context when the shell cookie is absent", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* getNativeContext(new Request("https://example.test/")),
        browser
      );
      assert.deepStrictEqual(
        yield* getNativeContext(
          new Request("https://example.test/", {
            headers: { cookie: "session=abc; radical-context-old=1" },
          })
        ),
        browser
      );
    })
  );

  it.effect("returns browser context for a malformed URI encoding", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* getNativeContext(requestWithCookie("%E0%A4%A")),
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
          windowLayout: {
            widthClass: "compact" as const,
            posture: "flat" as const,
            hinge: null,
          },
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
            windowLayout: {
              widthClass: "compact" as const,
              posture: "flat" as const,
              hinge: null,
            },
            safeArea: { ...valid.safeArea, top: -1 },
          }),
          JSON.stringify({
            ...valid,
            windowLayout: {
              widthClass: "compact" as const,
              posture: "flat" as const,
              hinge: null,
            },
            safeArea: { ...valid.safeArea, right: "0" },
          }),
          JSON.stringify({ ...valid, safeArea: { top: 0 } }),
          '{"platform":"ios","safeArea":{"top":1e400,"right":0,"bottom":0,"left":0},"shellVersion":"1"}',
        ];

        for (const json of invalid) {
          assert.deepStrictEqual(
            yield* getNativeContext(requestWith(json)),
            browser,
            json
          );
        }
      })
  );

  it.effect("ignores unknown shell fields for forward compatibility", () =>
    Effect.gen(function* () {
      const context = {
        platform: "ios" as const,
        windowLayout: {
          widthClass: "compact" as const,
          posture: "flat" as const,
          hinge: null,
        },
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

it.effect(
  "defaults absent or invalid window layout without losing shell facts",
  () =>
    Effect.gen(function* () {
      const older = {
        platform: "android" as const,
        safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
        shellVersion: "1",
      };

      const fallback: WindowLayout = {
        widthClass: "compact",
        posture: "flat",
        hinge: null,
      };

      for (const windowLayout of [
        undefined,
        null,
        {},
        { ...fallback, widthClass: "wide" },
        { ...fallback, posture: "folded" },
        { ...fallback, hinge: { x: -1, y: 0, width: 10, height: 0 } },
        { ...fallback, hinge: { x: 0, y: 0, width: "10", height: 0 } },
      ]) {
        assert.deepStrictEqual(
          yield* getNativeContext(
            requestWith(JSON.stringify({ ...older, windowLayout }))
          ),
          { ...older, windowLayout: fallback }
        );
      }
    })
);

it.effect(
  "decodes every width class and posture with fractional and zero-width hinges",
  () =>
    Effect.gen(function* () {
      for (const widthClass of ["compact", "medium", "expanded"] as const) {
        for (const posture of ["flat", "tabletop", "book"] as const) {
          const context = {
            platform: "android" as const,
            safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
            shellVersion: "1",
            windowLayout: {
              widthClass,
              posture,
              hinge: { x: 400.5, y: 0, width: 0, height: 800 },
            },
          };

          assert.deepStrictEqual(
            yield* getNativeContext(
              requestWithCookie(yield* encodeNativeContextCookie(context))
            ),
            context
          );
        }
      }
    })
);
