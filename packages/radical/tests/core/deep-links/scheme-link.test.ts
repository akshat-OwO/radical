import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { schemeLinkRoute } from "../../../src/core/deep-links/scheme-link.ts";

it.effect(
  "joins scheme hosts and paths without changing encoded route components",
  () =>
    Effect.sync(() => {
      for (const [link, route] of [
        ["myapp://a", "/a"],
        ["myapp://a/b?x=1", "/a/b?x=1"],
        ["myapp:///a/b?x=1", "/a/b?x=1"],
        ["myapp://", "/"],
        ["myapp:///", "/"],
        ["myapp://?x=1", "/?x=1"],
        ["myapp://a#details", "/a#details"],
        ["myapp://a%2Fb/c%20d?x=%2F#h%23", "/a%2Fb/c%20d?x=%2F#h%23"],
      ]) {
        assert.strictEqual(schemeLinkRoute(link ?? ""), route);
      }
    })
);
