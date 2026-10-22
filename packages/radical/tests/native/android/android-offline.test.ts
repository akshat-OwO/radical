/* oxlint-disable typescript/promise-function-async, promise/avoid-new -- In-memory native Promise boundaries under Effect tests. */
import vm from "node:vm";

import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";

import { offlineSnapshotCheckScript } from "../../../src/core/offline/native-offline.ts";
import launchPage from "../../../templates/android/launch.html?raw";

const url = "https://app.test/notes/1?view=one";
const snapshotCache = "radical:dev.example:/:build:snapshots";
const makeMemory = () => {
  const entries = new Map<string, Set<string>>();
  const messages: string[] = [];
  const state = { href: url, fail: false, listeners: 0 };
  const window = { caches: true };
  let listener: ((event: { data: string }) => unknown) | undefined;
  const run = () => {
    const result: unknown = vm.runInNewContext(
      `(${offlineSnapshotCheckScript("dev.example")})(${JSON.stringify(url)})`,
      {
        window,
        location: {
          get href() {
            return state.href;
          },
        },
        navigator: {
          serviceWorker: {
            addEventListener: (_type: string, receive: typeof listener) => {
              state.listeners += 1;
              listener = receive;
            },
          },
        },
        radicalOffline: {
          postMessage: (message: string) => {
            messages.push(message);
          },
        },
        caches: {
          keys: () =>
            state.fail
              ? Promise.reject(new Error("storage unavailable"))
              : Promise.resolve([...entries.keys()]),
          match: (key: string, options: { cacheName: string }) =>
            Promise.resolve(
              entries.get(options.cacheName)?.has(key) === true
                ? new Response("snapshot")
                : undefined
            ),
        },
      }
    );
    return Effect.promise(() => Promise.resolve(result));
  };
  const activate = () =>
    Effect.promise(() =>
      Promise.resolve(listener?.({ data: "radical-snapshot-ready" }))
    );
  return { entries, messages, state, run, activate };
};
class Memory extends Context.Service<Memory, ReturnType<typeof makeMemory>>()(
  "test/AndroidOffline"
) {}
const layer = Layer.sync(Memory, makeMemory);

describe("native offline URL signal", () => {
  it.effect("reports only the exact URL stored in this app's snapshots", () =>
    Effect.gen(function* () {
      const { entries, messages, state, run } = yield* Memory;
      entries.set("other:build:snapshots", new Set([url]));
      entries.set("radical:dev.example:/:build:assets", new Set([url]));
      entries.set(
        snapshotCache,
        new Set(["https://app.test/notes/1?view=two"])
      );
      yield* run();
      assert.isEmpty(messages);
      entries.get(snapshotCache)?.add(url);
      yield* run();
      assert.deepStrictEqual(messages, [url]);
      assert.strictEqual(state.listeners, 1);
    }).pipe(Effect.provide(layer))
  );

  it.effect(
    "records the first visit after activation finishes capturing it",
    () =>
      Effect.gen(function* () {
        const { entries, messages, run, activate } = yield* Memory;
        yield* run();
        assert.isEmpty(messages);
        entries.set(snapshotCache, new Set([url]));
        yield* activate();
        assert.deepStrictEqual(messages, [url]);
      }).pipe(Effect.provide(layer))
  );

  it.effect("ignores an outdated document and unavailable storage", () =>
    Effect.gen(function* () {
      const { entries, messages, state, run } = yield* Memory;
      entries.set(snapshotCache, new Set([url]));
      state.href = "https://app.test/online";
      yield* run();
      state.href = url;
      state.fail = true;
      yield* run();
      assert.isEmpty(messages);
    }).pipe(Effect.provide(layer))
  );
});

describe("Android launch gate", () => {
  it.effect(
    "waits for the persisted registration lookup before navigating",
    () =>
      Effect.gen(function* () {
        let ready: (() => void) | undefined;
        const lookup = new Promise<void>((resolve) => {
          ready = () => {
            resolve();
          };
        });
        const targets: string[] = [];
        const result: unknown = vm.runInNewContext(
          (
            /<script>(?<script>[\s\S]*?)<\/script>/u.exec(launchPage)?.groups
              ?.script ?? ""
          ).replace("%RADICAL_LAUNCH_URL%", JSON.stringify(url)),
          {
            navigator: {
              serviceWorker: {
                getRegistration: (scope: string) => {
                  assert.strictEqual(scope, url);
                  return lookup;
                },
              },
            },
            location: {
              replace: (target: string) => {
                targets.push(target);
              },
            },
          }
        );
        assert.isEmpty(targets);
        ready?.();
        yield* Effect.promise(() => Promise.resolve(result));
        assert.deepStrictEqual(targets, [url]);
      })
  );

  it.effect("continues loading when service workers are unavailable", () =>
    Effect.sync(() => {
      const targets: string[] = [];
      vm.runInNewContext(
        (
          /<script>(?<script>[\s\S]*?)<\/script>/u.exec(launchPage)?.groups
            ?.script ?? ""
        ).replace("%RADICAL_LAUNCH_URL%", JSON.stringify(url)),
        {
          navigator: {},
          location: {
            replace: (target: string) => {
              targets.push(target);
            },
          },
        }
      );
      assert.deepStrictEqual(targets, [url]);
    })
  );
});
