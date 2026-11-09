import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  keyValueStore,
  keyValuePlugin,
  KEY_VALUE_MAX_BYTES,
} from "../../../src/capabilities/key-value/key-value.ts";
import {
  BridgeCallFailed,
  BridgeUnavailable,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import {
  resolveInternalCapabilities,
  resolveInternalPlugins,
} from "../../../src/core/plugins/internal-plugin-registry.ts";

const options = {
  store: "settings",
  namespace: "user",
  backup: "eligible",
} as const;

it.effect(
  "distinguishes missing, null, corrupt JSON and schema mismatch without writing",
  () =>
    Effect.gen(function* () {
      let json: string | undefined;

      const layer = bridgeTestLayer("ios", (_plugin, _method, args) => {
        assert.strictEqual(args?.operation, "get");

        return Effect.succeed(json === undefined ? {} : { json });
      });

      const store = keyValueStore(options);
      assert.deepStrictEqual(
        yield* store.get("key").pipe(Effect.provide(layer)),
        { found: false }
      );
      json = "null";
      assert.deepStrictEqual(
        yield* store.get("key").pipe(Effect.provide(layer)),
        { found: true, value: null }
      );

      for (const text of ["{broken", '"wrong"']) {
        json = text;

        const error = yield* store
          .get("key", { schema: Schema.Number })
          .pipe(Effect.provide(layer), Effect.flip);

        assert.strictEqual(error._tag, "InvalidStoredValue");
        assert.deepStrictEqual(Object.keys(error), ["_tag"]);
        assert.strictEqual(json, text);
      }

      json = "42";
      assert.deepStrictEqual(
        yield* store
          .get("key", { schema: Schema.Number })
          .pipe(Effect.provide(layer)),
        { found: true, value: 42 }
      );
    })
);

it.effect("round-trips JSON and isolates namespace clear and remove", () =>
  Effect.gen(function* () {
    const values = new Map<string, string>();

    const layer = bridgeTestLayer("android", (_plugin, _method, args) =>
      Effect.sync(() => {
        const request = Schema.decodeUnknownSync(
          Schema.Struct({
            namespace: Schema.String,
            key: Schema.String,
            operation: Schema.String,
            json: Schema.optional(Schema.String),
          })
        )(args);

        const prefix = `${request.namespace}:`;
        const id = prefix + request.key;

        if (request.operation === "set" && request.json !== undefined) {
          values.set(id, request.json);
        }

        if (request.operation === "remove") {
          values.delete(id);
        }

        if (request.operation === "clear") {
          for (const entry of values.keys()) {
            if (entry.startsWith(prefix)) {
              values.delete(entry);
            }
          }
        }

        return values.has(id) ? { json: values.get(id) } : {};
      })
    );

    const one = keyValueStore(options);
    const two = keyValueStore({ ...options, namespace: "other" });
    yield* Effect.gen(function* () {
      yield* one.set("key", { count: 2 });
      yield* two.set("key", "other");
      assert.deepStrictEqual(yield* one.get("key"), {
        found: true,
        value: { count: 2 },
      });
      yield* one.clear();
      assert.deepStrictEqual(yield* one.get("key"), { found: false });
      assert.deepStrictEqual(yield* two.get("key"), {
        found: true,
        value: "other",
      });
      yield* two.remove("key");
      assert.deepStrictEqual(yield* two.get("key"), { found: false });
    }).pipe(Effect.provide(layer));
  })
);

it.effect(
  "rejects non-JSON and oversized UTF-8 values before crossing the bridge",
  () =>
    Effect.gen(function* () {
      const store = keyValueStore(options);
      const cycle = { self: {} };
      cycle.self = cycle;

      const sparse = [1, 2];
      Reflect.deleteProperty(sparse, "0");

      for (const value of [
        undefined,
        Number.NaN,
        Infinity,
        1n,
        () => 1,
        new Date(),
        { a: undefined },
        [undefined],
        sparse,
        Object.setPrototypeOf([1], { toJSON: () => "changed" }),
        cycle,
        "é".repeat(KEY_VALUE_MAX_BYTES / 2),
      ]) {
        const error = yield* store.set("key", value).pipe(Effect.flip);
        assert.strictEqual(error._tag, "InvalidStorageInput");
      }
    }).pipe(
      Effect.provide(
        bridgeTestLayer("ios", () =>
          Effect.sync(() => assert.fail("Native called"))
        )
      )
    )
);

it.effect("accepts the exact JSON byte limit", () =>
  keyValueStore(options)
    .set("key", "a".repeat(KEY_VALUE_MAX_BYTES - 2))
    .pipe(
      Effect.provide(
        bridgeTestLayer("ios", (_plugin, _method, args) => {
          assert.strictEqual(
            new TextEncoder().encode(String(args?.json)).length,
            KEY_VALUE_MAX_BYTES
          );

          return Effect.succeed({});
        })
      )
    )
);

it.effect("fails every browser operation with Unavailable", () =>
  Effect.gen(function* () {
    const store = keyValueStore(options);

    for (const operation of [
      store.get("key"),
      store.set("key", undefined),
      store.remove("key"),
      store.clear(),
    ]) {
      const error = yield* operation.pipe(Effect.flip);
      assert.strictEqual(error._tag, "Unavailable");
    }
  }).pipe(
    Effect.provide(
      bridgeTestLayer("browser", () =>
        Effect.sync(() => assert.fail("Native called"))
      )
    )
  )
);

it.effect("enables key-value sources and foundation only when opted in", () =>
  Effect.sync(() => {
    assert.notInclude(resolveInternalCapabilities(), "keyValue");
    assert.includeMembers(resolveInternalCapabilities({ keyValue: true }), [
      "keyValue",
      "appStorage",
    ]);

    assert.include(
      resolveInternalPlugins({ keyValue: true }).map(
        ({ manifest }) => manifest.id
      ),
      "keyValue"
    );
    const plugin = keyValuePlugin;

    assert.strictEqual(plugin?.android?.className, "RadicalKeyValuePlugin");
    assert.strictEqual(plugin?.ios?.className, "RadicalKeyValuePlugin");
    assert.isEmpty(plugin?.dependencies);
  })
);

it.effect("validates an optional set schema before writing", () =>
  Effect.gen(function* () {
    let calls = 0;

    const layer = bridgeTestLayer("ios", () =>
      Effect.sync(() => {
        calls += 1;

        return {};
      })
    );

    const store = keyValueStore(options);

    const error = yield* store
      .set("key", "secret", { schema: Schema.Number })
      .pipe(Effect.provide(layer), Effect.flip);

    assert.strictEqual(error._tag, "InvalidStorageInput");
    assert.deepStrictEqual(Object.keys(error), ["_tag"]);
    assert.strictEqual(calls, 0);
    yield* store
      .set("key", 42, { schema: Schema.Number })
      .pipe(Effect.provide(layer));
    assert.strictEqual(calls, 1);
  })
);

it.effect(
  "preserves missing-command failures and redacts malformed responses",
  () =>
    Effect.gen(function* () {
      const store = keyValueStore(options);

      const missing = yield* store
        .get("key")
        .pipe(
          Effect.provide(
            bridgeTestLayer("ios", (plugin, method) =>
              Effect.fail(new BridgeUnavailable({ plugin, method }))
            )
          ),
          Effect.flip
        );

      assert.strictEqual(missing._tag, "BridgeUnavailable");

      for (const layer of [
        bridgeTestLayer("ios", () =>
          Effect.succeed({ json: { secret: "stored-value" } })
        ),
        bridgeTestLayer("ios", (plugin, method) =>
          Effect.fail(
            new BridgeCallFailed({ plugin, method, cause: "stored-value" })
          )
        ),
      ]) {
        const error = yield* store
          .get("key")
          .pipe(Effect.provide(layer), Effect.flip);

        assert.notInclude(JSON.stringify(error), "stored-value");
      }
    })
);

it.effect("decodes Capacitor storage rejections with explicit empty data", () =>
  Effect.gen(function* () {
    for (const code of [
      "InvalidStorageInput",
      "StorePolicyConflict",
      "StorageIOFailed",
    ]) {
      const layer = bridgeTestLayer("android", (plugin, method) =>
        Effect.fail(
          new BridgeCallFailed({
            plugin,
            method,
            cause: Object.assign(new Error("Native failure"), {
              code,
              data: {},
            }),
          })
        )
      );

      const error = yield* keyValueStore(options)
        .get("key")
        .pipe(Effect.provide(layer), Effect.flip);

      assert.strictEqual(error._tag, code);
      assert.deepStrictEqual(Object.keys(error), ["_tag"]);
    }
  })
);

it.effect(
  "preserves corrupt JSON on reads and permits explicit set and remove recovery",
  () =>
    Effect.gen(function* () {
      let json: string | undefined = "{broken";

      const layer = bridgeTestLayer("android", (_plugin, _method, args) =>
        Effect.gen(function* () {
          const request = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              operation: Schema.String,
              json: Schema.optional(Schema.String),
            })
          )(args).pipe(Effect.orDie);

          return yield* Effect.sync(() => {
            if (request.operation === "set") {
              ({ json } = request);
            }

            if (request.operation === "remove") {
              json = undefined;
            }

            return json === undefined ? {} : { json };
          });
        })
      );

      const store = keyValueStore(options);
      yield* Effect.gen(function* () {
        assert.strictEqual(
          (yield* store.get("key").pipe(Effect.flip))._tag,
          "InvalidStoredValue"
        );
        assert.strictEqual(json, "{broken");
        yield* store.set("key", { recovered: true });
        assert.deepStrictEqual(yield* store.get("key"), {
          found: true,
          value: { recovered: true },
        });
        json = "{broken";
        assert.strictEqual(
          (yield* store.get("key").pipe(Effect.flip))._tag,
          "InvalidStoredValue"
        );
        assert.strictEqual(json, "{broken");
        yield* store.remove("key");
        assert.deepStrictEqual(yield* store.get("key"), { found: false });
      }).pipe(Effect.provide(layer));
    })
);

