import vm from "node:vm";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  decodeOfflineMessage,
  isSnapshotCache,
  offlineCachePrefix,
  OfflineMessageSchema,
  offlineProtocolScript,
  savedOfflineURLKeys,
  snapshotCacheName,
  snapshotKey,
} from "../../../src/core/offline/offline-protocol.ts";
import { decodeWorkerMessage } from "../../../src/core/offline/offline-wire.ts";
import { replaceAnchor } from "../../../src/native/shared/native-template.ts";
import androidActivity from "../../../templates/android/MainActivity.java?raw";
import androidProtection from "../../../templates/android/RadicalDataProtectionPlugin.java?raw";
import iosProtection from "../../../templates/ios/RadicalDataProtectionPlugin.swift?raw";
import iosController from "../../../templates/ios/RadicalViewController.swift?raw";

describe("offline protocol", () => {
  it.effect(
    "shares the literal Schema decoder with generated document-start code",
    () =>
      Effect.sync(() => {
        for (const input of [
          ...OfflineMessageSchema.literals,
          "unrelated",
          {},
          null,
          undefined,
          1,
          ["radical-snapshot-ready"],
        ]) {
          const decoded = decodeOfflineMessage(input);
          const generated: unknown = vm.runInNewContext(
            `${offlineProtocolScript("dev.example")} decodeOfflineMessage(input)`,
            { input, URL }
          );
          assert.strictEqual(decodeWorkerMessage(input), generated);
          assert.strictEqual(
            generated,
            decoded._tag === "Some" ? decoded.value : undefined
          );
        }
      })
  );

  it.effect(
    "selects only this app's snapshot caches across bases and builds",
    () =>
      Effect.sync(() => {
        for (const base of ["/", "/nested/"]) {
          for (const build of ["one", "two"]) {
            const name = snapshotCacheName(
              offlineCachePrefix("dev.example", base),
              build
            );
            assert.strictEqual(
              name,
              `radical:dev.example:${base}:${build}:snapshots`
            );
            assert.isTrue(isSnapshotCache(name, "dev.example"));
            assert.isFalse(isSnapshotCache(name, "dev.other"));
          }
        }
        assert.isFalse(
          isSnapshotCache("radical:dev.example:/:one:assets", "dev.example")
        );
        assert.isFalse(
          isSnapshotCache(
            "radical:dev.example.extra:/:one:snapshots",
            "dev.example"
          )
        );
      })
  );

  it.effect("keeps the full query in snapshot keys and removes fragments", () =>
    Effect.sync(() => {
      const key = "https://app.test/notes?a=1&a=2&b=%20";
      assert.strictEqual(snapshotKey(`${key}#section`), key);
      assert.strictEqual(
        snapshotKey("/notes?a=1&a=2&b=%20#other", "https://app.test"),
        key
      );
      assert.notStrictEqual(
        snapshotKey("https://app.test/notes?a=2&a=1&b=%20"),
        key
      );
      const generated: unknown = vm.runInNewContext(
        `${offlineProtocolScript("dev.example")} snapshotKey(input)`,
        { input: `${key}#section`, URL }
      );
      assert.strictEqual(generated, key);
    })
  );

  it.effect(
    "renders the same saved URL key into shell and clearing templates",
    () =>
      Effect.gen(function* () {
        for (const [platform, templates] of [
          ["android", [androidActivity, androidProtection]],
          ["ios", [iosController, iosProtection]],
        ] as const) {
          for (const template of templates) {
            const rendered = yield* replaceAnchor(
              platform,
              template,
              "__OFFLINE_SAVED_URL_KEY__",
              JSON.stringify(savedOfflineURLKeys[platform])
            );
            assert.notInclude(rendered, "__OFFLINE_SAVED_URL_KEY__");
            assert.include(
              rendered,
              JSON.stringify(savedOfflineURLKeys[platform])
            );
          }
        }
      })
  );
});
