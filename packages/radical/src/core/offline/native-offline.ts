import {
  offlineMessages,
  offlineProtocolScript,
  snapshotsDisabledKey,
} from "./offline-protocol.ts";

/** Native WebView boundary. Report only URLs with a completed stored snapshot. */
export const offlineSnapshotCheckScript = (appId: string) =>
  `(url => {
  if (!("caches" in window)) return;
  ${offlineProtocolScript(appId)}
  const check = () => caches.keys().then(names => Promise.all(names
    .filter(isSnapshotCache)
    .map(name => caches.match(snapshotKey(url), { cacheName: name, ignoreVary: true }))
  )).then(matches => {
    if (!window[${JSON.stringify(snapshotsDisabledKey)}] && matches.some(Boolean) && location.href === url) radicalOffline.postMessage(url);
  }, () => {});
  window.__radicalOfflineCheck = check;
  if (!window.__radicalOfflineListener) {
    window.__radicalOfflineListener = true;
    navigator.serviceWorker?.addEventListener("message", event => {
      if (decodeOfflineMessage(event.data) === ${JSON.stringify(offlineMessages.snapshotReady)}) return window.__radicalOfflineCheck();
    });
  }
  return check();
})`;
