/* oxlint-disable typescript/no-unsafe-type-assertion -- Fake Vite objects implement only the fields consumed by the build hook. */
import { createHash } from "node:crypto";

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Predicate } from "effect";
import type { InlineConfig, Plugin } from "vite";

import { OfflineBuildError } from "../../src/vite/offline-build-error.ts";
import { OfflineCompiler, offlineBuild } from "../../src/vite/offline-build.ts";
import { fakeAdapter } from "../fixtures/adapter.ts";
import { hookHandler, resolvePlugin } from "../fixtures/vite-hooks.ts";

type Hook<T> = T extends { handler: infer H } ? H : T;
type WriteHook = Hook<NonNullable<Plugin["writeBundle"]>>;
type OutputBundle = Parameters<WriteHook>[1];
type OutputAsset = Extract<OutputBundle[string], { type: "asset" }>;
type OutputChunk = Extract<OutputBundle[string], { type: "chunk" }>;
type PluginContext = ThisParameterType<WriteHook>;

const placeholder = "RADICAL_BUILD_CONTENT_HASH";
const write = (plugin: Plugin, bundle: OutputBundle, outDir = "web/public") =>
  Effect.promise(async () => {
    const hook = plugin.writeBundle;
    assert.isDefined(hook);
    const handler = hookHandler(hook);
    // SAFETY: The fixture supplies every field read by the invoked API.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The hook only reads environment.config.root and build.outDir.
    const context = {
      environment: { config: { root: "/app", build: { outDir } } },
    } as PluginContext;
    // SAFETY: The write hook reads only the environment directory and bundle fields provided by this fixture.
    await handler.call(context, {} as Parameters<WriteHook>[0], bundle);
  });
const fixture = (
  code = `worker('${placeholder}','${placeholder}')`,
  fallback = "offline",
  fail = false
) => {
  const files = new Map<string, string>();
  const compiled: InlineConfig[] = [];
  const layer = Layer.merge(
    FileSystem.layerNoop({
      readFile: (file) =>
        Effect.sync(() => {
          assert.strictEqual(file, "/app/web/public/offline.html");
          return new TextEncoder().encode(fallback);
        }),
      writeFileString: (file, value) =>
        Effect.sync(() => {
          files.set(file, value);
        }),
    }),
    Layer.succeed(OfflineCompiler, {
      compile: (config) =>
        Effect.sync(() => {
          compiled.push(config);
        }).pipe(
          Effect.andThen(
            fail
              ? Effect.fail(new OfflineBuildError({ cause: "compiler failed" }))
              : Effect.succeed(code)
          )
        ),
    })
  );
  return {
    files,
    compiled,
    plugin: offlineBuild({ appId: "dev.test.app" }, fakeAdapter, layer),
  };
};
const bundle = (
  script = "app",
  asset: string | Uint8Array<ArrayBuffer> = "css"
): OutputBundle => ({
  // SAFETY: The fixture supplies every field read by the invoked API.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Hashing reads only type, fileName and code from a chunk.
  "z.js": { type: "chunk", fileName: "z.js", code: script } as OutputChunk,
  // SAFETY: The hook reads only type, fileName and source; Rolldown's private native handle is never accessed.
  "a.css": {
    type: "asset",
    fileName: "a.css",
    source: asset,
    names: ["a.css"],
    originalFileNames: ["a.css"],
  } as OutputAsset,
});

const buildId = (files: Map<string, string>) => {
  const manifest: unknown = JSON.parse(
    files.get("/app/web/public/radical-manifest.json") ?? "null"
  );
  return Schema.decodeUnknownSync(Schema.Struct({ buildId: Schema.String }))(
    manifest
  ).buildId;
};

