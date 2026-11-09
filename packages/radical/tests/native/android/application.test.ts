import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { appStorageContributions } from "../../../src/capabilities/app-storage/app-storage-build.ts";
import { applyAndroidApplication } from "../../../src/native/android/application.ts";
import { composeSettings } from "../../../src/vite/build-plan.ts";

const attributes = appStorageContributions.androidApplicationAttributes ?? {};

it.effect(
  "rejects conflicting app backup contributions with InvalidConfig",
  () =>
    Effect.gen(function* () {
      for (const key of [
        "android:dataExtractionRules",
        "android:fullBackupContent",
      ]) {
        const error = yield* composeSettings("Android application attribute", [
          attributes,
          { [key]: "@xml/app_rules" },
        ]).pipe(Effect.flip);

        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, key);
      }
    })
);

it.effect(
  "preserves existing app rules when storage contributes no attributes",
  () =>
    Effect.gen(function* () {
      const result = yield* applyAndroidApplication(
        '<application android:fullBackupContent="@xml/app_rules"></application>',
        {},
        ["<service />"]
      );

      assert.include(result, 'android:fullBackupContent="@xml/app_rules"');
      assert.include(result, "<service /></application>");
    })
);

it.effect(
  "rejects conflicting template backup attributes and deduplicates equal values",
  () =>
    Effect.gen(function* () {
      for (const [key, value] of Object.entries(attributes)) {
        const manifest = `<application ${key}="@xml/app_rules"></application>`;

        const error = yield* applyAndroidApplication(
          manifest,
          attributes,
          []
        ).pipe(Effect.flip);

        assert.strictEqual(error._tag, "InvalidConfig");
        assert.include(error.message, key);

        const equal = yield* applyAndroidApplication(
          `<application ${key}="${value}"></application>`,
          attributes,
          []
        );

        assert.strictEqual(equal.split(`${key}=`).length - 1, 1);
      }
    })
);
