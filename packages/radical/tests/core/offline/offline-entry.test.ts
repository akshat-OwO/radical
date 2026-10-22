/* oxlint-disable typescript/promise-function-async -- In-memory worker APIs return native promises. */
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { installOfflineWorker } from "../../../src/core/offline/offline-entry.ts";
import { offlineMessages } from "../../../src/core/offline/offline-protocol.ts";

const origin = "https://example.test";
const fixture = () => {
  const listeners = new Map<string, (event: FakeWorkerEvent) => void>();
  const storage = new Map<string, Map<string, Response>>([
    ["radical:test:old:assets", new Map()],
    ["other:assets", new Map()],
  ]);
  const requests: string[] = [];
  const events: string[] = [];
  const messages: unknown[] = [];
  let online = true;
  const scope = {
    location: { origin },
    addEventListener: (
      type: string,
      listener: (event: FakeWorkerEvent) => void
    ) => {
      listeners.set(type, listener);
    },
    caches: {
      keys: () => Promise.resolve([...storage.keys()]),
      delete: (name: string) => Promise.resolve(storage.delete(name)),
      open: (name: string) => {
        const data = storage.get(name) ?? new Map<string, Response>();
        storage.set(name, data);
        return Promise.resolve({
          match: (request: Request) =>
            Promise.resolve(data.get(request.url)?.clone()),
          put: (request: Request, response: Response) => {
            data.set(request.url, response.clone());
            events.push(`stored:${request.url}`);
            return Promise.resolve();
          },
        });
      },
    },
    fetch: (request: Request) => {
      requests.push(request.url);
      return online
        ? Promise.resolve(
            new Response(request.url, {
              headers: {
                "content-type": "text/html",
                "x-radical-offline": "1",
              },
            })
          )
        : Promise.reject(new Error("offline"));
    },
    clients: {
      claim: () => {
        events.push("claim");
        return Promise.resolve();
      },
      matchAll: (options: ClientQueryOptions) => {
        assert.deepStrictEqual(options, { type: "window" });
        events.push("matchAll");
        return Promise.resolve([
          {
            url: `${origin}/notes?q=1`,
            postMessage: (message: string, transfer: Transferable[]) => {
              assert.deepStrictEqual(transfer, []);
              events.push("snapshotReady");
              messages.push(message);
            },
          },
        ]);
      },
    },
  };
  // SAFETY: The fixture implements all scope APIs consumed by installOfflineWorker; unused host fields are never read.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Fake scope implements precisely the APIs consumed by the listener installer.
  installOfflineWorker(scope as ServiceWorkerGlobalScope & typeof scope, {
    buildId: "new",
    cachePrefix: "radical:test:",
    assets: ["/app.js"],
    fallback: "/offline.html",
  });
  const dispatch = (type: string, fields: Partial<FakeWorkerEvent> = {}) =>
    Effect.gen(function* () {
      const pending: Promise<unknown>[] = [];
      let response: Promise<Response> | undefined;
      const listener = listeners.get(type);
      assert.isDefined(listener);
      listener({
        request: new Request(origin),
        data: "",
        ports: [],
        ...fields,
        waitUntil: (promise: Promise<unknown>) => {
          pending.push(promise);
        },
        respondWith: (promise: Promise<Response>) => {
          response = promise;
        },
      });
      yield* Effect.promise(() => Promise.all(pending));
      return {
        waited: pending.length,
        response: response
          ? yield* Effect.promise(
              () => response ?? Promise.resolve(Response.error())
            )
          : undefined,
      };
    });
  return {
    storage,
    requests,
    events,
    messages,
    dispatch,
    offline: () => {
      online = false;
    },
    listeners,
  };
};
const navigation = (path: string) => {
  const request = new Request(new URL(path, origin));
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};

it.effect(
  "registers install and activate lifetimes, claims clients, then captures snapshots before notifying windows",
  () =>
    Effect.gen(function* () {
      const fake = fixture();
      assert.deepStrictEqual(
        [...fake.listeners.keys()],
        ["install", "activate", "fetch", "message"]
      );
      assert.strictEqual((yield* fake.dispatch("install")).waited, 1);
      assert.deepStrictEqual(fake.requests.toSorted(), [
        `${origin}/app.js`,
        `${origin}/offline.html`,
      ]);
      assert.strictEqual((yield* fake.dispatch("activate")).waited, 1);
      assert.isFalse(fake.storage.has("radical:test:old:assets"));
      assert.isTrue(fake.storage.has("other:assets"));
      assert.deepStrictEqual(fake.events.slice(-4), [
        "claim",
        "matchAll",
        `stored:${origin}/notes?q=1`,
        "snapshotReady",
      ]);
      assert.deepStrictEqual(fake.messages, [offlineMessages.snapshotReady]);
      fake.offline();
      const { response } = yield* fake.dispatch("fetch", {
        request: navigation("/notes?q=1"),
      });
      assert.isDefined(response);
      assert.strictEqual(
        yield* Effect.promise(() => response.text()),
        `${origin}/notes?q=1`
      );
    })
);

it.effect(
  "responds only to handled fetches and leaves unrelated requests to the browser",
  () =>
    Effect.gen(function* () {
      const fake = fixture();
      yield* fake.dispatch("install");
      fake.offline();
      const asset = yield* fake.dispatch("fetch", {
        request: new Request(`${origin}/app.js`),
      });
      assert.isDefined(asset.response);
      assert.strictEqual(
        yield* Effect.promise(
          () => asset.response?.text() ?? Promise.resolve("")
        ),
        `${origin}/app.js`
      );
      for (const request of [
        new Request(`${origin}/api`),
        new Request("https://other.test/app.js"),
        new Request(`${origin}/notes`, { method: "POST" }),
      ]) {
        assert.isUndefined(
          (yield* fake.dispatch("fetch", { request })).response
        );
      }
    })
);

it.effect(
  "waits for clear messages, replies on the first port, ignores unknown messages and tolerates absent ports",
  () =>
    Effect.gen(function* () {
      const fake = fixture();
      yield* fake.dispatch("install");
      const replies: unknown[] = [];
      const ports = [
        {
          postMessage: (message: string) => {
            replies.push(message);
          },
        },
        {
          postMessage: () =>
            assert.fail("Only the first port receives an acknowledgement"),
        },
      ];
      assert.strictEqual(
        (yield* fake.dispatch("message", { data: "unknown", ports })).waited,
        0
      );
      assert.isEmpty(replies);
      assert.strictEqual(
        (yield* fake.dispatch("message", {
          data: offlineMessages.clear,
          ports,
        })).waited,
        1
      );
      assert.deepStrictEqual(replies, [offlineMessages.cleared]);
      assert.deepStrictEqual([...fake.storage.keys()], ["other:assets"]);
      assert.isUndefined(
        (yield* fake.dispatch("fetch", { request: navigation("/notes") }))
          .response
      );
      assert.strictEqual(
        (yield* fake.dispatch("message", {
          data: offlineMessages.clear,
          ports: [],
        })).waited,
        1
      );
    })
);
interface FakeWorkerEvent {
  readonly request: Request;
  readonly data: string;
  readonly ports: readonly {
    readonly postMessage: (message: string) => void;
  }[];
  readonly waitUntil: (promise: Promise<unknown>) => void;
  readonly respondWith: (promise: Promise<Response>) => void;
}
