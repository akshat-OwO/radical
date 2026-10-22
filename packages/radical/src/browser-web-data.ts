import { Effect } from "effect";

import { WebDataClearFailed } from "./data-protection-schema.ts";

/** Injectable browser boundary. Getters may reject access in restricted contexts. */
export interface WebDataEnvironment {
  readonly disableSnapshots?: () => void;
  readonly localStorage: Pick<Storage, "clear">;
  readonly sessionStorage: Pick<Storage, "clear">;
  readonly document: Pick<Document, "cookie">;
  readonly location: Pick<Location, "hostname" | "pathname" | "protocol">;
  readonly caches?: Pick<CacheStorage, "keys" | "delete">;
  readonly indexedDB?: {
    readonly databases?: () => Promise<readonly { readonly name?: string }[]>;
    readonly deleteDatabase: (
      name: string
    ) => EventTarget & { readonly error: unknown };
  };
  readonly serviceWorker?: Pick<ServiceWorkerContainer, "getRegistrations">;
}
const attempt = <A>(run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new WebDataClearFailed({ cause }),
  });
const promise = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new WebDataClearFailed({ cause }),
  });

/** Acknowledgement waits for in-flight snapshot writes before cache deletion. */
export const pauseOfflineWorker = (
  worker: Pick<ServiceWorker, "postMessage">
) =>
  Effect.callback<boolean, WebDataClearFailed>((resume) => {
    const channel = new MessageChannel();
    channel.port1.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => {
        resume(
          event.data === "radical-data-cleared"
            ? Effect.succeed(true)
            : Effect.fail(new WebDataClearFailed({ cause: event.data }))
        );
      }
    );
    channel.port1.start();
    Effect.runSync(
      attempt(() => {
        worker.postMessage("radical-clear-web-data", [channel.port2]);
      }).pipe(
        Effect.matchEffect({
          onSuccess: () => Effect.void,
          onFailure: (error) =>
            Effect.sync(() => {
              resume(Effect.fail(error));
            }),
        })
      )
    );
    return Effect.sync(() => {
      channel.port1.close();
      channel.port2.close();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () =>
        Effect.fail(
          new WebDataClearFailed({
            cause: "Offline worker did not acknowledge clearing",
          })
        ),
    })
  );

const clearCookies = (env: WebDataEnvironment) => {
  const paths = new Set(["/", ""]);
  const parts = env.location.pathname.split("/");
  for (let i = 1; i <= parts.length; i += 1) {
    const path = parts.slice(0, i).join("/");
    paths.add(path);
    paths.add(`${path}/`);
  }
  const host = env.location.hostname.split(".");
  const domains = new Set([""]);
  for (let i = 0; i < host.length; i += 1) {
    const domain = host.slice(i).join(".");
    domains.add(`; Domain=${domain}`);
    domains.add(`; Domain=.${domain}`);
  }
  for (const cookie of env.document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name === undefined || name === "") {
      continue;
    }
    for (const path of paths) {
      for (const domain of domains) {
        const value = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path}${domain}`;
        env.document.cookie =
          env.location.protocol === "https:" ? `${value}; Secure` : value;
        if (env.location.protocol === "https:") {
          env.document.cookie = `${value}; Secure; SameSite=None; Partitioned`;
        }
      }
    }
  }
};

export const clearBrowserWebData = (read: () => WebDataEnvironment) =>
  Effect.gen(function* () {
    const env = yield* attempt(read);
    yield* attempt(() => env.disableSnapshots?.());
    const registrations = yield* promise(
      () => env.serviceWorker?.getRegistrations() ?? Promise.resolve([])
    );
    for (const registration of registrations) {
      for (const worker of new Set([
        registration.active,
        registration.waiting,
        registration.installing,
      ])) {
        if (
          worker &&
          new URL(worker.scriptURL).pathname.endsWith("/radical-sw.js")
        ) {
          yield* pauseOfflineWorker(worker);
        }
      }
      yield* promise(() => registration.unregister());
    }
    const caches = yield* attempt(() => env.caches);
    if (caches) {
      const keys = yield* promise(() => caches.keys());
      yield* Effect.forEach(keys, (key) => promise(() => caches.delete(key)), {
        discard: true,
      });
    }
    const db = yield* attempt(() => env.indexedDB);
    const enumerate = db?.databases;
    if (db && enumerate) {
      const databases = yield* promise(() => enumerate.call(db));
      for (const { name } of databases) {
        if (name === undefined || name === "") {
          continue;
        }
        const request = yield* attempt(() => db.deleteDatabase(name));
        yield* Effect.callback<boolean, WebDataClearFailed>((resume) => {
          request.addEventListener("success", () => {
            resume(Effect.succeed(true));
          });
          request.addEventListener("error", () => {
            resume(
              Effect.fail(new WebDataClearFailed({ cause: request.error }))
            );
          });
          request.addEventListener("blocked", () => {
            resume(
              Effect.fail(
                new WebDataClearFailed({
                  cause: `Close open IndexedDB connections: ${name}`,
                })
              )
            );
          });
        });
      }
    }
    yield* attempt(() => {
      env.localStorage.clear();
      env.sessionStorage.clear();
      clearCookies(env);
    });
  });
