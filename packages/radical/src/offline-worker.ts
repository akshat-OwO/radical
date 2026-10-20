/* oxlint-disable promise/prefer-await-to-then, promise/no-nesting -- Native worker boundary deliberately excludes the Effect runtime. */
/** Native Promise boundary shared by the bundled worker and in-memory tests. */
export interface OfflineManifest {
  readonly buildId: string;
  readonly cachePrefix: string;
  readonly assets: readonly string[];
  readonly fallback: string;
}

export interface WorkerServices {
  readonly caches: {
    readonly open: (name: string) => Promise<{
      readonly match: (
        request: Request,
        options: { readonly ignoreVary: boolean }
      ) => Promise<Response | undefined>;
      readonly put: (request: Request, response: Response) => Promise<void>;
    }>;
    readonly keys: () => Promise<string[]>;
    readonly delete: (name: string) => Promise<boolean>;
  };
  readonly fetch: (request: Request) => Promise<Response>;
  readonly origin: string;
}

export const createOfflineWorker = (
  manifest: OfflineManifest,
  services: WorkerServices
) => {
  const namespace = `${manifest.cachePrefix}${manifest.buildId}`;
  const assetsName = `${namespace}:assets`;
  const snapshotsName = `${namespace}:snapshots`;
  const absolute = (path: string) => new URL(path, services.origin).href;
  const assetURLs = new Set(manifest.assets.map(absolute));
  const cached = (name: string, request: Request) =>
    services.caches
      .open(name)
      .then((cache) => cache.match(request, { ignoreVary: true }));
  const store = (name: string, request: Request, response: Response) =>
    services.caches
      .open(name)
      .then((cache) => cache.put(request, response.clone()));
  const fallback = () =>
    cached(assetsName, new Request(absolute(manifest.fallback))).then(
      (response) => {
        if (!response) {
          return Response.error();
        }
        const headers = new Headers(response.headers);
        headers.set("x-radical-offline-fallback", "1");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
    );

  const document = (request: Request) =>
    services.fetch(request).then(
      (response) => {
        if (
          response.headers.get("x-radical-offline") === "1" &&
          response.ok &&
          !response.redirected &&
          response.headers.get("content-type")?.includes("text/html") === true
        ) {
          // Storage failures must not discard a successful network response.
          return store(snapshotsName, request, response).then(
            () => response,
            () => response
          );
        }
        return response;
      },
      () =>
        cached(snapshotsName, request).then(
          (response) => response ?? fallback()
        )
    );

  return {
    capture: (url: string): Promise<unknown> =>
      new URL(url).origin === services.origin
        ? document(new Request(url, { headers: { accept: "text/html" } }))
        : Promise.resolve(),
    install: () =>
      Promise.all(
        [...manifest.assets, manifest.fallback].map((path) => {
          const request = new Request(absolute(path), { cache: "reload" });
          return services
            .fetch(request)
            .then((response) =>
              response.ok
                ? store(assetsName, request, response)
                : Promise.reject(new Error(`Cannot precache ${path}`))
            );
        })
      ),
    activate: () =>
      services.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key.startsWith(manifest.cachePrefix) &&
                  key !== assetsName &&
                  key !== snapshotsName
              )
              .map((key) => services.caches.delete(key))
          )
        ),
    handles: (request: Request) =>
      request.method === "GET" &&
      new URL(request.url).origin === services.origin &&
      (request.mode === "navigate" || assetURLs.has(request.url)),
    respond: (request: Request) => {
      if (request.mode !== "navigate") {
        return cached(assetsName, request).then(
          (response) => response ?? services.fetch(request)
        );
      }
      return document(request);
    },
  };
};
