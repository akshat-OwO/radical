import { Effect, Option, Schema } from "effect";

const storageKey = "radical:back-history";

// Back decisions read one entry below the current index; older entries are noise.
const retainedEntries = 50;

const EntriesSchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String)
);

export type BackHistoryStorage = Pick<Storage, "getItem" | "setItem">;

const sessionStorageOrNull = (): BackHistoryStorage | null =>
  Effect.runSync(
    Effect.try(() => globalThis.sessionStorage ?? null).pipe(
      Effect.orElseSucceed(() => null)
    )
  );

/**
 * Internal hrefs of history entries by router history index. Session storage keeps
 * them across reloads, which preserve the index in history state.
 */
export const makeBackHistory = (
  storage: BackHistoryStorage | null = sessionStorageOrNull()
) => {
  const entries = new Map<number, string>();

  const stored = Effect.runSync(
    Effect.try(() => storage?.getItem(storageKey) ?? null).pipe(
      Effect.orElseSucceed(() => null)
    )
  );

  if (stored !== null) {
    const decoded = Schema.decodeUnknownOption(EntriesSchema)(stored);

    if (Option.isSome(decoded)) {
      for (const [index, href] of Object.entries(decoded.value)) {
        const key = Number(index);

        if (Number.isSafeInteger(key)) {
          entries.set(key, href);
        }
      }
    }
  }

  return {
    previous: (index: number) => entries.get(index - 1) ?? null,
    record: (index: number, href: string) => {
      if (entries.get(index) === href) {
        return;
      }

      entries.set(index, href);

      for (const key of entries.keys()) {
        if (key <= index - retainedEntries || key > index + retainedEntries) {
          entries.delete(key);
        }
      }

      const value = JSON.stringify(Object.fromEntries(entries));

      Effect.runSync(
        Effect.try(() => storage?.setItem(storageKey, value)).pipe(
          Effect.ignore
        )
      );
    },
  };
};
