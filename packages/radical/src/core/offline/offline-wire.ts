export const offlineMessages = {
  clear: "radical-clear-web-data",
  cleared: "radical-data-cleared",
  clearFailed: "radical-data-clear-failed",
  snapshotReady: "radical-snapshot-ready",
} as const;

/** Shared literals for the Schema union and the native worker boundary. */
export const offlineMessageLiterals = [
  offlineMessages.clear,
  offlineMessages.cleared,
  offlineMessages.clearFailed,
  offlineMessages.snapshotReady,
] as const;

export type OfflineMessage = (typeof offlineMessageLiterals)[number];

// Native worker payloads are deliberately decoded here without loading the Effect runtime.
export const decodeWorkerMessage = (
  input: unknown
): OfflineMessage | undefined =>
  offlineMessageLiterals.find((message) => message === input);

export const snapshotSuffix = ":snapshots";

/**
 * Appended to the worker's fallback document. Android cannot read a document's
 * response headers, so its shell finds the fallback by this element instead.
 */
export const offlineFallbackMarker = '<meta name="radical-offline-fallback">';

/** True in a document the worker served as its offline fallback. */
export const offlineFallbackCheckScript =
  "document.querySelector('meta[name=\"radical-offline-fallback\"]') !== null";

export const offlineAppCachePrefix = (appId: string) => `radical:${appId}:`;

export const offlineCachePrefix = (appId: string, base: string) =>
  `${offlineAppCachePrefix(appId)}${base}:`;

export const snapshotCacheName = (cachePrefix: string, buildId: string) =>
  `${cachePrefix}${buildId}${snapshotSuffix}`;

export const isSnapshotCache = (name: string, appId: string) =>
  name.startsWith(offlineAppCachePrefix(appId)) &&
  name.endsWith(snapshotSuffix);

/** Cache Storage ignores fragments; keep the full query and its ordering. */
export const snapshotKey = (url: string, base?: string) => {
  const key = new URL(url, base);
  key.hash = "";

  return key.href;
};