it.effect("reports sanitized database failures for get, set and clear", () =>
  Effect.gen(function* () {
    const operations: string[] = [];

    const layer = bridgeTestLayer("ios", (plugin, method, args) => {
      operations.push(String(args?.operation));

      return Effect.fail(
        new BridgeCallFailed({
          plugin,
          method,
          cause: {
            code: "StorageIOFailed",
            data: {},
            message: "private native SQLite diagnostics",
          },
        })
      );
    });

    const store = keyValueStore(options);

    for (const operation of [
      store.get("key"),
      store.set("key", "replacement"),
      store.clear(),
    ]) {
      const error = yield* operation.pipe(Effect.provide(layer), Effect.flip);
      assert.strictEqual(error._tag, "StorageIOFailed");
      assert.deepStrictEqual(Object.keys(error), ["_tag"]);
    }

    assert.deepStrictEqual(operations, ["get", "set", "clear"]);
  })
);

it.effect(
  "preserves embedded NUL in keys and JSON strings across set, get and remove",
  () =>
    Effect.gen(function* () {
      const key = "a\0b";
      const value = "before\0after";
      let json: string | undefined;

      const layer = bridgeTestLayer("android", (_plugin, _method, args) =>
        Effect.gen(function* () {
          const request = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              operation: Schema.String,
              key: Schema.String,
              json: Schema.optional(Schema.String),
            })
          )(args).pipe(Effect.orDie);

          assert.strictEqual(request.key, key);

          if (request.operation === "set") {
            ({ json } = request);
          }

          if (request.operation === "remove") {
            json = undefined;
          }

          return json === undefined ? {} : { json };
        })
      );

      const store = keyValueStore(options);
      yield* Effect.gen(function* () {
        yield* store.set(key, value);
        assert.strictEqual(json, JSON.stringify(value));
        assert.deepStrictEqual(yield* store.get(key), { found: true, value });
        yield* store.remove(key);
        assert.deepStrictEqual(yield* store.get(key), { found: false });
      }).pipe(Effect.provide(layer));
    })
);

it.effect(
  "rejects embedded NUL in namespace identities before the bridge",
  () =>
    Effect.gen(function* () {
      const error = yield* keyValueStore({ ...options, namespace: "a\0b" })
        .get("key")
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "InvalidStorageInput");
    }).pipe(
      Effect.provide(
        bridgeTestLayer("ios", () =>
          Effect.sync(() => assert.fail("Native called"))
        )
      )
    )
);
