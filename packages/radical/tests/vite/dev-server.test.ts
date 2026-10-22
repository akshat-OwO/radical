import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { devServerUrl } from "../../src/vite/dev-server.ts";

describe("dev server URL", () => {
  it.effect("keeps the dev server's scheme for the shell", () =>
    Effect.sync(() => {
      assert.strictEqual(
        devServerUrl({ https: false, host: "192.168.1.2", port: 5173 }),
        "http://192.168.1.2:5173"
      );
      assert.strictEqual(
        devServerUrl({ https: true, host: "192.168.1.2", port: 5173 }),
        "https://192.168.1.2:5173"
      );
    })
  );
});
