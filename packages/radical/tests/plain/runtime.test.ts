import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer, Schema } from "effect";

import {
  Bridge,
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../src/core/bridge/bridge.ts";
import { registerOffline } from "../../src/plain/client.ts";
import { definePlugin, createPluginClient } from "../../src/plain/plugins.ts";
import {
  createEffectRuntime,
  getEffectRuntime,
} from "../../src/plain/runtime.ts";
import { UnexpectedRejection } from "../fixtures/promise-rejection.ts";

// oxlint-disable unicorn/throw-new-error -- Schema.TaggedError is a class factory.

class Rejected extends Schema.TaggedError<
  Rejected,
  { readonly brand: unique symbol }
>()("Rejected", { reason: Schema.String }) {}

const text = Schema.Struct({ text: Schema.String });

const manifest = definePlugin({
  id: "echo",
  bridge: "Echo",
  dependencies: {},
  commands: { echo: { args: text, result: text, errors: { Rejected } } },
});

it.effect("resolves Plain API commands with the decoded result", () =>
  Effect.gen(function* () {
    const runtime = createEffectRuntime(
      bridgeTestLayer("android", (_plugin, _method, options) =>
        Effect.succeed(options)
      )
    );

    yield* Effect.acquireRelease(Effect.succeed(runtime), (owner) =>
      Effect.promise(owner.dispose)
    );

    const result = yield* Effect.promise(
      async () =>
        await createPluginClient(manifest, runtime).echo({ text: "hello" })
    );

    assert.deepStrictEqual(result, { text: "hello" });
  }).pipe(Effect.scoped)
);

it.effect("rejects with the original tagged bridge error instance", () =>
  Effect.gen(function* () {
    const original = new BridgeCallFailed({
      plugin: "Echo",
      method: "echo",
      cause: "offline",
    });

    const runtime = createEffectRuntime(
      bridgeTestLayer("android", () => Effect.fail(original))
    );

    yield* Effect.acquireRelease(Effect.succeed(runtime), (owner) =>
      Effect.promise(owner.dispose)
    );

    const error = yield* Effect.tryPromise({
      try: async () =>
        await createPluginClient(manifest, runtime).echo({ text: "hello" }),
      catch: (cause) =>
        cause instanceof BridgeCallFailed
          ? cause
          : new UnexpectedRejection({ cause }),
    }).pipe(Effect.flip);

    assert.strictEqual(error, original);

    assert.instanceOf(error, BridgeCallFailed);
  }).pipe(Effect.scoped)
);

it.effect("rejects declared native failures as tagged error classes", () =>
  Effect.gen(function* () {
    const runtime = createEffectRuntime(
      bridgeTestLayer("android", () =>
        Effect.fail(
          new BridgeCallFailed({
            plugin: "Echo",
            method: "echo",
            cause: { code: "Rejected", data: { reason: "denied" } },
          })
        )
      )
    );

    yield* Effect.acquireRelease(Effect.succeed(runtime), (owner) =>
      Effect.promise(owner.dispose)
    );

    const error = yield* Effect.tryPromise({
      try: async () =>
        await createPluginClient(manifest, runtime).echo({ text: "hello" }),
      catch: (cause) =>
        cause instanceof Rejected ? cause : new UnexpectedRejection({ cause }),
    }).pipe(Effect.flip);

    assert.instanceOf(error, Rejected);

    assert.strictEqual(error._tag, "Rejected");

    assert.strictEqual(error.reason, "denied");
  }).pipe(Effect.scoped)
);

it.effect(
  "shares a bridge between Plain and Effect APIs and releases it once",
  () =>
    Effect.gen(function* () {
      let acquired = 0;
      let released = 0;

      const bridge = yield* Bridge.pipe(
        Effect.provide(
          bridgeTestLayer("android", () => Effect.succeed({ text: "shared" }))
        )
      );

      const runtime = createEffectRuntime(
        Layer.effect(
          Bridge,
          Effect.acquireRelease(
            Effect.sync(() => {
              acquired += 1;

              return bridge;
            }),
            () =>
              Effect.sync(() => {
                released += 1;
              })
          )
        )
      );

      yield* Effect.acquireRelease(Effect.succeed(runtime), (owner) =>
        Effect.promise(owner.dispose)
      );

      yield* Effect.promise(
        async () =>
          await createPluginClient(manifest, runtime).echo({ text: "hello" })
      );

      assert.strictEqual(
        yield* Effect.promise(
          async () =>
            await getEffectRuntime(runtime).runPromise(
              Bridge.pipe(Effect.flatMap((service) => service.runtime))
            )
        ),
        "android"
      );

      assert.strictEqual(acquired, 1);

      yield* Effect.promise(runtime.dispose);

      yield* Effect.promise(runtime.dispose);

      assert.strictEqual(released, 1);
    }).pipe(Effect.scoped)
);

it.effect(
  "disposal interrupts a pending Plain API command and waits for cleanup",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<boolean>();

      const stopped = yield* Deferred.make<boolean>();

      const runtime = createEffectRuntime(
        bridgeTestLayer("android", () =>
          Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, true))
          )
        )
      );

      yield* Effect.acquireRelease(Effect.succeed(runtime), (owner) =>
        Effect.promise(owner.dispose)
      );
      // Attach the rejection handler before disposing the owner.

      const pending = Effect.runPromise(
        Effect.tryPromise({
          try: async () =>
            await createPluginClient(manifest, runtime).echo({ text: "hello" }),
          catch: (cause) => new UnexpectedRejection({ cause }),
        }).pipe(Effect.exit)
      );

      yield* Deferred.await(started);

      yield* Effect.promise(runtime.dispose);

      assert.isTrue(yield* Deferred.isDone(stopped));

      assert.isTrue(
        Exit.isFailure(yield* Effect.promise(async () => await pending))
      );
    }).pipe(Effect.scoped)
);

it.effect(
  "offline registration resolves without browser work outside production",
  () =>
    Effect.gen(function* () {
      assert.isUndefined(
        yield* Effect.promise(async () => {
          await registerOffline({ production: false });
        })
      );
    })
);
