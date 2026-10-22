import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type * as Vite from "vite";

// Load the same Node build API as offlineBuild, outside Vitest's module runner.
// SAFETY: The fixture supplies every field read by the invoked API.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node loads Vite with its declared types.
const { build } = createRequire(import.meta.url)("vite") as typeof Vite;

describe("offline worker bundle", () => {
  it.effect("stays below 3KB with no Effect modules or external imports", () =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(
        async () =>
          await build({
            configFile: false,
            publicDir: false,
            logLevel: "silent",
            define: {
              __RADICAL_MANIFEST__: JSON.stringify({
                buildId: "RADICAL_BUILD_CONTENT_HASH",
                cachePrefix: "radical:dev.example:/:",
                assets: [],
                fallback: "/offline.html",
              }),
            },
            build: {
              write: false,
              minify: true,
              lib: {
                entry: fileURLToPath(
                  new URL(
                    "../../src/core/offline/offline-main.ts",
                    import.meta.url
                  )
                ),
                formats: ["iife"],
                name: "RadicalOfflineWorker",
              },
            },
          })
      );

      const outputs = Array.isArray(result) ? result : [result];

      const chunks = outputs.flatMap((output) =>
        "output" in output
          ? output.output.filter((item) => item.type === "chunk")
          : []
      );

      assert.lengthOf(chunks, 1);

      for (const chunk of chunks) {
        assert.isBelow(Buffer.byteLength(chunk.code), 3000);
        assert.isEmpty(chunk.imports);
        assert.isEmpty(chunk.dynamicImports);
        assert.isFalse(
          Object.keys(chunk.modules).some((id) => /[/\\]effect[/\\]/u.test(id))
        );
      }
    })
  );
});
