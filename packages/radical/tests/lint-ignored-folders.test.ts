import { globSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import ignore from "ignore";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workspaceSchema = Schema.Struct({
  packages: Schema.Array(Schema.String),
});

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a class factory.
class DirectoryScanError extends Schema.TaggedError<DirectoryScanError>()(
  "DirectoryScanError",
  { cause: Schema.Unknown }
) {}

interface IgnoreConfig {
  readonly ignorePatterns?: readonly string[];
  readonly extends?: readonly IgnoreConfig[];
}

// Oxlint merges extended configs in order, with the local config last.
// The root config currently includes Ultracite core's patterns explicitly.
const lintPatterns = (config: IgnoreConfig): readonly string[] | undefined => {
  let patterns: readonly string[] | undefined;
  for (const base of config.extends ?? []) {
    patterns = lintPatterns(base) ?? patterns;
  }
  return config.ignorePatterns ?? patterns;
};

// Load by URL so package declaration builds do not emit root config .d.ts files.
const readConfig = (name: string) =>
  Effect.gen(function* () {
    const url = new URL(name, new URL("../../../", import.meta.url)).href;
    const module = yield* Effect.tryPromise({
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns the Promise boundary.
      try: (): Promise<unknown> => import(url),
      catch: (cause) => new DirectoryScanError({ cause }),
    });
    const configSchema: Schema.Codec<IgnoreConfig> = Schema.Struct({
      ignorePatterns: Schema.optional(Schema.Array(Schema.String)),
      extends: Schema.optional(
        Schema.Array(Schema.suspend(() => configSchema))
      ),
    });
    const config = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: configSchema })
    )(module);
    return lintPatterns(config.default) ?? [];
  });

const ignoredFolders = (
  folders: readonly string[],
  patterns: readonly string[]
) => {
  const matcher = ignore({ ignorecase: false }).add(patterns);
  return folders.flatMap((folder) => {
    // A trailing slash checks directories, including directory-only patterns.
    const result = matcher.test(`${folder}/`);
    return result.ignored ? [`${folder}: ${result.rule?.pattern}`] : [];
  });
};

const scanFolders = (workspaces: readonly string[]) =>
  Effect.try({
    try: () => {
      const folders: string[] = [];
      const visit = (directory: string) => {
        folders.push(path.relative(root, directory).split(path.sep).join("/"));
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          // Do not follow symlinks or scan installed/generated trees. Do not
          // exclude lint patterns here: those are exactly what we must catch.
          if (
            entry.isDirectory() &&
            entry.name !== "node_modules" &&
            entry.name !== ".radical"
          ) {
            visit(path.join(directory, entry.name));
          }
        }
      };
      const includes = workspaces.filter((pattern) => !pattern.startsWith("!"));
      const excludes = workspaces
        .filter((pattern) => pattern.startsWith("!"))
        .map((pattern) => pattern.slice(1));
      for (const workspace of globSync(includes, {
        cwd: root,
        exclude: [...excludes, "**/node_modules/**", "**/.radical/**"],
        withFileTypes: true,
      })) {
        if (workspace.isDirectory()) {
          for (const directory of globSync("{src,tests}", {
            cwd: path.join(workspace.parentPath, workspace.name),
            withFileTypes: true,
          })) {
            if (directory.isDirectory()) {
              visit(path.join(directory.parentPath, directory.name));
            }
          }
        }
      }
      return folders.toSorted();
    },
    catch: (cause) => new DirectoryScanError({ cause }),
  });

it.effect("reports ignored directories and their matching patterns", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      ignoredFolders(
        [
          "packages/example/src/build",
          "apps/example/tests/cache/nested",
          "tools/example/src/vite",
          "tools/example/src/dist",
          "tools/example/src/dist/nested",
        ],
        ["**/build", "**/cache/", "**/dist/**"]
      ),
      [
        "packages/example/src/build: **/build",
        "apps/example/tests/cache/nested: **/cache/",
        "tools/example/src/dist/nested: **/dist/**",
      ]
    );
  })
);

it.effect("respects ordered negation and root-relative ignore patterns", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(
      ignoredFolders(
        ["packages/example/src/cache", "apps/example/src/cache"],
        ["**/cache", "!**/cache/", "/apps/example/src/cache/"]
      ),
      ["apps/example/src/cache: /apps/example/src/cache/"]
    );
  })
);

it.effect("keeps workspace source and test folders visible to Ultracite", () =>
  Effect.gen(function* () {
    const document = yield* Effect.try({
      try: (): unknown =>
        parse(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf-8")),
      catch: (cause) => new DirectoryScanError({ cause }),
    });
    const workspace =
      yield* Schema.decodeUnknownEffect(workspaceSchema)(document);
    const folders = yield* scanFolders(workspace.packages);
    assert.isAbove(folders.length, 0);
    const violations = yield* Effect.forEach(
      ["oxlint.config.ts", "oxfmt.config.ts"],
      (name) =>
        Effect.map(readConfig(name), (patterns) =>
          ignoredFolders(folders, patterns).map(
            (violation) => `${name}: ${violation}`
          )
        )
    );
    assert.deepStrictEqual(violations.flat(), []);
  })
);
