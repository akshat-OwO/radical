import { Effect, Schema } from "effect";

import { RequestFailed } from "../bundled/request-error.ts";
import {
  APP_UPDATE_HEADER,
  APP_UPDATE_PATH,
  AppUpdateStateSchema,
  appUpdateStore,
} from "./app-update.ts";
import type { AppUpdateStore } from "./app-update.ts";

/** Only Radical's marked protocol responses affect compatibility state. */
export const receiveAppUpdate = (
  response: Response,
  store: AppUpdateStore = appUpdateStore
) =>
  Effect.gen(function* () {
    if (response.headers.get(APP_UPDATE_HEADER) !== "1") {
      return;
    }

    const body: unknown = yield* Effect.tryPromise({
      try: () => response.clone().json(),
      catch: (cause) => new RequestFailed({ cause }),
    });

    const state = yield* Schema.decodeUnknownEffect(AppUpdateStateSchema)(body);

    if (response.status === 426 && state.status !== "required") {
      return;
    }

    yield* Effect.sync(() => {
      store.set(state);
    });
  });

/** Call with createRadicalFetch so bundled context and credentials reach the server. */
export const fetchAppUpdate = (
  request: typeof fetch,
  store: AppUpdateStore = appUpdateStore
) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => request(APP_UPDATE_PATH),
      catch: (cause) => new RequestFailed({ cause }),
    });

    if (
      (!response.ok && response.status !== 426) ||
      response.headers.get(APP_UPDATE_HEADER) !== "1"
    ) {
      return yield* new RequestFailed({
        cause: `Update policy returned ${response.status}`,
      });
    }

    yield* receiveAppUpdate(response, store).pipe(
      Effect.mapError((cause) => new RequestFailed({ cause }))
    );

    return store.snapshot();
  });
