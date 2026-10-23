import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { localNativeContext } from "../../src/plain/client.ts";
import {
  encodeNativeContextCookie,
  NATIVE_CONTEXT_COOKIE,
  NATIVE_CONTEXT_HEADER,
  zeroSafeArea,
} from "../../src/plain/native-context.ts";
import type {
  NativeContext,
  ShellContext,
} from "../../src/plain/native-context.ts";
import { getNativeContext } from "../../src/plain/server.ts";

it.effect("encodes shell cookies and reads request context synchronously", () =>
  Effect.sync(() => {
    const context: ShellContext = {
      platform: "android",
      safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
      shellVersion: "1.0.0",
    };

    const cookie: string = encodeNativeContextCookie(context);

    assert.strictEqual(cookie, encodeURIComponent(JSON.stringify(context)));
    assert.deepStrictEqual(
      getNativeContext(
        new Request("https://example.com", {
          headers: { cookie: `${NATIVE_CONTEXT_COOKIE}=${cookie}` },
        })
      ),
      context
    );
    assert.deepStrictEqual(
      getNativeContext(
        new Request("https://example.com", {
          headers: { [NATIVE_CONTEXT_HEADER]: cookie },
        })
      ),
      context
    );
  })
);

it.effect(
  "returns browser context synchronously for malformed request facts",
  () =>
    Effect.sync(() => {
      const browser: NativeContext = {
        platform: "browser",
        safeArea: zeroSafeArea,
        shellVersion: null,
      };

      for (const value of ["%", encodeURIComponent('{"platform":"invalid"}')]) {
        assert.deepStrictEqual(
          getNativeContext(
            new Request("https://example.com", {
              headers: { [NATIVE_CONTEXT_HEADER]: value },
            })
          ),
          browser
        );
      }

      assert.deepStrictEqual(
        getNativeContext(new Request("https://example.com")),
        browser
      );
    })
);

it.effect("reads local browser context synchronously before mount", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(localNativeContext(), {
      platform: "browser",
      safeArea: zeroSafeArea,
      shellVersion: null,
    });
  })
);
