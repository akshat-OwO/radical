/* oxlint-disable typescript/promise-function-async -- In-memory Promise boundaries for the native worker under Effect tests. */
import { assert, describe, it } from "@effect/vitest";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { Context, Effect, Layer } from "effect";

import { shouldRegister, registerOfflineEffect } from "../src/client.ts";
import {
  encodeNativeContextCookie,
  NATIVE_CONTEXT_COOKIE,
} from "../src/native-context.ts";
import { createOfflineWorker } from "../src/offline-worker.ts";
import type { OfflineManifest, WorkerServices } from "../src/offline-worker.ts";
import { offlineHandler } from "../src/tanstack-start-server.ts";

const origin = "https://example.test";
const manifest: OfflineManifest = {
  buildId: "one",
  cachePrefix: "radical:example:",
  assets: ["/assets/app.js", "/assets/lazy.js", "/assets/app.css"],
  fallback: "/offline.html",
};
const html = (text: string, status = 200, offline = true) =>
  new Response(text, {
    status,
    headers: {
      "content-type": "text/html",
      "x-radical-offline": offline ? "1" : "0",
    },
  });
const navigation = (path: string) => {
  const request = new Request(new URL(path, origin));
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};

const makeMemory = () => {
  const storage = new Map<
    string,
    Map<string, { request: Request; response: Response }>
  >();
  const responses = new Map<string, Response>();
  const requests: string[] = [];
  const state = { online: true, writable: true };
  for (const asset of manifest.assets) {
    responses.set(new URL(asset, origin).href, new Response(`asset:${asset}`));
  }
  responses.set(
    new URL(manifest.fallback, origin).href,
    html("offline fallback")
  );
  const services: WorkerServices = {
    origin,
    caches: {
      open: (name) => {
        let data = storage.get(name);
        if (!data) {
          data = new Map();
          storage.set(name, data);
        }
        const snapshots = data;
        return Promise.resolve({
          match: (request, options) => {
            const stored = snapshots.get(request.url);
            const vary = stored?.response.headers.get("vary")?.split(",") ?? [];
            const matches =
              options.ignoreVary ||
              vary.every(
                (header) =>
                  stored?.request.headers.get(header.trim()) ===
                  request.headers.get(header.trim())
              );
            return Promise.resolve(
              matches ? stored?.response.clone() : undefined
            );
          },
          put: (request, response) => {
            if (!state.writable) {
              return Promise.reject(new Error("quota"));
            }
            snapshots.set(request.url, {
              request: request.clone(),
              response: response.clone(),
            });
            return Promise.resolve();
          },
        });
      },
      keys: () => Promise.resolve([...storage.keys()]),
      delete: (name) => Promise.resolve(storage.delete(name)),
    },
    fetch: (request) => {
      requests.push(request.url);
      return state.online
        ? Promise.resolve(
            responses.get(request.url)?.clone() ?? html("not found", 404)
          )
        : Promise.reject(new Error("offline"));
    },
  };
  const worker = createOfflineWorker(manifest, services);
  return { storage, responses, requests, state, services, worker };
};

class Memory extends Context.Service<Memory, ReturnType<typeof makeMemory>>()(
  "test/OfflineMemory"
) {}
const memoryLayer = Layer.sync(Memory, makeMemory);
const responseText = (response: Response) =>
  Effect.promise(() => response.text());

