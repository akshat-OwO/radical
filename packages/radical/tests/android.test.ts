import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";

import { generateAndroid } from "../src/android.ts";
import {
  NATIVE_CONTEXT_COOKIE,
  ShellContextSchema,
} from "../src/native-context.ts";
import activity from "../templates/android/MainActivity.java?raw";
import gradle from "../templates/android/radical.gradle?raw";

const destination = "/app/.radical/android";
const mainActivity = `${destination}/android/app/src/main/java/dev/radical/example/MainActivity.java`;

/** Per-test files and command results, with no SDK, processes or real disk. */
const defaultConfig = { appId: "dev.radical.example" };
const memory = (fail = false, config: unknown = defaultConfig) => {
  const files = new Map<string, string>([
    [
      "/app/.radical/native.json",
      JSON.stringify({ config, url: "http://192.168.1.2:3000" }),
    ],
    ["/package/templates/android/MainActivity.java", activity],
    ["/package/package.json", JSON.stringify({ version: "1.2.3" })],
    ["/package/templates/android/radical.gradle", gradle],
  ]);
  const commands: string[][] = [];
  const fs = FileSystem.layerNoop({
    readFileString: (name) =>
      Effect.suspend(() => {
        const content = files.get(name);
        return content === undefined
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: name,
              })
            )
          : Effect.succeed(content);
      }),
    writeFileString: (name, content) =>
      Effect.sync(() => {
        files.set(name, content);
      }),
    makeDirectory: () => Effect.void,
    symlink: (from, to) =>
      Effect.sync(() => {
        files.set(to, from);
      }),
    remove: (name) =>
      Effect.sync(() => {
        for (const key of files.keys()) {
          if (key === name || key.startsWith(`${name}/`)) {
            files.delete(key);
          }
        }
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        for (const [key, value] of files) {
          if (key === from || key.startsWith(`${from}/`)) {
            files.set(to + key.slice(from.length), value);
            files.delete(key);
          }
        }
      }),
  });
  const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
    ...ChildProcessSpawner.make(() => Effect.die("Unexpected spawn")),
    exitCode: (command) =>
      Effect.sync(() => {
        assert.strictEqual(command._tag, "StandardCommand");
        if (command._tag === "StandardCommand") {
          commands.push([...command.args]);
          files.set(
            `${command.options.cwd}/android/app/build.gradle`,
            "// Capacitor app"
          );
          files.set(
            `${command.options.cwd}/android/generated.txt`,
            "Capacitor 8"
          );
        }
        return ChildProcessSpawner.ExitCode(fail ? 1 : 0);
      }),
  });
  return { files, commands, layer: Layer.merge(fs, spawner) };
};

const generate = generateAndroid("/app", "/package");

describe("Android shell generation", () => {
  it.effect(
    "generates a Capacitor project with the encoded shared native context",
    () => {
      const state = memory();
      return Effect.gen(function* () {
        assert.strictEqual(yield* generate, destination);
        assert.strictEqual(state.commands.length, 1);
        assert.deepStrictEqual(state.commands[0].slice(-2), ["add", "android"]);
        const source = state.files.get(mainActivity) ?? "";
        const cookie = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.String)
        )(/COOKIE = (?<cookie>.+);/u.exec(source)?.groups?.cookie);
        const [name, value] = cookie.split("=");
        assert.strictEqual(name, NATIVE_CONTEXT_COOKIE);
        const context = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(ShellContextSchema)
        )(decodeURIComponent(value ?? ""));
        assert.deepStrictEqual(context, {
          platform: "android",
          shellVersion: "1.2.3",
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        assert.include(source, "CookieManager");
        assert.include(source, "addDocumentStartJavaScript(view, GUARD");
        assert.include(
          state.files.get(`${destination}/android/app/build.gradle`) ?? "",
          "apply from: 'radical.gradle'"
        );
        assert.notInclude(source, "__APP_ID__");
        assert.notInclude(source, "__COOKIE__");
        assert.include(source, 'Arrays.asList("http://192.168.1.2:3000")');
        assert.include(
          state.files.get(`${destination}/capacitor.config.json`) ?? "",
          '"cleartext":true'
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "replaces stale files and produces identical project content on rerun",
    () => {
      const state = memory();
      return Effect.gen(function* () {
        yield* generate;
        const first = [...state.files].toSorted(([a], [b]) =>
          a.localeCompare(b)
        );
        state.files.set(`${destination}/stale.txt`, "old shell");
        state.files.set(
          `${destination}.next/abandoned.txt`,
          "interrupted generation"
        );
        yield* generate;
        assert.deepStrictEqual(
          [...state.files].toSorted(([a], [b]) => a.localeCompare(b)),
          first
        );
        assert.strictEqual(state.commands.length, 2);
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "keeps the previous project and removes staging when Capacitor fails",
    () => {
      const state = memory(true);
      state.files.set(`${destination}/previous.txt`, "usable shell");
      return Effect.gen(function* () {
        const error = yield* Effect.flip(generate);
        assert.strictEqual(error._tag, "ShellCommandError");
        assert.strictEqual(
          state.files.get(`${destination}/previous.txt`),
          "usable shell"
        );
        assert.isFalse(
          [...state.files.keys()].some((key) =>
            key.startsWith(`${destination}.next/`)
          )
        );
      }).pipe(Effect.provide(state.layer));
    }
  );

  it.effect(
    "rejects invalid configuration before generating or executing commands",
    () => {
      const state = memory(false, { appId: "../outside" });
      return Effect.gen(function* () {
        const error = yield* Effect.flip(generate);
        assert.strictEqual(error._tag, "SchemaError");
        assert.deepStrictEqual(state.commands, []);
        assert.isFalse(state.files.has(mainActivity));
      }).pipe(Effect.provide(state.layer));
    }
  );
});
