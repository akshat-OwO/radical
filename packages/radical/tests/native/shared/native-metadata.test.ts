import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError } from "effect";

import {
  NativeMetadata,
  nativeMetadataLayer,
} from "../../../src/native/shared/native-metadata.ts";
import {
  metadataFile,
  metadataMemory,
} from "../../fixtures/native-metadata.ts";

const config = { appId: "dev.example.app" };
const url = "http://localhost:5173";

describe("native metadata", () => {
  it.effect(
    "persists adapter outputs across dev URL and config updates",
    () => {
      const memory = metadataMemory();

      return Effect.gen(function* () {
        const metadata = yield* NativeMetadata;
        const outputs = { clientDir: "web/public", spaShell: "entry.html" };
        yield* metadata.update("/app", config, url, outputs);
        yield* metadata.update(
          "/app",
          { ...config, name: "Renamed" },
          "http://localhost:4000"
        );
        assert.deepStrictEqual((yield* metadata.read("/app")).outputs, outputs);
        const next = { clientDir: "build/browser" };
        yield* metadata.update("/app", config, url, next);
        assert.deepStrictEqual((yield* metadata.read("/app")).outputs, next);
      }).pipe(
        Effect.provide(nativeMetadataLayer.pipe(Layer.provide(memory.layer)))
      );
    }
  );
  it.effect("keeps the dev URL while replacing config", () => {
    const memory = metadataMemory(JSON.stringify({ config, url }));

    return Effect.gen(function* () {
      const metadata = yield* NativeMetadata;
      const next = { ...config, name: "Renamed" };
      yield* metadata.update("/app", next);
      assert.strictEqual(
        memory.files.get(metadataFile),
        JSON.stringify({ config: next, url })
      );
      assert.deepStrictEqual(yield* metadata.read("/app"), {
        config: next,
        url,
      });
    }).pipe(
      Effect.provide(nativeMetadataLayer.pipe(Layer.provide(memory.layer)))
    );
  });
  it.effect(
    "prefers a listening URL over origin, then origin over the saved URL",
    () => {
      const memory = metadataMemory();

      return Effect.gen(function* () {
        const metadata = yield* NativeMetadata;
        const next = { ...config, origin: "https://example.com" };
        yield* metadata.update("/app", next, url);
        assert.strictEqual((yield* metadata.read("/app")).url, url);
        yield* metadata.update("/app", next);
        assert.strictEqual((yield* metadata.read("/app")).url, next.origin);
        assert.deepStrictEqual(memory.directories, [
          "/app/.radical",
          "/app/.radical",
        ]);
      }).pipe(
        Effect.provide(nativeMetadataLayer.pipe(Layer.provide(memory.layer)))
      );
    }
  );

  for (const [name, source] of [
    ["missing", undefined],
    ["malformed", "{"],
    ["invalid", JSON.stringify({ config: {}, url })],
  ] as const) {
    it.effect(`replaces ${name} metadata when a URL is available`, () => {
      const memory = metadataMemory(source);

      return Effect.gen(function* () {
        const metadata = yield* NativeMetadata;
        yield* metadata.update("/app", config, url);
        assert.deepStrictEqual(yield* metadata.read("/app"), { config, url });
      }).pipe(
        Effect.provide(nativeMetadataLayer.pipe(Layer.provide(memory.layer)))
      );
    });
  }

  it.effect("leaves a missing file absent until a URL is available", () => {
    const memory = metadataMemory();

    return Effect.gen(function* () {
      const metadata = yield* NativeMetadata;
      assert.strictEqual(
        (yield* Effect.flip(metadata.read("/app")))._tag,
        "PlatformError"
      );
      yield* metadata.update("/app", config);
      assert.isFalse(memory.files.has(metadataFile));
    }).pipe(
      Effect.provide(nativeMetadataLayer.pipe(Layer.provide(memory.layer)))
    );
  });
  it.effect(
    "rejects invalid metadata on read and preserves it on a config write without a URL",
    () => {
      const memory = metadataMemory("{}");

      return Effect.gen(function* () {
        const metadata = yield* NativeMetadata;
        assert.strictEqual(
          (yield* Effect.flip(metadata.read("/app")))._tag,
          "InvalidConfig"
        );
        yield* metadata.update("/app", config);
        assert.strictEqual(memory.files.get(metadataFile), "{}");
      }).pipe(
        Effect.provide(nativeMetadataLayer.pipe(Layer.provide(memory.layer)))
      );
    }
  );
  it.effect(
    "propagates filesystem failures instead of treating them as missing metadata",
    () => {
      const failure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "readFileString",
      });

      return Effect.gen(function* () {
        const metadata = yield* NativeMetadata;
        assert.strictEqual(
          yield* Effect.flip(metadata.update("/app", config)),
          failure
        );
      }).pipe(
        Effect.provide(
          nativeMetadataLayer.pipe(
            Layer.provide(
              FileSystem.layerNoop({
                readFileString: () => Effect.fail(failure),
              })
            )
          )
        )
      );
    }
  );
});
