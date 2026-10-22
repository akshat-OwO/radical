import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  PluginModules,
  resolvePlugins,
} from "../../../src/build/plugins/plugin-plan.ts";
import { googleSignInDeclarations } from "../../../src/capabilities/google-sign-in/google-sign-in-declarations.ts";
import {
  googleSignIn,
  GoogleSignInConfiguration,
  GoogleSignInConfigurationLive,
  BrowserGoogleSignIn,
  BrowserGoogleSignInLive,
} from "../../../src/capabilities/google-sign-in/google-sign-in.ts";
import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";

const config = {
  webClientId: "test-web.apps.googleusercontent.com",
  iosClientId: "test-ios.apps.googleusercontent.com",
};
const unexpected = () =>
  Effect.sync(() => assert.fail("Unexpected native call"));
const configuration = Layer.succeed(GoogleSignInConfiguration, {
  read: Effect.succeed(config),
});
const run = (
  runtime: "ios" | "android",
  call: Parameters<typeof bridgeTestLayer>[1]
) =>
  googleSignIn.pipe(
    Effect.provide(
      Layer.mergeAll(
        configuration,
        BrowserGoogleSignInLive,
        bridgeTestLayer(runtime, call)
      )
    )
  );

for (const runtime of ["ios", "android"] as const) {
  it.effect(
    `returns the decoded identity token after initializing ${runtime}`,
    () =>
      Effect.gen(function* () {
        const calls: unknown[] = [];
        const identity = yield* run(runtime, (plugin, method, options) =>
          Effect.sync(() => {
            calls.push({ plugin, method, options });
            return method === "signIn"
              ? { idToken: "identity", email: "ignored" }
              : undefined;
          })
        );
        assert.deepStrictEqual(identity, { idToken: "identity" });
        assert.deepStrictEqual(calls, [
          {
            plugin: "GoogleSignIn",
            method: "initialize",
            options: { clientId: config.webClientId },
          },
          { plugin: "GoogleSignIn", method: "signIn", options: {} },
        ]);
      })
  );
  it.effect(
    `maps cancellation and provider misconfiguration on ${runtime}`,
    () =>
      Effect.gen(function* () {
        for (const [code, tag] of [
          ["SIGN_IN_CANCELED", "GoogleSignInCancelled"],
          ["PROVIDER_CONFIGURATION_ERROR", "GoogleSignInMisconfigured"],
          ["NO_CREDENTIAL_AVAILABLE", "BridgeCallFailed"],
          ["OTHER", "BridgeCallFailed"],
        ]) {
          const error = yield* run(runtime, (plugin, method) =>
            method === "initialize"
              ? Effect.void
              : Effect.fail(
                  new BridgeCallFailed({ plugin, method, cause: { code } })
                )
          ).pipe(Effect.flip);
          assert.strictEqual(error._tag, tag);
        }
        const error = yield* run(runtime, (plugin, method) =>
          Effect.fail(
            new BridgeCallFailed({
              plugin,
              method,
              cause: { message: "GIDClientID is missing from Info.plist." },
            })
          )
        ).pipe(Effect.flip);
        assert.strictEqual(error._tag, "GoogleSignInMisconfigured");
      })
  );
  it.effect(`rejects missing and malformed identity tokens on ${runtime}`, () =>
    Effect.gen(function* () {
      for (const value of [{}, { idToken: "" }, { idToken: 1 }]) {
        const error = yield* run(runtime, (_plugin, method) =>
          Effect.succeed(method === "signIn" ? value : undefined)
        ).pipe(Effect.flip);
        assert.strictEqual(error._tag, "BridgeDecodeError");
      }
    })
  );
}
it.effect(
  "rejects missing runtime configuration before calling native code",
  () =>
    Effect.gen(function* () {
      const error = yield* googleSignIn.pipe(
        Effect.provide(
          Layer.mergeAll(
            GoogleSignInConfigurationLive,
            BrowserGoogleSignInLive,
            bridgeTestLayer("ios", unexpected)
          )
        ),
        Effect.flip
      );
      assert.strictEqual(error._tag, "GoogleSignInMisconfigured");
    })
);
it.effect(
  "uses an injectable browser flow and reports unavailable by default",
  () =>
    Effect.gen(function* () {
      const bridge = bridgeTestLayer("browser", unexpected);
      const error = yield* googleSignIn.pipe(
        Effect.provide(
          Layer.mergeAll(bridge, configuration, BrowserGoogleSignInLive)
        ),
        Effect.flip
      );
      assert.strictEqual(error._tag, "GoogleSignInUnavailable");
      const identity = yield* googleSignIn.pipe(
        Effect.provide(Layer.merge(bridge, configuration)),
        Effect.provideService(BrowserGoogleSignIn, {
          signIn: Effect.succeed({ idToken: "browser" }),
        })
      );
      assert.deepStrictEqual(identity, { idToken: "browser" });
    })
);
it.effect(
  "interrupts a pending native response without starting another call",
  () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const fiber = yield* run("android", (_plugin, method) =>
        Effect.sync(() => {
          calls.push(method);
        }).pipe(
          Effect.andThen(
            method === "signIn"
              ? Effect.sleep("1 minute").pipe(Effect.as({ idToken: "late" }))
              : Effect.void
          )
        )
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(calls, ["initialize", "signIn"]);
      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(calls, ["initialize", "signIn"]);
    })
);
it.effect("opts in the pinned plugin and validates client IDs", () =>
  Effect.gen(function* () {
    for (const enabled of [undefined, false]) {
      const plugins = yield* resolvePlugins({
        appId: "dev.test.app",
        internalPlugins: { googleSignIn: enabled },
      });
      assert.isFalse(
        plugins.some(({ manifest }) => manifest.id === "googleSignIn")
      );
    }
    const enabled = {
      appId: "dev.test.app",
      internalPlugins: { googleSignIn: true },
      pluginOptions: { GoogleSignIn: config },
    };
    const plugins = yield* resolvePlugins(enabled);
    assert.deepStrictEqual(
      plugins.find(({ manifest }) => manifest.id === "googleSignIn")?.manifest
        .dependencies,
      { "@capawesome/capacitor-google-sign-in": "0.1.4" }
    );
    for (const GoogleSignIn of [
      undefined,
      {},
      { ...config, iosClientId: "<invalid>" },
      { ...config, webClientId: "" },
    ]) {
      assert.strictEqual(
        (yield* resolvePlugins({
          ...enabled,
          pluginOptions: { GoogleSignIn },
        }).pipe(Effect.flip))._tag,
        "InvalidPlugin"
      );
    }
  }).pipe(Effect.provideService(PluginModules, { load: unexpected }))
);
it.effect(
  "generates iOS Google client ID and reversed URL scheme only when enabled",
  () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* googleSignInDeclarations({ appId: "dev.test.app" }),
        ""
      );
      const enabled = {
        appId: "dev.test.app",
        internalPlugins: { googleSignIn: true },
        pluginOptions: { GoogleSignIn: config },
      };
      assert.strictEqual(
        yield* googleSignInDeclarations(enabled),
        "<key>GIDClientID</key><string>test-ios.apps.googleusercontent.com</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>com.googleusercontent.apps.test-ios</string></array></dict></array>"
      );
      assert.strictEqual(
        (yield* googleSignInDeclarations({
          ...enabled,
          pluginOptions: {},
        }).pipe(Effect.flip))._tag,
        "InvalidConfig"
      );
    })
);
