import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { withBundledRequests } from "../../../src/adapters/tanstack-start/tanstack-start-server.ts";
import {
  bundledOrigins,
  RequestFailed,
} from "../../../src/core/bundled/bundled-request.ts";

it.effect("preserves Start's bundled CORS headers for both shells", () =>
  Effect.gen(function* () {
    let calls = 0;
    const handler = withBundledRequests(() => {
      calls += 1;
      return new Response(null, {
        status: 202,
        headers: {
          "access-control-expose-headers": "x-existing",
          "x-tss-serialized": "true",
          vary: "Accept-Encoding",
        },
      });
    });
    for (const origin of bundledOrigins) {
      const request = (method: string) =>
        new Request("https://api.example/_serverFn/id", {
          method,
          headers: {
            origin,
            "access-control-request-headers": "x-radical-context,content-type",
          },
        });
      const before = calls;
      const preflight = yield* Effect.tryPromise({
        try: async () => await handler(request("OPTIONS")),
        catch: (cause) => new RequestFailed({ cause }),
      });
      assert.strictEqual(calls, before);
      assert.strictEqual(preflight.status, 204);
      assert.deepStrictEqual(Object.fromEntries(preflight.headers), {
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "x-radical-context,content-type",
        "access-control-allow-methods":
          "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-origin": origin,
        vary: "Origin, Access-Control-Request-Headers",
      });
      const response = yield* Effect.tryPromise({
        try: async () => await handler(request("POST")),
        catch: (cause) => new RequestFailed({ cause }),
      });
      assert.strictEqual(calls, before + 1);
      assert.strictEqual(response.status, 202);
      assert.deepStrictEqual(Object.fromEntries(response.headers), {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": origin,
        "access-control-expose-headers":
          "x-existing, x-tss-serialized, x-tss-raw, x-tss-error",
        "x-tss-serialized": "true",
        vary: "Accept-Encoding, Origin",
      });
    }
  })
);
