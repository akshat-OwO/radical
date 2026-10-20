import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";

import { runIos } from "../src/ios.ts";

const project = "/app/.radical/ios";
const memory = (
  options: {
    stalledLaunch?: boolean;
    workspace?: boolean;
    bootError?: string;
    buildFailure?: boolean;
    devices?: unknown;
  } = {}
) => {
  const commands: string[][] = [];
  const fs = FileSystem.layerNoop({
    exists: () => Effect.succeed(options.workspace === true),
    readFileString: () =>
      Effect.succeed(JSON.stringify({ appId: "dev.radical.example" })),
  });
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag !== "StandardCommand") {
          return assert.fail("Unexpected piped command");
        }
        assert.strictEqual(command.options.cwd, project);
        const args = [command.command, ...command.args];
        commands.push(args);
        const listing = command.args.includes("list");
        const boot = command.args.includes("boot");
        const stdout = listing
          ? JSON.stringify(
              options.devices ?? {
                devices: {
                  "com.apple.CoreSimulator.SimRuntime.iOS-27-1": [
                    { name: "iPhone First", udid: "first", state: "Shutdown" },
                    { name: "iPhone Duo", udid: "booted", state: "Booted" },
                  ],
                },
              }
            )
          : "";
        const stderr = boot ? (options.bootError ?? "") : "";
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode:
            options.stalledLaunch === true && command.args.includes("launch")
              ? Effect.never
              : Effect.succeed(
                  ChildProcessSpawner.ExitCode(
                    stderr ||
                      (options.buildFailure === true &&
                        command.command === "xcodebuild")
                      ? 1
                      : 0
                  )
                ),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.succeed(new TextEncoder().encode(stdout)),
          stderr: Stream.succeed(new TextEncoder().encode(stderr)),
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

const expected = (udid: string, workspace = false) => [
  [
    "xcodebuild",
    workspace ? "-workspace" : "-project",
    `${project}/ios/App/App.${workspace ? "xcworkspace" : "xcodeproj"}`,
    "-scheme",
    "App",
    "-configuration",
    "Debug",
    "-sdk",
    "iphonesimulator",
    "-destination",
    `id=${udid}`,
    "-derivedDataPath",
    `${project}/build`,
    "build",
  ],
  ["xcrun", "simctl", "boot", udid],
  [
    "xcrun",
    "simctl",
    "install",
    udid,
    `${project}/build/Build/Products/Debug-iphonesimulator/App.app`,
  ],
  ["xcrun", "simctl", "launch", udid, "dev.radical.example"],
];

describe("headless iOS runner", () => {
  it.effect(
    "builds the SPM project and boots, installs, and launches the explicit target",
    () => {
      const state = memory();
      return Effect.gen(function* () {
        yield* runIos(project, "target");
        assert.deepStrictEqual(state.commands, expected("target"));
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "prefers a booted iPhone and accepts only the already-booted error",
    () => {
      const state = memory({
        workspace: true,
        bootError: "Unable to boot device in current state: Booted",
      });
      return Effect.gen(function* () {
        yield* runIos(project, "");
        assert.deepStrictEqual(state.commands, [
          ["xcrun", "simctl", "list", "devices", "available", "-j"],
          ...expected("booted", true),
        ]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("falls back to the first available iPhone", () => {
    const state = memory({
      devices: {
        devices: {
          "iOS-27-1": [
            { name: "iPad", udid: "ipad", state: "Booted" },
            { name: "iPhone Duo", udid: "first", state: "Shutdown" },
          ],
        },
      },
    });
    return Effect.gen(function* () {
      yield* runIos(project, "");
      assert.deepStrictEqual(state.commands.slice(1), expected("first"));
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("fails with a typed error when no iPhone is available", () => {
    const state = memory({ devices: { devices: {} } });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runIos(project, ""));
      assert.strictEqual(error._tag, "IosSimulatorUnavailable");
      assert.strictEqual(state.commands.length, 1);
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("rejects malformed simulator output before building", () => {
    const state = memory({ devices: { devices: [] } });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runIos(project, ""));
      assert.strictEqual(error._tag, "SchemaError");
      assert.strictEqual(state.commands.length, 1);
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("stops before install when boot fails for another reason", () => {
    const state = memory({ bootError: "Device unavailable" });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runIos(project, "target"));
      assert.strictEqual(error._tag, "ShellCommandError");
      assert.strictEqual(state.commands.length, 2);
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("times out a stalled simulator launch", () => {
    const state = memory({ stalledLaunch: true });
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.flip(runIos(project, "target"))
      );
      yield* TestClock.adjust("30 seconds");
      const error = yield* Fiber.join(fiber);
      assert.strictEqual(error._tag, "TimeoutError");
      assert.deepStrictEqual(state.commands, expected("target"));
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("stops before boot when the build fails", () => {
    const state = memory({ buildFailure: true });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runIos(project, "target"));
      assert.strictEqual(error._tag, "ShellCommandError");
      assert.strictEqual(state.commands.length, 1);
    }).pipe(Effect.provide(state.layer));
  });
});
