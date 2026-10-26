import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import type { PlatformError } from "effect/PlatformError";

import { paragraphLimits } from "./limits.ts";

const root = path.resolve(import.meta.dirname, "../..");

// Oxlint 1.88 cannot parse Markdown or register processors. Transport each file
// as a JS string literal; the JS plugin owns parsing, limits, and diagnostics.
const check = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const temporary = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ directory: tmpdir(), prefix: "radical-markdown-" }),
    (directory) => fs.remove(directory, { recursive: true }).pipe(Effect.orDie)
  );

  const walk = (directory: string): Effect.Effect<string[], PlatformError> =>
    Effect.gen(function* () {
      const entries = yield* fs.readDirectory(directory);

      const groups = yield* Effect.all(
        entries.map((entry) => {
          const entryPath = path.join(directory, entry);

          return fs
            .stat(entryPath)
            .pipe(
              Effect.flatMap((stat) =>
                stat.type === "Directory"
                  ? walk(entryPath)
                  : Effect.succeed(/\.mdx?$/u.test(entry) ? [entryPath] : [])
              )
            );
        })
      );

      return groups.flat();
    });

  const requested = process.argv.slice(2);

  const files =
    requested.length > 0
      ? requested.map((file) => path.resolve(root, file))
      : yield* walk(path.join(root, "apps/docs/content"));

  for (const file of files) {
    const relative = path.relative(root, file);

    const destination = path.join(
      temporary,
      `${relative.startsWith("..") ? path.basename(file) : relative}.js`
    );

    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    const source = yield* fs.readFileString(file);
    yield* fs.writeFileString(destination, `${JSON.stringify(source)};\n`);
  }

  const configuration = path.join(temporary, "oxlint.json");
  yield* fs.writeFileString(
    configuration,
    JSON.stringify({
      jsPlugins: [
        {
          name: "radical-markdown",
          specifier: path.join(root, "tools/markdown/plugin.ts"),
        },
      ],
      categories: { correctness: "off" },
      rules: {
        "radical-markdown/long-paragraph": ["error", paragraphLimits],
      },
    })
  );

  const result = yield* Effect.sync(() =>
    spawnSync(
      path.join(root, "node_modules/.bin/oxlint"),
      ["--config", configuration, temporary],
      { encoding: "utf-8", cwd: root }
    )
  );

  yield* Effect.sync(() => {
    process.stdout.write(
      result.stdout
        .replaceAll(`${temporary}/`, "")
        .replaceAll(
          /^.*?\.mdx?\.js:1:1: error radical-markdown\(long-paragraph\): /gmu,
          ""
        )
    );
    process.stderr.write(result.stderr.replaceAll(`${temporary}/`, ""));
    process.exitCode = result.status ?? 1;
  });
}).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer));

NodeRuntime.runMain(check);
