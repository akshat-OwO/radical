import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  resolveAppStorage,
  validateStorageRequest,
} from "../../../src/capabilities/app-storage/app-storage.ts";
import {
  BridgeCallFailed,
  bridgeTestLayer,
} from "../../../src/core/bridge/bridge.ts";
import { resolveBuildPlan } from "../../../src/vite/build-plan.ts";
import { PluginModules } from "../../../src/vite/plugins/plugin-plan.ts";
import { privacyManifestFiles } from "../../../src/vite/privacy-manifest.ts";

const request = {
  capability: "keyValue",
  store: "settings",
  namespace: "user-1",
  backup: "eligible",
  path: "",
} as const;

it.effect("rejects invalid store and namespace components", () =>
  Effect.gen(function* () {
    for (const name of [
      "",
      ".",
      "..",
      "../user",
      "/user",
      "user/name",
      "User",
      "a".repeat(129),
    ]) {
      for (const field of ["store", "namespace"]) {
        const error = yield* validateStorageRequest({
          ...request,
          [field]: name,
        }).pipe(Effect.flip);

        assert.strictEqual(error._tag, "InvalidStorageInput");
        assert.deepStrictEqual(Object.keys(error), ["_tag"]);
      }
    }
  })
);

it.effect("rejects absolute paths and traversal components", () =>
  Effect.gen(function* () {
    for (const path of [
      "/etc",
      "../secret",
      "a/../b",
      "a/./b",
      "a//b",
      "a\\b",
      "C:/data",
      "a\u0000b",
    ]) {
      const error = yield* validateStorageRequest({ ...request, path }).pipe(
        Effect.flip
      );

      assert.strictEqual(error._tag, "InvalidStorageInput");
    }

    assert.strictEqual(
      (yield* validateStorageRequest({ ...request, path: "photos/one.jpg" }))
        .path,
      "photos/one.jpg"
    );
  })
);

it.effect(
  "fails browser operations with Unavailable without calling native code",
  () =>
    Effect.gen(function* () {
      const error = yield* resolveAppStorage(request).pipe(Effect.flip);

      assert.strictEqual(error._tag, "Unavailable");
    }).pipe(
      Effect.provide(
        bridgeTestLayer("browser", () =>
          Effect.sync(() => assert.fail("Native called"))
        )
      )
    )
);

it.effect(
  "generates fixed Android backup roots and application attributes",
  () =>
    Effect.gen(function* () {
      const plan = yield* resolveBuildPlan({
        appId: "dev.test.storage",
        internalPlugins: { appStorage: true },
      });

      assert.strictEqual(
        plan.android.applicationAttributes["android:dataExtractionRules"],
        "@xml/radical_data_extraction_rules"
      );
      assert.strictEqual(
        plan.android.applicationAttributes["android:fullBackupContent"],
        "@xml/radical_backup_rules"
      );

      const privacy = plan.files.find((file) =>
        file.file.endsWith("PrivacyInfo.xcprivacy")
      );

      assert.include(
        privacy?.contents ?? "",
        "<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>"
      );

      assert.strictEqual(
        plan.edits.filter((edit) => edit.file.endsWith("project.pbxproj"))
          .length,
        3
      );

      const rules = plan.files.filter((file) => file.platform === "android");
      assert.strictEqual(rules.length, 2);

      for (const rule of rules) {
        assert.include(rule.contents, 'domain="file" path="radical-storage/"');

        assert.notInclude(rule.contents, "noBackup");
      }
    }).pipe(
      Effect.provide(
        Layer.succeed(PluginModules, {
          load: () => Effect.sync(() => assert.fail("Unexpected load")),
        })
      )
    )
);

it.effect("unions Apple privacy reasons by API without duplicate entries", () =>
  Effect.sync(() => {
    const files = privacyManifestFiles([
      {
        privacyAccessedApis: {
          NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"],
        },
      },
      {
        privacyAccessedApis: {
          NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"],
        },
      },
    ]);

    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0]?.file, "ios/App/App/PrivacyInfo.xcprivacy");
    assert.strictEqual(files[0]?.contents.match(/CA92.1/gu)?.length, 1);
  })
);

it.effect(
  "decodes native policy conflicts without exposing native error data",
  () =>
    Effect.gen(function* () {
      const error = yield* resolveAppStorage(request).pipe(Effect.flip);
      assert.strictEqual(error._tag, "StorePolicyConflict");
      assert.deepStrictEqual(Object.keys(error), ["_tag"]);
    }).pipe(
      Effect.provide(
        bridgeTestLayer("android", () =>
          Effect.fail(
            new BridgeCallFailed({
              plugin: "RadicalAppStorage",
              method: "resolve",
              cause: { code: "StorePolicyConflict", data: {} },
            })
          )
        )
      )
    )
);
