/** Native WebView boundary. Report only URLs with a completed stored snapshot. */
export const offlineSnapshotCheckScript = (appId: string) =>
  `(url => {
  if (!("caches" in window)) return;
  const check = () => caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(${JSON.stringify(`radical:${appId}:`)}) && name.endsWith(":snapshots"))
    .map(name => caches.open(name).then(cache => cache.match(url, { ignoreVary: true })))
  )).then(matches => {
    if (matches.some(Boolean) && location.href === url) radicalOffline.postMessage(url);
  }, () => {});
  window.__radicalOfflineCheck = check;
  if (!window.__radicalOfflineListener) {
    window.__radicalOfflineListener = true;
    navigator.serviceWorker?.addEventListener("message", event => {
      if (event.data === "radical-snapshot-ready") return window.__radicalOfflineCheck();
    });
  }
  return check();
})`;
