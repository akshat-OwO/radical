import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeBackHistory } from "../../../src/capabilities/back/back-history.ts";
import type { BackHistoryStorage } from "../../../src/capabilities/back/back-history.ts";

const memoryStorage = () => {
  const values = new Map<string, string>();

  const storage: BackHistoryStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };

  return { storage, values };
};

describe("back history", () => {
  it.effect("reads the entry below the current index", () =>
    Effect.sync(() => {
      const history = makeBackHistory(null);
      history.record(0, "/");
      history.record(1, "/inbox");

      assert.strictEqual(history.previous(1), "/");
      assert.strictEqual(history.previous(0), null);
    })
  );

  it.effect("survives a reload through storage", () =>
    Effect.sync(() => {
      const { storage } = memoryStorage();
      const before = makeBackHistory(storage);
      before.record(3, "/inbox");
      before.record(4, "/inbox/42");

      const after = makeBackHistory(storage);

      assert.strictEqual(after.previous(4), "/inbox");
    })
  );

  it.effect("overwrites an index after a new push", () =>
    Effect.sync(() => {
      const history = makeBackHistory(null);
      history.record(1, "/inbox");
      history.record(2, "/inbox/42");
      history.record(2, "/settings");

      assert.strictEqual(history.previous(3), "/settings");
    })
  );

  it.effect("ignores malformed and failing storage", () =>
    Effect.sync(() => {
      const { storage, values } = memoryStorage();
      values.set("radical:back-history", "not json");

      assert.strictEqual(makeBackHistory(storage).previous(1), null);

      const failing: BackHistoryStorage = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      };

      const history = makeBackHistory(failing);
      history.record(0, "/");

      assert.strictEqual(history.previous(1), "/");
    })
  );

  it.effect("drops entries far from the current index", () =>
    Effect.sync(() => {
      const { storage, values } = memoryStorage();
      const history = makeBackHistory(storage);
      history.record(0, "/");
      history.record(80, "/far");

      assert.strictEqual(history.previous(1), null);
      assert.notInclude(values.get("radical:back-history") ?? "", '"0"');
    })
  );
});

it.effect("preserves full hrefs and reads legacy pathname entries", () =>
  Effect.sync(() => {
    const { storage, values } = memoryStorage();
    values.set("radical:back-history", '{"0":"/inbox"}');
    const history = makeBackHistory(storage);
    assert.strictEqual(history.previous(1), "/inbox");
    history.record(1, "/inbox?q=one#anchor");
    history.record(2, "/inbox?q=two#other");
    assert.strictEqual(history.previous(2), "/inbox?q=one#anchor");
    assert.strictEqual(
      makeBackHistory(storage).previous(3),
      "/inbox?q=two#other"
    );
  })
);
