import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  ConfigProvider,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Queue,
  Sink,
  Stream,
  Terminal,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";

import { runAndroid } from "../src/android.ts";

const project = "/app/.radical/android";
const memory = (
  options: {
    config?: Record<string, string>;
    avdNames?: Record<string, string>;
    devices?: string;
    avds?: string;
    bootAfter?: number;
    stalledWait?: boolean;
    buildFailure?: boolean;
    stalledLaunch?: boolean;
  } = {}
) => {
  const commands: string[][] = [];
  const displayed: string[] = [];
  const executables: string[] = [];
  let bootChecks = 0;
  let unreferenced = false;
  const terminal = Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      display: (text) =>
        Effect.sync(() => {
          displayed.push(text);
        }),
      readLine: Effect.succeed(""),
      readInput: Effect.gen(function* () {
        const input = yield* Queue.make<Terminal.UserInput>();
        yield* Queue.offer(input, {
          input: Option.some("\r"),
          key: { name: "enter", ctrl: false, meta: false, shift: false },
        });
        return input;
      }),
    })
  );
  const fs = FileSystem.layerNoop({
    readFileString: () => Effect.succeed('{"appId":"dev.radical.example"}'),
  });
  const outputFor = (args: readonly string[]) => {
    let output = "";
    if (args.includes("devices")) {
      output =
        options.devices ??
        "List of devices attached\nphone device\nemulator-5554 device\ntarget device\nunauthorized unauthorized\n";
    } else if (args.includes("-list-avds")) {
      output = options.avds ?? "";
    } else if (args.includes("avd")) {
      output = `${options.avdNames?.[args[1]] ?? "Pixel_9"}\r\nOK\r\n`;
    } else if (args.includes("getprop")) {
      output = bootChecks >= (options.bootAfter ?? 1) ? "1\n" : "0\n";
    }
    return output;
  };
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag !== "StandardCommand") {
          return assert.fail("Unexpected piped command");
        }
        const executable = path.basename(command.command);
        commands.push([executable, ...command.args]);
        executables.push(command.command);
        assert.strictEqual(
          command.options.cwd,
          executable === "gradlew" ? `${project}/android` : project
        );
        const launch = command.args.includes("start");
        const boot = command.args.includes("getprop");
        if (boot) {
          bootChecks += 1;
        }
        if (executable === "emulator" && command.args.includes("-avd")) {
          assert.strictEqual(command.options.detached, true);
          assert.strictEqual(command.options.stdin, "ignore");
          assert.strictEqual(command.options.stdout, "ignore");
          assert.strictEqual(command.options.stderr, "ignore");
        }
        const output = outputFor(command.args);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode:
            (launch && options.stalledLaunch === true) ||
            (command.args.includes("wait-for-device") &&
              options.stalledWait === true)
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
          stdout: Stream.succeed(new TextEncoder().encode(output)),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.sync(() => {
            unreferenced = true;
            return Effect.void;
          }),
        });
      })
    )
  );
  return {
    commands,
    executables,
    displayed,
    unreferenced: () => unreferenced,
    layer: Layer.mergeAll(
      fs,
      spawner,
      terminal,
      Path.layer,
      ConfigProvider.layer(ConfigProvider.fromUnknown(options.config ?? {}))
    ),
  };
};
const bootCommands = (serial: string) => [
  ["adb", "-s", serial, "wait-for-device"],
  ["adb", "-s", serial, "shell", "getprop", "sys.boot_completed"],
];
const expected = (serial: string) => [
  ["adb", "devices"],
  ...bootCommands(serial),
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
        assert.deepStrictEqual(state.commands, expected("emulator-5554"));
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "fails before building when no authorized device or AVD is available",
    () => {
      const state = memory({
        devices: "List of devices attached\nphone unauthorized\n",
      });
      return Effect.gen(function* () {
        const error = yield* Effect.flip(runAndroid(project, ""));
        assert.strictEqual(error._tag, "AndroidDeviceUnavailable");
        assert.deepStrictEqual(state.commands, [
          ["adb", "devices"],
          ["emulator", "-list-avds"],
        ]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "resolves a running AVD name to its serial without starting another emulator",
    () => {
      const state = memory();
      return Effect.gen(function* () {
        yield* runAndroid(project, "Pixel_9");
        assert.deepStrictEqual(state.commands, [
          ["adb", "devices"],
          ["adb", "-s", "emulator-5554", "emu", "avd", "name"],
          ...expected("emulator-5554").slice(1),
        ]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("rejects an unknown AVD without starting an emulator", () => {
    const state = memory({ devices: "", avds: "Pixel_9\n" });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runAndroid(project, "Missing"));
      assert.strictEqual(error._tag, "AndroidDeviceUnavailable");
      assert.deepStrictEqual(state.commands, [
        ["adb", "devices"],
        ["emulator", "-list-avds"],
      ]);
    }).pipe(Effect.provide(state.layer));
  });
  it.effect(
    "checks each running emulator's AVD name, including an offline emulator",
    () => {
      const state = memory({
        devices: "emulator-5554 device\nemulator-5556 offline\n",
        avdNames: { "emulator-5554": "Tablet", "emulator-5556": "Pixel_9" },
      });
      return Effect.gen(function* () {
        yield* runAndroid(project, "Pixel_9");
        assert.deepStrictEqual(state.commands, [
          ["adb", "devices"],
          ["adb", "-s", "emulator-5554", "emu", "avd", "name"],
          ["adb", "-s", "emulator-5556", "emu", "avd", "name"],
          ...expected("emulator-5556").slice(1),
        ]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("reads the SDK root fallback from the provided Config", () => {
    const state = memory({ config: { ANDROID_SDK_ROOT: "/sdk" } });
    return Effect.gen(function* () {
      yield* runAndroid(project, "target");
      assert.strictEqual(state.executables[0], "/sdk/platform-tools/adb");
    }).pipe(Effect.provide(state.layer));
  });
  it.effect("prefers ANDROID_HOME over ANDROID_SDK_ROOT", () => {
    const state = memory({
      config: { ANDROID_HOME: "/primary", ANDROID_SDK_ROOT: "/fallback" },
    });
    return Effect.gen(function* () {
      yield* runAndroid(project, "target");
      assert.strictEqual(state.executables[0], "/primary/platform-tools/adb");
    }).pipe(Effect.provide(state.layer));
  });
  it.effect(
    "starts a stopped AVD detached and polls boot completion before installing",
    () => {
      const state = memory({ devices: "", avds: "Pixel_9\n", bootAfter: 3 });
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(runAndroid(project, "Pixel_9"));
        yield* TestClock.adjust("2 seconds");
        yield* Fiber.join(fiber);
        assert.isTrue(state.unreferenced());
        assert.deepStrictEqual(state.commands, [
          ["adb", "devices"],
          ["emulator", "-list-avds"],
          ["emulator", "-avd", "Pixel_9", "-port", "5554"],
          ...bootCommands("emulator-5554"),
          ...Array.from({ length: 2 }, () => bootCommands("emulator-5554")[1]),
          ...expected("emulator-5554").slice(3),
        ]);
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "does not reuse an occupied emulator port when starting a different AVD",
    () => {
      const state = memory({
        devices: "emulator-5554 offline\n",
        avdNames: { "emulator-5554": "Tablet" },
        avds: "Pixel_9\n",
      });
      return Effect.gen(function* () {
        yield* runAndroid(project, "Pixel_9");
        assert.deepStrictEqual(state.commands[3], [
          "emulator",
          "-avd",
          "Pixel_9",
          "-port",
          "5556",
        ]);
        assert.deepStrictEqual(
          state.commands.slice(4),
          expected("emulator-5556").slice(1)
        );
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("prompts for an installed AVD when no device is running", () => {
    const state = memory({ devices: "", avds: "Pixel_9\nTablet\n" });
    return Effect.gen(function* () {
      yield* runAndroid(project, "");
      assert.include(state.displayed.join(""), "Select an Android AVD");
      assert.include(state.displayed.join(""), "Tablet");
      assert.deepStrictEqual(state.commands, [
        ["adb", "devices"],
        ["emulator", "-list-avds"],
        ["emulator", "-avd", "Pixel_9", "-port", "5554"],
        ...expected("emulator-5554").slice(1),
      ]);
    }).pipe(Effect.provide(state.layer));
  });
  it.effect(
    "returns a typed boot timeout without installing when adb never connects",
    () => {
      const state = memory({
        devices: "",
        avds: "Pixel_9\n",
        stalledWait: true,
      });
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(runAndroid(project, "Pixel_9"))
        );
        yield* TestClock.adjust("120 seconds");
        const error = yield* Fiber.join(fiber);
        assert.strictEqual(error._tag, "AndroidBootTimeout");
        assert.notInclude(state.commands.flat(), "install");
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect(
    "times out repeated incomplete boot properties without installing",
    () => {
      const state = memory({ bootAfter: Number.POSITIVE_INFINITY });
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(runAndroid(project, "target"))
        );
        yield* TestClock.adjust("120 seconds");
        const error = yield* Fiber.join(fiber);
        assert.strictEqual(error._tag, "AndroidBootTimeout");
        assert.notInclude(state.commands.flat(), "install");
      }).pipe(Effect.provide(state.layer));
    }
  );
  it.effect("stops Gradle after a failed build without installing", () => {
    const state = memory({ buildFailure: true });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(runAndroid(project, "target"));
      assert.strictEqual(error._tag, "ShellCommandError");
      assert.deepStrictEqual(state.commands, expected("target").slice(0, 5));
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
