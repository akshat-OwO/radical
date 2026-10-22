import path from "node:path";

import { Effect, FileSystem, Schema } from "effect";

import { execute } from "../shared/shell.ts";

const simulatorListSchema = Schema.Struct({
  devices: Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        udid: Schema.String,
        name: Schema.String,
        state: Schema.String,
      })
    )
  ),
});

export class IosSimulatorUnavailable extends Schema.TaggedError<
  IosSimulatorUnavailable,
  { readonly brand: unique symbol }
>()("IosSimulatorUnavailable", { message: Schema.String }) {}

export const runIos = (project: string, target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    let udid = target;
    if (!udid) {
      const output = yield* execute(
        "xcrun",
        ["simctl", "list", "devices", "available", "-j"],
        project,
        { capture: true }
      );
      const { devices } = yield* Schema.decodeEffect(
        Schema.fromJsonString(simulatorListSchema)
      )(output);
      const phones = Object.entries(devices)
        .filter(([runtime]) => runtime.includes("iOS"))
        .flatMap(([, list]) => list)
        .filter((device) => device.name.startsWith("iPhone"));
      const selected =
        phones.find((device) => device.state === "Booted") ??
        phones.find(() => true);
      if (!selected) {
        return yield* Effect.fail(
          new IosSimulatorUnavailable({
            message:
              "No available iPhone simulator. Pass --target <udid> or create an iPhone simulator.",
          })
        );
      }
      ({ udid } = selected);
    }
    const { appId } = yield* fs
      .readFileString(path.join(project, "capacitor.config.json"))
      .pipe(
        Effect.flatMap(
          Schema.decodeEffect(
            Schema.fromJsonString(Schema.Struct({ appId: Schema.String }))
          )
        )
      );
    const workspace = path.join(project, "ios/App/App.xcworkspace");
    const container = (yield* fs.exists(workspace))
      ? ["-workspace", workspace]
      : ["-project", path.join(project, "ios/App/App.xcodeproj")];
    const derived = path.join(project, "build");
    yield* execute(
      "xcodebuild",
      [
        ...container,
        "-scheme",
        "App",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${udid}`,
        "-derivedDataPath",
        derived,
        "build",
      ],
      project
    );
    yield* execute("xcrun", ["simctl", "boot", udid], project, {
      capture: true,
      allowAlreadyBooted: true,
    });
    yield* execute(
      "xcrun",
      [
        "simctl",
        "install",
        udid,
        path.join(derived, "Build/Products/Debug-iphonesimulator/App.app"),
      ],
      project
    );
    return yield* execute(
      "xcrun",
      ["simctl", "launch", udid, appId],
      project
    ).pipe(Effect.timeout("30 seconds"));
  });
