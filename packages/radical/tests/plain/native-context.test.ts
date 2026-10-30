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
      windowLayout: {
        widthClass: "compact" as const,
        posture: "flat" as const,
        hinge: null,
      },
      safeArea: { top: 24, right: 0, bottom: 16, left: 0 },
      shellVersion: "1.0.0",
      appVersion: "2.3.4",
      appBuild: 127,
    };

    const cookie: string = encodeNativeContextCookie(context);

    const decoded: unknown = JSON.parse(decodeURIComponent(cookie));

    assert.deepStrictEqual(decoded, context);
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
        windowLayout: {
          widthClass: "compact" as const,
          posture: "flat" as const,
          hinge: null,
        },
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
      windowLayout: {
        widthClass: "compact" as const,
        posture: "flat" as const,
        hinge: null,
      },
      safeArea: zeroSafeArea,
      shellVersion: null,
    });
  })
);

it.effect(
  "keeps older shells and ignores invalid optional release fields",
  () =>
    Effect.sync(() => {
      for (const release of [
        {},
        { appVersion: "", appBuild: -1 },
        { appVersion: 123, appBuild: "5" },
      ]) {
        const context = {
          platform: "ios",
          safeArea: zeroSafeArea,
          shellVersion: "1.0.0",
          ...release,
        };

        for (const headers of [
          {
            cookie: `${NATIVE_CONTEXT_COOKIE}=${encodeURIComponent(JSON.stringify(context))}`,
          },
          {
            [NATIVE_CONTEXT_HEADER]: encodeURIComponent(
              JSON.stringify(context)
            ),
          },
        ]) {
          const decoded = getNativeContext(
            new Request("https://example.com", {
              headers: new Headers(
                Object.entries(headers).filter(
                  (entry): entry is [string, string] => entry[1] !== undefined
                )
              ),
            })
          );

          assert.strictEqual(decoded.platform, "ios");

          assert.notProperty(decoded, "appVersion");

          assert.notProperty(decoded, "appBuild");
        }
      }
    })
);