describe("offline build hook", () => {
  it.effect(
    "compiles an IIFE with the base-prefixed manifest and emits the content hash in both files",
    () =>
      Effect.gen(function* () {
        const fake = fixture();
        yield* resolvePlugin(fake.plugin);
        yield* write(fake.plugin, bundle());
        const hash = createHash("sha256")
          .update(`worker('${placeholder}','${placeholder}')`)
          .update("a.css")
          .update("css")
          .update("z.js")
          .update("app")
          .update("offline")
          .digest("hex");
        assert.deepStrictEqual(
          [...fake.files.keys()],
          [
            "/app/web/public/radical-manifest.json",
            "/app/web/public/radical-sw.js",
          ]
        );
        const manifest: unknown = JSON.parse(
          fake.files.get("/app/web/public/radical-manifest.json") ?? "null"
        );
        assert.deepStrictEqual(manifest, {
          buildId: hash,
          cachePrefix: "radical:dev.test.app:/app/:",
          assets: ["/app/a.css", "/app/z.js"],
          fallback: "/app/offline.html",
        });
        assert.strictEqual(
          fake.files.get("/app/web/public/radical-sw.js"),
          `worker('${hash}','${hash}')`
        );
        assert.lengthOf(fake.compiled, 1);
        const [config] = fake.compiled;
        assert.strictEqual(config.configFile, false);
        assert.strictEqual(config.publicDir, false);
        assert.strictEqual(config.build?.write, false);
        assert.strictEqual(config.build?.minify, true);
        const lib = config.build?.lib;
        assert.isDefined(lib);
        assert.notStrictEqual(lib, false);
        if (lib === false) {
          assert.fail("Missing worker library");
        }
        assert.deepStrictEqual(lib.formats, ["iife"]);
        assert.isString(lib.entry);
        if (Predicate.isString(lib.entry)) {
          assert.include(lib.entry, "offline-main.ts");
        }
        const defined: unknown = config.define?.__RADICAL_MANIFEST__;
        assert.isString(defined);
        assert.deepStrictEqual(
          Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
            defined
          ),
          {
            buildId: placeholder,
            cachePrefix: "radical:dev.test.app:/app/:",
            assets: ["/app/a.css", "/app/z.js"],
            fallback: "/app/offline.html",
          }
        );
      })
  );
  it.effect(
    "hashes deterministically regardless of bundle insertion order or asset representation",
    () =>
      Effect.gen(function* () {
        const first = fixture();
        const second = fixture();
        yield* resolvePlugin(first.plugin);
        yield* resolvePlugin(second.plugin);
        yield* write(first.plugin, bundle());
        yield* write(
          second.plugin,
          Object.fromEntries(
            Object.entries(
              bundle("app", new TextEncoder().encode("css"))
            ).toReversed()
          )
        );
        assert.deepStrictEqual([...first.files], [...second.files]);
      })
  );
  it.effect(
    "invalidates the build ID for worker, chunk, asset, filename and fallback changes",
    () =>
      Effect.gen(function* () {
        const baseline = fixture();
        yield* resolvePlugin(baseline.plugin);
        yield* write(baseline.plugin, bundle());
        for (const [fake, output] of [
          [fixture("changed worker"), bundle()],
          [fixture(), bundle("changed script")],
          [fixture(), bundle("app", "changed css")],
          [
            fixture(),
            {
              ...bundle(),
              // SAFETY: The hook reads only type, fileName and source; Rolldown's private native handle is never accessed.
              "a.css": { ...bundle()["a.css"], fileName: "renamed.css" },
            },
          ],
          [fixture(undefined, "changed fallback"), bundle()],
        ] as const) {
          yield* resolvePlugin(fake.plugin);
          yield* write(fake.plugin, output);
          assert.notStrictEqual(buildId(fake.files), buildId(baseline.files));
        }
      })
  );
  it.effect(
    "skips server output and emits nothing when compilation fails",
    () =>
      Effect.gen(function* () {
        const fake = fixture(undefined, undefined, true);
        yield* resolvePlugin(fake.plugin);
        yield* write(fake.plugin, bundle(), "server");
        assert.isEmpty(fake.compiled);
        const result = yield* Effect.exit(write(fake.plugin, bundle()));
        assert.strictEqual(result._tag, "Failure");
        assert.isEmpty([...fake.files]);
      })
  );
});
