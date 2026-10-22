import vm from "node:vm";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { navigationGuardScript } from "../../../src/native/android/android.ts";

/** Run the guard in a sandboxed document and report whether it stopped loading. */
const runGuard = (origin: string, topLevel = true) => {
  const calls: string[] = [];
  const window: Record<string, unknown> = {
    stop: () => {
      calls.push("stop");
    },
  };
  window.top = topLevel ? window : {};
  vm.runInNewContext(navigationGuardScript(["https://app.example"]), {
    window,
    location: { origin },
    document: {
      documentElement: {
        replaceChildren: () => {
          calls.push("clear");
        },
      },
    },
  });
  return calls;
};

describe("Android navigation guard", () => {
  it.effect("stops a top-level document outside the allowlist", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(runGuard("https://example.com"), [
        "stop",
        "clear",
      ]);
    })
  );

  it.effect("leaves allowed documents and subframes running", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(runGuard("https://app.example"), []);
      assert.deepStrictEqual(runGuard("https://example.com", false), []);
    })
  );
});
