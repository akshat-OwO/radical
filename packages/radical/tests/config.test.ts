import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { validateConfig } from "../src/config.ts";

describe("radical config", () => {
  it.effect("accepts an app id and optional app name", () =>
    Effect.gen(function* () {
      const config = { appId: "dev.radical.example", appName: "Example" };
      assert.deepStrictEqual(yield* validateConfig(config), config);
      assert.deepStrictEqual(
        yield* validateConfig({ appId: "dev.radical.app" }),
        {
          appId: "dev.radical.app",
        }
      );
    })
  );

  it.effect("rejects malformed app ids with a typed error naming appId", () =>
    Effect.gen(function* () {
      for (const appId of [
        "",
        "example",
        "dev..example",
        "dev.1app",
        "dev.my-app",
        "dev.app\n",
      ]) {
        const error = yield* Effect.flip(validateConfig({ appId }));
        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, "appId");
      }
    })
  );

  it.effect("reports a missing appId and an invalid appName by field", () =>
    Effect.gen(function* () {
      const missing = yield* Effect.flip(validateConfig({}));
      assert.include(missing.message, "appId");
      const name = yield* Effect.flip(
        validateConfig({ appId: "dev.radical.app", appName: "" })
      );
      assert.include(name.message, "appName");
    })
  );
});
