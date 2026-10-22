/// <reference lib="webworker" />
import { installOfflineWorker } from "./offline-entry.ts";
import type { OfflineManifest } from "./offline-worker.ts";

declare const __RADICAL_MANIFEST__: OfflineManifest;
declare const self: ServiceWorkerGlobalScope;
installOfflineWorker(self, __RADICAL_MANIFEST__);
