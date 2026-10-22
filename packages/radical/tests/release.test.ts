import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { resolveRelease, stampManifest } from "../scripts/release-model.ts";

describe("release metadata", () => {
  it.effect(
    "resolves stable versions to latest and prereleases to their own channel",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* resolveRelease("v0.1.0"), {
          version: "0.1.0",
          tag: "v0.1.0",
          dist_tag: "latest",
          is_prerelease: false,
          make_latest: true,
        });
        assert.deepStrictEqual(yield* resolveRelease("0.2.0-alpha.4"), {
          version: "0.2.0-alpha.4",
          tag: "v0.2.0-alpha.4",
          dist_tag: "alpha",
          is_prerelease: true,
          make_latest: false,
        });
      })
  );

  it.effect(
    "rejects malformed manifests and a different package identity",
    () =>
      Effect.gen(function* () {
        for (const source of [
          "{",
          JSON.stringify({ name: "another-package", version: "0.0.0" }),
          JSON.stringify({ name: "@akshatowo/radical" }),
        ]) {
          const result = yield* Effect.result(stampManifest(source, "0.1.0"));
          assert.strictEqual(result._tag, "Failure");
        }
      })
  );

  it.effect(
    "rejects malformed versions and prerelease names npm cannot use as dist-tags",
    () =>
      Effect.gen(function* () {
        for (const input of [
          "1.0",
          "01.0.0",
          "0.1.0+build",
          "0.1.0-123",
          "0.1.0-alpha.01",
          "0.1.0\nmalicious",
          "0.1.0-latest.1",
          "0.2.0-x.1",
          "0.2.0-X.1",
          "0.2.0-v1.1",
        ]) {
          const result = yield* Effect.result(resolveRelease(input));
          assert.strictEqual(result._tag, "Failure", input);
        }
      })
  );

  it.effect(
    "stamps only the version and preserves runtime dependency ranges",
    () =>
      Effect.gen(function* () {
        const source = JSON.stringify({
          name: "@akshatowo/radical",
          version: "0.0.0",
          dependencies: { effect: "^4.0.5" },
        });

        const stamped = yield* stampManifest(source, "v0.1.0");
        assert.strictEqual(
          stamped,
          `${JSON.stringify({ name: "@akshatowo/radical", version: "0.1.0", dependencies: { effect: "^4.0.5" } }, null, 2)}\n`
        );
      })
  );
});
