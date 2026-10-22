import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { readCliMetadata } from "../../src/entry/prepare-native.ts";
import { metadataMemory } from "../fixtures/native-metadata.ts";

describe("CLI metadata read", () => {
  it.effect("reads the full bundled config and URL from the app root", () => {
    const config = {
      appId: "dev.example.app",
      mode: "bundled" as const,
      origin: "https://example.com",
    };
    const metadata = { config, url: "http://localhost:5173" };
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* readCliMetadata("/app"), metadata);
    }).pipe(Effect.provide(metadataMemory(JSON.stringify(metadata)).layer));
  });
  it.effect("rejects config that the old partial CLI schema accepted", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(readCliMetadata("/app"));
      assert.strictEqual(error._tag, "InvalidConfig");
    }).pipe(
      Effect.provide(
        metadataMemory(JSON.stringify({ config: { mode: "bundled" } })).layer
      )
    )
  );
  it.effect("reports a missing metadata file", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        (yield* Effect.flip(readCliMetadata("/app")))._tag,
        "PlatformError"
      );
    }).pipe(Effect.provide(metadataMemory().layer))
  );
});