// Every test receives fresh fetch and Cache Storage state through its layer.
describe("offline worker", () => {
  it.effect(
    "uses TanStack's selected route for overlapping, optional, and decorated params",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        yield* Effect.promise(worker.install);
        const root = createRootRoute();
        const routeTree = root.addChildren([
          createRoute({
            getParentRoute: () => root,
            path: "/posts/$id",
            staticData: { radical: { offline: true } },
          }),
          createRoute({
            getParentRoute: () => root,
            path: "/posts/new",
            staticData: { radical: { offline: false } },
          }),
          createRoute({
            getParentRoute: () => root,
            path: "/categories/{-$category}",
            staticData: { radical: { offline: true } },
          }),
          createRoute({
            getParentRoute: () => root,
            path: "/decorated/post-{$postId}",
            staticData: { radical: { offline: true } },
          }),
        ]);
        const cases = [
          ["/posts/new", false],
          ["/posts/123", true],
          ["/categories", true],
          ["/categories/tech", true],
          ["/decorated/post-123", true],
        ] as const;
        for (const [path, eligible] of cases) {
          const router = createRouter({
            routeTree,
            history: createMemoryHistory({ initialEntries: [path] }),
            isServer: true,
          });
          yield* Effect.promise(() => router.load());
          const request = navigation(path);
          const responseHeaders = new Headers({ "content-type": "text/html" });
          const response = offlineHandler(
            ({ responseHeaders: headers }) => new Response(path, { headers })
          )({ request, router, responseHeaders });
          assert.strictEqual(
            response.headers.get("x-radical-offline"),
            eligible ? "1" : "0"
          );
          responses.set(request.url, response);
          yield* Effect.promise(() => worker.respond(request));
        }
        state.online = false;
        for (const [path, eligible] of cases) {
          assert.strictEqual(
            yield* responseText(
              yield* Effect.promise(() => worker.respond(navigation(path)))
            ),
            eligible ? path : "offline fallback"
          );
        }
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect("snapshots eligible documents in both native shells", () =>
    Effect.gen(function* () {
      const { worker, responses, state } = yield* Memory;
      yield* Effect.promise(worker.install);
      for (const platform of ["ios", "android"] as const) {
        const request = navigation(`/notes/${platform}`);
        request.headers.set(
          "cookie",
          `${NATIVE_CONTEXT_COOKIE}=${yield* encodeNativeContextCookie({
            platform,
            safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
            shellVersion: "1.0",
          })}`
        );
        const response = offlineHandler(
          ({ responseHeaders }) =>
            new Response("shell document", { headers: responseHeaders })
        )({
          request,
          router: {
            stores: {
              matches: {
                get: () => [{ staticData: { radical: { offline: true } } }],
              },
            },
          },
          responseHeaders: new Headers({ "content-type": "text/html" }),
        });
        assert.strictEqual(response.headers.get("x-radical-offline"), "1");
        responses.set(request.url, response);
        yield* Effect.promise(() => worker.respond(request));
      }
      state.online = false;
      for (const platform of ["ios", "android"] as const) {
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() =>
              worker.respond(navigation(`/notes/${platform}`))
            )
          ),
          "shell document"
        );
      }
    }).pipe(Effect.provide(memoryLayer))
  );

  it.effect("marks only the worker fallback for native launch recovery", () =>
    Effect.gen(function* () {
      const { worker, responses, state } = yield* Memory;
      yield* Effect.promise(worker.install);
      const request = navigation("/notes/1");
      responses.set(request.url, html("snapshot"));
      const online = yield* Effect.promise(() => worker.respond(request));
      assert.isNull(online.headers.get("x-radical-offline-fallback"));
      state.online = false;
      const snapshot = yield* Effect.promise(() => worker.respond(request));
      assert.isNull(snapshot.headers.get("x-radical-offline-fallback"));
      const fallback = yield* Effect.promise(() =>
        worker.respond(navigation("/missing"))
      );
      assert.strictEqual(
        fallback.headers.get("x-radical-offline-fallback"),
        "1"
      );
      assert.strictEqual(yield* responseText(fallback), "offline fallback");
    }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "keeps exact query snapshots and always refreshes them from the network",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        const first = navigation("/notes/1?view=one");
        const second = navigation("/notes/1?view=two");
        yield* Effect.promise(worker.install);
        responses.set(first.url, html("one"));
        responses.set(second.url, html("two"));
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(first))
          ),
          "one"
        );
        yield* Effect.promise(() => worker.respond(second));
        responses.set(first.url, html("updated"));
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(first))
          ),
          "updated"
        );
        state.online = false;
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(first))
          ),
          "updated"
        );
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(second))
          ),
          "two"
        );
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "uses the app fallback for unvisited query URLs and non-offline routes",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        yield* Effect.promise(worker.install);
        const online = navigation("/online");
        responses.set(online.url, html("online document", 200, false));
        yield* Effect.promise(() => worker.respond(online));
        state.online = false;
        for (const path of [
          "/online",
          "/notes/1?unvisited=yes",
          "/notes/1/extra",
        ]) {
          assert.strictEqual(
            yield* responseText(
              yield* Effect.promise(() => worker.respond(navigation(path)))
            ),
            "offline fallback"
          );
        }
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "precaches hydration assets including lazy chunks and CSS without a later fetch",
    () =>
      Effect.gen(function* () {
        const { worker, requests, state } = yield* Memory;
        yield* Effect.promise(worker.install);
        assert.lengthOf(requests, manifest.assets.length + 1);
        state.online = false;
        for (const path of manifest.assets) {
          const request = new Request(new URL(path, origin));
          assert.isTrue(worker.handles(request));
          assert.strictEqual(
            yield* responseText(
              yield* Effect.promise(() => worker.respond(request))
            ),
            `asset:${path}`
          );
        }
        assert.lengthOf(requests, manifest.assets.length + 1);
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "cleans the previous build's caches while preserving this build and other apps",
    () =>
      Effect.gen(function* () {
        const { worker, storage, services } = yield* Memory;
        yield* Effect.promise(worker.install);
        yield* Effect.promise(() => services.caches.open("other:app"));
        yield* Effect.promise(() =>
          services.caches.open("radical:example:one:snapshots")
        );
        const next = createOfflineWorker(
          { ...manifest, buildId: "two" },
          services
        );
        yield* Effect.promise(next.install);
        yield* Effect.promise(next.activate);
        assert.deepStrictEqual([...storage.keys()].toSorted(), [
          "other:app",
          "radical:example:two:assets",
        ]);
        yield* Effect.promise(worker.activate);
        assert.deepStrictEqual([...storage.keys()], ["other:app"]);
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "snapshots a first visit when the worker takes control, including splat routes",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        yield* Effect.promise(worker.install);
        const request = navigation("/files/a/b?first=visit");
        responses.set(request.url, html("first visit"));
        yield* Effect.promise(() => worker.capture(request.url));
        state.online = false;
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(request))
          ),
          "first visit"
        );
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "does not replace a snapshot with errors, redirects, or non-HTML responses",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        const request = navigation("/notes/1");
        yield* Effect.promise(worker.install);
        responses.set(request.url, html("valid"));
        yield* Effect.promise(() => worker.respond(request));
        const redirected = html("redirected");
        Object.defineProperty(redirected, "redirected", { value: true });
        // Response.clone does not preserve the synthetic redirected property.
        for (const response of [html("error", 500), new Response("json")]) {
          responses.set(request.url, response);
          yield* Effect.promise(() => worker.respond(request));
        }
        const redirectWorker = createOfflineWorker(manifest, {
          ...(yield* Memory).services,
          fetch: () => Promise.resolve(redirected),
        });
        yield* Effect.promise(() => redirectWorker.respond(request));
        state.online = false;
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(request))
          ),
          "valid"
        );
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "returns successful network HTML even when snapshot storage fails",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        const request = navigation("/notes/1");
        responses.set(request.url, html("network"));
        state.writable = false;
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(request))
          ),
          "network"
        );
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "rejects an incomplete precache and leaves the old build intact",
    () =>
      Effect.gen(function* () {
        const { worker, responses, services, storage } = yield* Memory;
        yield* Effect.promise(worker.install);
        responses.delete(new URL(manifest.assets[0], origin).href);
        const next = createOfflineWorker(
          { ...manifest, buildId: "two" },
          services
        );
        const failed = yield* Effect.tryPromise({
          try: next.install,
          catch: () => "install failed" as const,
        }).pipe(Effect.flip);
        assert.strictEqual(failed, "install failed");
        assert.isTrue(storage.has("radical:example:one:assets"));
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "matches snapshots and build assets by exact URL despite Vary headers",
    () =>
      Effect.gen(function* () {
        const { worker, responses, state } = yield* Memory;
        const asset = new URL("/assets/app.js", origin).href;
        responses.set(
          asset,
          new Response("script", { headers: { vary: "Origin" } })
        );
        yield* Effect.promise(worker.install);
        const request = navigation("/notes/1?view=one");
        const response = html("snapshot");
        response.headers.set("vary", "Accept");
        responses.set(request.url, response);
        yield* Effect.promise(() => worker.capture(request.url));
        state.online = false;
        request.headers.set("accept", "text/html,application/xhtml+xml");
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() => worker.respond(request))
          ),
          "snapshot"
        );
        assert.strictEqual(
          yield* responseText(
            yield* Effect.promise(() =>
              worker.respond(new Request(asset, { headers: { origin } }))
            )
          ),
          "script"
        );
      }).pipe(Effect.provide(memoryLayer))
  );

  it.effect(
    "ignores cross-origin requests, writes, and non-asset subresources",
    () =>
      Effect.gen(function* () {
        const { worker, requests } = yield* Memory;
        assert.isFalse(
          worker.handles(new Request("https://other.test/assets/app.js"))
        );
        assert.isFalse(
          worker.handles(new Request(`${origin}/notes/1`, { method: "POST" }))
        );
        assert.isFalse(worker.handles(new Request(`${origin}/api/data`)));
        yield* Effect.promise(() =>
          worker.capture("https://other.test/notes/1")
        );
        assert.isEmpty(requests);
      }).pipe(Effect.provide(memoryLayer))
  );
});

describe("offline registration", () => {
  it.effect("permits production clients while skipping dev and SSR", () =>
    Effect.gen(function* () {
      for (const production of [true, false]) {
        for (const browser of [true, false]) {
          assert.strictEqual(
            shouldRegister({ production, browser }),
            production && browser
          );
        }
      }
      yield* registerOfflineEffect({ production: true });
      yield* registerOfflineEffect({ production: false });
    })
  );
});
