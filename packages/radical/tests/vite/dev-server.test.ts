import { createServer } from "node:http";

import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, FileSystem, Layer, PlatformError } from "effect";

import {
  NativeMetadata,
  nativeMetadataLayer,
} from "../../src/native/shared/native-metadata.ts";
import { configureServer, devServerUrl } from "../../src/vite/dev-server.ts";
import { metadataFile, metadataMemory } from "../fixtures/native-metadata.ts";

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
  it.effect("canonicalizes default ports and mixed-case hosts", () =>
    Effect.sync(() => {
      assert.strictEqual(
        devServerUrl({ https: false, host: "MacBook.local", port: 80 }),
        "http://macbook.local"
      );
      assert.strictEqual(
        devServerUrl({ https: true, host: "10.0.2.2", port: 443 }),
        "https://10.0.2.2"
      );
    })
  );
});

const serverFixture = (
  address: { port: number } | string | null,
  https = false
) => {
  const events = createServer();
  const errors: string[] = [];
  const server = {
    httpServer: Object.assign(events, {
      address: () =>
        typeof address === "object" && address !== null
          ? { address: "127.0.0.1", family: "IPv4", ...address }
          : address,
    }),
    config: {
      root: "/app",
      server: { https: https ? {} : undefined },
      logger: {
        error: (message: string) => {
          errors.push(message);
        },
      },
    },
  };
  return { server, events, errors };
};

describe("dev server listening", () => {
  for (const [name, port, devHost, url] of [
    [
      "the selected port and HTTPS URL",
      5174,
      "localhost",
      "https://localhost:5174",
    ],
    ["the canonical origin", 443, "MacBook.local", "https://macbook.local"],
  ] as const) {
    it.effect(`persists ${name} once listening fires`, () =>
      Effect.gen(function* () {
        const memory = metadataMemory();
        const persisted = yield* Deferred.make<boolean>();
        const fs = yield* FileSystem.FileSystem.pipe(
          Effect.provide(memory.layer)
        );
        const layer = nativeMetadataLayer.pipe(
          Layer.provide(
            Layer.succeed(FileSystem.FileSystem, {
              ...fs,
              writeFileString: (file, source) =>
                fs
                  .writeFileString(file, source)
                  .pipe(Effect.andThen(Deferred.succeed(persisted, true))),
            })
          )
        );
        const fixture = serverFixture({ port }, true);
        const config = {
          appId: "dev.example.app",
          devHost,
          origin: "https://production.example",
        };
        const initialListeners = fixture.events.listenerCount("listening");
        configureServer(config, fixture.server, layer);
        assert.isFalse(memory.files.has(metadataFile));
        fixture.events.emit("listening");
        yield* Deferred.await(persisted);
        const metadata = yield* NativeMetadata.pipe(
          Effect.flatMap((service) => service.read("/app")),
          Effect.provide(layer)
        );
        assert.deepStrictEqual(metadata, {
          config,
          url,
        });
        assert.strictEqual(
          fixture.events.listenerCount("listening"),
          initialListeners
        );
        assert.deepStrictEqual(fixture.errors, []);
      })
    );
  }
  for (const address of [null, "/tmp/socket"]) {
    it.effect(
      `skips persistence for ${address === null ? "an absent address" : "a socket address"}`,
      () =>
        Effect.sync(() => {
          const memory = metadataMemory();
          const fixture = serverFixture(address);
          configureServer(
            { appId: "dev.example.app" },
            fixture.server,
            nativeMetadataLayer.pipe(Layer.provide(memory.layer))
          );
          fixture.events.emit("listening");
          assert.isFalse(memory.files.has(metadataFile));
        })
    );
  }
  it.effect("logs persistence failures", () =>
    Effect.gen(function* () {
      const logged = yield* Deferred.make<string>();
      const fixture = serverFixture({ port: 5173 });
      fixture.server.config.logger.error = (message) => {
        Effect.runSync(Deferred.succeed(logged, message));
      };
      const failure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "writeFileString",
      });
      const layer = nativeMetadataLayer.pipe(
        Layer.provide(
          FileSystem.layerNoop({
            readFileString: () =>
              Effect.succeed(
                JSON.stringify({
                  config: { appId: "dev.example.app" },
                  url: "http://localhost:5173",
                })
              ),
            makeDirectory: () => Effect.void,
            writeFileString: () => Effect.fail(failure),
          })
        )
      );
      configureServer(
        { appId: "dev.example.app", devHost: "localhost" },
        fixture.server,
        layer
      );
      fixture.events.emit("listening");
      assert.include(yield* Deferred.await(logged), "PermissionDenied");
    })
  );
});
