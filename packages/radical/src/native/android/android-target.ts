import path from "node:path";

import { Config, Effect, Schedule } from "effect";
import { Prompt } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { execute } from "../shared/shell.ts";
import { AndroidBootTimeout, AndroidDeviceUnavailable } from "./errors.ts";

const lines = (output: string) =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

const waitForBoot = (
  adb: string,
  project: string,
  target: string,
  serial: string
) =>
  Effect.gen(function* () {
    yield* execute(adb, ["-s", serial, "wait-for-device"], project, {
      capture: true,
    });
    yield* execute(
      adb,
      ["-s", serial, "shell", "getprop", "sys.boot_completed"],
      project,
      { capture: true }
    ).pipe(
      Effect.catchTag("ShellCommandError", () => Effect.succeed("")),
      Effect.repeat({
        until: (output) => output.trim() === "1",
        schedule: Schedule.spaced("1 second"),
      })
    );
  }).pipe(
    Effect.timeout("120 seconds"),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new AndroidBootTimeout({ target, serial }))
    )
  );

/** Detached and unreferenced: the selected emulator survives CLI scope cleanup. */
const startAvd = (
  emulator: string,
  project: string,
  name: string,
  port: number
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(emulator, ["-avd", name, "-port", String(port)], {
          cwd: project,
          detached: true,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        })
      );
      yield* Effect.asVoid(child.unref);
    })
  );

/** Resolve serials and AVD names before any install, without restarting adb. */
export const resolveAndroidTarget = (project: string, target: string) =>
  Effect.gen(function* () {
    const sdk = yield* Config.NonEmptyString("ANDROID_HOME").pipe(
      Config.orElse(() => Config.NonEmptyString("ANDROID_SDK_ROOT")),
      Config.withDefault("")
    );
    const adb =
      sdk.length === 0 ? "adb" : path.join(sdk, "platform-tools", "adb");
    const emulator =
      sdk.length === 0 ? "emulator" : path.join(sdk, "emulator", "emulator");
    const output = yield* execute(adb, ["devices"], project, { capture: true });
    const devices = lines(output).flatMap((line) => {
      const [serial, state] = line.split(/\s+/u);
      return state === "device" ||
        state === "offline" ||
        state === "unauthorized"
        ? [{ serial, state }]
        : [];
    });
    const connected = devices.filter((device) => device.state === "device");
    let serial = devices.find((device) => device.serial === target)?.serial;
    if (!target) {
      serial =
        connected.find((device) => device.serial.startsWith("emulator-"))
          ?.serial ?? connected[0]?.serial;
    } else if (serial === undefined) {
      for (const device of devices.filter((candidate) =>
        candidate.serial.startsWith("emulator-")
      )) {
        const name = yield* execute(
          adb,
          ["-s", device.serial, "emu", "avd", "name"],
          project,
          { capture: true }
        ).pipe(
          Effect.timeout("5 seconds"),
          Effect.catchTags({
            ShellCommandError: () => Effect.succeed(""),
            TimeoutError: () => Effect.succeed(""),
          })
        );
        if (lines(name)[0] === target) {
          ({ serial } = device);
          break;
        }
      }
    }
    if (serial === undefined) {
      const avds = lines(
        yield* execute(emulator, ["-list-avds"], project, { capture: true })
      );
      if (avds.length === 0 || (target.length > 0 && !avds.includes(target))) {
        return yield* new AndroidDeviceUnavailable({
          message:
            target.length > 0
              ? `No Android device or installed AVD matches ${target}.`
              : "No connected Android devices or installed AVDs. Create an AVD or connect a device.",
        });
      }
      const name =
        target ||
        (yield* Prompt.run(
          Prompt.Select({
            message: "Select an Android AVD",
            choices: avds.map((avd) => ({ title: avd, value: avd })),
          })
        ));
      const port = Array.from(
        { length: 64 },
        (_, index) => 5554 + index * 2
      ).find(
        (candidate) =>
          !devices.some((device) => device.serial === `emulator-${candidate}`)
      );
      if (port === undefined) {
        return yield* new AndroidDeviceUnavailable({
          message: "No free Android emulator serial port.",
        });
      }
      serial = `emulator-${port}`;
      yield* startAvd(emulator, project, name, port);
      yield* waitForBoot(adb, project, name, serial);
    } else {
      yield* waitForBoot(adb, project, target || serial, serial);
    }
    return { adb, serial };
  });
