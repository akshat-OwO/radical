import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";

import { runAndroid } from "../src/android.ts";

const project = "/app/.radical/android";
const memory = (
  options: {
    devices?: string;
    buildFailure?: boolean;
    stalledLaunch?: boolean;
  } = {}
) => {
  const commands: string[][] = [];
  const fs = FileSystem.layerNoop({
    readFileString: () => Effect.succeed('{"appId":"dev.radical.example"}'),
  });
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag !== "StandardCommand") {
          return assert.fail("Unexpected piped command");
        }
        const executable = path.basename(command.command);
        commands.push([executable, ...command.args]);
        assert.strictEqual(
          command.options.cwd,
          executable === "gradlew" ? `${project}/android` : project
        );
        const launch = command.args.includes("start");
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode:
            launch && options.stalledLaunch === true
              ? Effect.never
              : Effect.succeed(
                  ChildProcessSpawner.ExitCode(
                    options.buildFailure === true &&
                      command.args.includes("assembleDebug")
                      ? 1
                      : 0
                  )
                ),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.succeed(
            new TextEncoder().encode(
              options.devices ??
                "List of devices attached\nphone device\nemulator-5554 device\nunauthorized unauthorized\n"
            )
          ),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      })
    )
  );
  return { commands, layer: Layer.merge(fs, spawner) };
};
const expected = (serial: string) => [
  ["gradlew", "assembleDebug"],
  ["gradlew", "--stop"],
  [
    "adb",
    "-s",
    serial,
    "install",
    "-r",
    `${project}/android/app/build/outputs/apk/debug/app-debug.apk`,
  ],
  [
    "adb",
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    "dev.radical.example/.MainActivity",
  ],
];

describe("Android runner", () => {
  it.effect(
    "builds, stops Gradle, installs, and waits for the selected activity",
    () => {
      const state = memory();
      return Effect.gen(function* () {
        yield* runAndroid(project, "target");
        assert.deepStrictEqual(state.commands, expected("target"));
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "prefers a connected emulator and ignores unauthorized devices",
    () => {
      const state = memory();
      return Effect.gen(function* () {
        yield* runAndroid(project, "");
        assert.deepStrictEqual(state.commands, [
          ["adb", "devices"],
          ...expected("emulator-5554"),
        ]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "fails before building when no authorized device is connected",
    () => {
      const state = memory({
        devices: "List of devices attached\nphone unauthorized\n",
      });
      return Effect.gen(function* () {
        const error = yield* Effect.flip(runAndroid(project, ""));
        assert.strictEqual(error._tag, "AndroidDeviceUnavailable");
        assert.deepStrictEqual(state.commands, [["adb", "devices"]]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("stops Gradle after a failed build without installing", () => {
    const state = memory({ buildFailure: true });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runAndroid(project, "target"));
      assert.strictEqual(error._tag, "ShellCommandError");
      assert.deepStrictEqual(state.commands, expected("target").slice(0, 2));
    }).pipe(Effect.provide(state.layer));
  });
  it.effect(
    "times out a stalled launch without restarting the shared adb server",
    () => {
      const state = memory({ stalledLaunch: true });
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(runAndroid(project, "target"))
        );
        yield* TestClock.adjust("30 seconds");
        const error = yield* Fiber.join(fiber);
        assert.strictEqual(error._tag, "TimeoutError");
        assert.deepStrictEqual(state.commands, expected("target"));
      }).pipe(Effect.provide(state.layer));
    }
  );
});
