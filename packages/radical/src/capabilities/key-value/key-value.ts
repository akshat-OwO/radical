// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This module validates untrusted JSON inputs at the storage boundary.
// oxlint-disable anti-slop/require-readable-spacing -- Recursive JSON validation groups related guards.
// oxlint-disable anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion -- The optional schema establishes A; without it callers receive unknown by default.
// oxlint-disable eslint/max-classes-per-file -- Storage error and service.
import { Effect, Schema } from "effect";

import {
  Bridge,
  BridgeCallFailed,
  BridgeDecodeError,
} from "../../core/bridge/bridge.ts";
import { Unavailable } from "../../core/errors.ts";
import { callPlugin, definePlugin } from "../../core/plugins/plugins.ts";
import {
  InvalidStorageInput,
  StorageIOFailed,
  StorePolicyConflict,
  StoreRequest,
  validateStorageRequest,
} from "../app-storage/app-storage.ts";

export class InvalidStoredValue extends Schema.TaggedError<InvalidStoredValue>()(
  "InvalidStoredValue",
  {}
) {}

/** Maximum UTF-8 JSON text size, in bytes. */
export const KEY_VALUE_MAX_BYTES = 1_048_576;

export type KeyValueOptions = Pick<
  typeof StoreRequest.Type,
  "store" | "namespace" | "backup"
>;

export type Lookup<A> =
  | { readonly found: false }
  | { readonly found: true; readonly value: A };

const args = Schema.Struct({
  ...StoreRequest.fields,
  operation: Schema.Literals(["get", "set", "remove", "clear"]),
  key: Schema.String,
  json: Schema.optional(Schema.String),
});

export const keyValuePlugin = definePlugin({
  id: "keyValue",
  bridge: "RadicalKeyValue",
  dependencies: {},
  commands: {
    execute: {
      args,
      result: Schema.Struct({ json: Schema.optional(Schema.String) }),
      errors: {
        InvalidStorageInput,
        InvalidStoredValue,
        StorageIOFailed,
        StorePolicyConflict,
      },
    },
  },
  android: {
    className: "RadicalKeyValuePlugin",
    sources: [
      {
        file: "RadicalKeyValuePlugin.java",
        source: "templates/android/RadicalKeyValuePlugin.java",
      },
    ],
    dependencies: {},
  },
  ios: {
    className: "RadicalKeyValuePlugin",
    sources: [
      {
        file: "RadicalKeyValuePlugin.swift",
        source: "templates/ios/RadicalKeyValuePlugin.swift",
      },
      {
        file: "RadicalKeyValueSQLite.swift",
        source: "templates/ios/RadicalKeyValueSQLite.swift",
      },
    ],
    dependencies: [],
  },
});

// Validate before stringify so undefined, non-finite numbers, custom objects,
// sparse arrays, cycles, and toJSON hooks cannot silently change stored data.
const isJson = (value: unknown, parents = new Set<object>()): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || parents.has(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    return false;
  }
  parents.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);

  const valid = Array.isArray(value)
    ? keys.length === value.length + 1 &&
      Array.from(
        { length: value.length },
        (_, index) => descriptors[String(index)]
      ).every(
        (entry) =>
          entry !== undefined &&
          "value" in entry &&
          isJson(entry.value, parents)
      )
    : keys.every(
        (key) =>
          typeof key === "string" &&
          descriptors[key]?.enumerable === true &&
          "value" in descriptors[key] &&
          isJson(descriptors[key].value, parents)
      );

  parents.delete(value);

  return valid;
};

const encode = (value: unknown) =>
  Effect.try({
    try: () => (isJson(value) ? JSON.stringify(value) : undefined),
    catch: () => new InvalidStorageInput(),
  }).pipe(
    Effect.flatMap((json) =>
      json === undefined ||
      new TextEncoder().encode(json).length > KEY_VALUE_MAX_BYTES
        ? Effect.fail(new InvalidStorageInput())
        : Effect.succeed(json)
    )
  );

export const keyValueStore = (options: KeyValueOptions) => {
  const execute = (
    operation: (typeof args.Type)["operation"],
    key = "",
    json?: string
  ) =>
    Effect.gen(function* () {
      const bridge = yield* Bridge;

      if ((yield* bridge.runtime) === "browser") {
        return yield* new Unavailable({
          reason: "Key-value storage requires a native shell",
        });
      }
      const request = yield* validateStorageRequest({
        ...options,
        capability: "keyValue",
        path: "",
      });

      if (
        typeof key !== "string" ||
        key.length > 1024 ||
        (operation !== "clear" && key.length === 0)
      ) {
        return yield* new InvalidStorageInput();
      }
      return yield* callPlugin(
        keyValuePlugin.bridge,
        "execute",
        keyValuePlugin.commands.execute,
        { ...request, operation, key, json }
      ).pipe(
        Effect.catchTag("BridgeCallFailed", () =>
          Effect.fail(
            new BridgeCallFailed({
              plugin: keyValuePlugin.bridge,
              method: "execute",
              cause: "Native key-value command failed",
            })
          )
        ),
        Effect.catchTag("BridgeDecodeError", () =>
          Effect.fail(
            new BridgeDecodeError({
              plugin: keyValuePlugin.bridge,
              method: "execute",
              cause: "Invalid key-value command response",
            })
          )
        )
      );
    });

  return {
    get: <A = unknown>(
      key: string,
      decode?: { readonly schema: Schema.Codec<A, unknown> }
    ) =>
      execute("get", key).pipe(
        Effect.flatMap(
          ({ json }): Effect.Effect<Lookup<A>, InvalidStoredValue> => {
            if (json === undefined) {
              return Effect.succeed({ found: false });
            }
            return Effect.try({
              try: () => {
                const value: unknown = JSON.parse(json);
                return isJson(value) &&
                  new TextEncoder().encode(json).length <= KEY_VALUE_MAX_BYTES
                  ? { valid: true as const, value }
                  : { valid: false as const };
              },
              catch: () => new InvalidStoredValue(),
            }).pipe(
              Effect.flatMap((parsed) => {
                if (!parsed.valid) {
                  return Effect.fail(new InvalidStoredValue());
                }
                return decode
                  ? Schema.decodeUnknownEffect(decode.schema)(
                      parsed.value
                    ).pipe(Effect.mapError(() => new InvalidStoredValue()))
                  : Effect.succeed(parsed.value as A);
              }),
              Effect.map((value) => ({ found: true as const, value }))
            );
          }
        )
      ),
    set: <A = unknown>(
      key: string,
      value: unknown,
      validate?: { readonly schema: Schema.Codec<A, unknown> }
    ) =>
      Effect.gen(function* () {
        const bridge = yield* Bridge;
        if ((yield* bridge.runtime) === "browser") {
          return yield* new Unavailable({
            reason: "Key-value storage requires a native shell",
          });
        }
        const json = yield* encode(value);
        if (validate) {
          yield* Schema.decodeUnknownEffect(validate.schema)(value).pipe(
            Effect.mapError(() => new InvalidStorageInput())
          );
        }
        return json;
      }).pipe(
        Effect.flatMap((json) => execute("set", key, json)),
        Effect.asVoid
      ),
    remove: (key: string) => execute("remove", key).pipe(Effect.asVoid),
    clear: () => execute("clear").pipe(Effect.asVoid),
  };
};
