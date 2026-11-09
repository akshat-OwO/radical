// oxlint-disable eslint/no-control-regex -- Reject control characters in logical paths.
// oxlint-disable eslint/max-classes-per-file -- Shared storage errors belong to this foundation.
import { Effect, Schema } from "effect";

import { Bridge } from "../../core/bridge/bridge.ts";
import { Unavailable } from "../../core/errors.ts";
import { callPlugin, definePlugin } from "../../core/plugins/plugins.ts";

export class InvalidStorageInput extends Schema.TaggedError<InvalidStorageInput>()(
  "InvalidStorageInput",
  {}
) {}

export class StorePolicyConflict extends Schema.TaggedError<StorePolicyConflict>()(
  "StorePolicyConflict",
  {}
) {}

export class StorageIOFailed extends Schema.TaggedError<StorageIOFailed>()(
  "StorageIOFailed",
  {}
) {}

export const StorageCapability = Schema.Literals([
  "keyValue",
  "secureStorage",
  "sqlite",
  "fileSystem",
]);

export const BackupClass = Schema.Literals(["eligible", "excluded", "cache"]);

/** ASCII path components keep identity identical on case-sensitive and insensitive volumes. */
export const StorageName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,127}$/u)
);

export const StoreIdentity = Schema.Struct({
  capability: StorageCapability,
  store: StorageName,
  namespace: StorageName,
});

export const StoreRequest = Schema.Struct({
  ...StoreIdentity.fields,
  backup: BackupClass,
  path: Schema.String,
});

export type StorageRequest = typeof StoreRequest.Type;

export const validateStorageRequest = (request: StorageRequest) =>
  Schema.decodeUnknownEffect(StoreRequest)(request).pipe(
    Effect.mapError(() => new InvalidStorageInput()),
    Effect.flatMap((value) =>
      value.path === "" ||
      value.path
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            !/[\\:\u0000-\u001F]/u.test(part)
        )
        ? Effect.succeed(value)
        : Effect.fail(new InvalidStorageInput())
    )
  );

export const appStoragePlugin = definePlugin({
  id: "appStorage",
  bridge: "RadicalAppStorage",
  dependencies: {},
  commands: {
    resolve: {
      args: StoreRequest,
      result: Schema.Struct({ relativePath: Schema.String }),
      errors: { InvalidStorageInput, StorePolicyConflict, StorageIOFailed },
    },
  },
  android: {
    className: "RadicalAppStoragePlugin",
    sources: [
      {
        file: "RadicalAppStoragePlugin.java",
        source: "templates/android/RadicalAppStoragePlugin.java",
      },
      {
        file: "RadicalStorageOwner.java",
        source: "templates/android/RadicalStorageOwner.java",
      },
    ],
    dependencies: {},
  },
  ios: {
    className: "RadicalAppStoragePlugin",
    sources: [
      {
        file: "RadicalAppStoragePlugin.swift",
        source: "templates/ios/RadicalAppStoragePlugin.swift",
      },
      {
        file: "RadicalStorageBackup.swift",
        source: "templates/ios/RadicalStorageBackup.swift",
      },
      {
        file: "RadicalStorageOwner.swift",
        source: "templates/ios/RadicalStorageOwner.swift",
      },
    ],
    dependencies: [],
  },
});

/** Resolves a logical reference. Native container paths never cross the bridge. */
export const resolveAppStorage = (request: StorageRequest) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;

    if ((yield* bridge.runtime) === "browser") {
      return yield* new Unavailable({
        reason: "App storage requires a native shell",
      });
    }

    const validated = yield* validateStorageRequest(request);

    return yield* callPlugin(
      appStoragePlugin.bridge,
      "resolve",
      appStoragePlugin.commands.resolve,
      validated
    );
  });
