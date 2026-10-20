/* oxlint-disable promise/prefer-await-to-then, promise/no-nesting -- Native service worker boundary. */
/// <reference lib="webworker" />
import { createOfflineWorker } from "./offline-worker.ts";
import type { OfflineManifest } from "./offline-worker.ts";

declare const __RADICAL_MANIFEST__: OfflineManifest;
declare const self: ServiceWorkerGlobalScope;
const scope = self;
const worker = createOfflineWorker(__RADICAL_MANIFEST__, {
  caches: scope.caches,
  fetch: (request) => scope.fetch(request),
  origin: scope.location.origin,
});
scope.addEventListener("install", (event) => {
  event.waitUntil(worker.install());
});
scope.addEventListener("activate", (event) => {
  event.waitUntil(
    worker
      .activate()
      .then(() => scope.clients.claim())
      .then(() => scope.clients.matchAll({ type: "window" }))
      .then((clients) =>
        Promise.all(
          clients.map((client) =>
            worker.capture(client.url).then(() => {
              client.postMessage("radical-snapshot-ready", []);
            })
          )
        )
      )
  );
});
scope.addEventListener("fetch", (event) => {
  if (worker.handles(event.request)) {
    event.respondWith(worker.respond(event.request));
  }
});
