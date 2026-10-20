import vm from "node:vm";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Bridge, bridgeLayer } from "../src/bridge.ts";
import {
  safeAreaUpdateScript,
  shellEventPublisher,
} from "../src/shell-events.ts";

const sandbox = () => {
  const window = new EventTarget();
  const properties = new Map<string, string>();
  const writes: string[] = [];
  const parsed: (() => void)[] = [];
  const document = {
    readyState: "loading",
    documentElement: {
      style: {
        getPropertyValue: (name: string) => properties.get(name),
        setProperty: (name: string, value: string) => {
          writes.push(name);
          properties.set(name, value);
        },
      },
    },
    addEventListener: (name: string, apply: () => void) => {
      assert.strictEqual(name, "DOMContentLoaded");
      parsed.push(apply);
    },
  };
  const run = (source: string) => {
    vm.runInNewContext(source, { window, document, CustomEvent });
  };
  return { window, document, properties, writes, parsed, run };
};

describe("shell event scripts", () => {
  it.effect("replays any event including undefined and removes observers", () =>
    Effect.gen(function* () {
      const shell = sandbox();
      shell.run(`(${shellEventPublisher})("capabilityChanged", undefined)`);
      const bridge = yield* Bridge.pipe(
        Effect.provide(
          bridgeLayer(
            () => {},
            () => shell.window
          )
        )
      );
      const values: unknown[] = [];
      const remove = yield* bridge.observe("capabilityChanged", (value) => {
        values.push(value);
      });
      assert.deepStrictEqual(values, [undefined]);
      shell.run(`(${shellEventPublisher})("capabilityChanged", 42)`);
      assert.deepStrictEqual(values, [undefined, 42]);
      remove();
      shell.run(`(${shellEventPublisher})("capabilityChanged", 43)`);
      assert.deepStrictEqual(values, [undefined, 42]);
    })
  );

  it.effect(
    "preserves matching SSR styles and updates CSS without a hook",
    () =>
      Effect.sync(() => {
        const shell = sandbox();
        const initial = { top: 62, right: 0, bottom: 34, left: 0 };
        const rotated = { top: 0, right: 62, bottom: 21, left: 62 };
        for (const [edge, value] of Object.entries(initial)) {
          shell.properties.set(`--radical-safe-area-${edge}`, `${value}px`);
        }
        shell.run(`${safeAreaUpdateScript}${JSON.stringify(initial)});`);
        assert.deepStrictEqual(shell.writes, []);
        shell.document.readyState = "interactive";
        for (const apply of shell.parsed) {
          apply();
        }
        assert.deepStrictEqual(shell.writes, []);
        shell.run(`${safeAreaUpdateScript}${JSON.stringify(rotated)});`);
        assert.strictEqual(shell.writes.length, 4);
        for (const [edge, value] of Object.entries(rotated)) {
          assert.strictEqual(
            shell.properties.get(`--radical-safe-area-${edge}`),
            `${value}px`
          );
        }
        shell.run(`${safeAreaUpdateScript}${JSON.stringify(rotated)});`);
        assert.strictEqual(shell.writes.length, 4);
      })
  );
});
