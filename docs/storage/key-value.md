# Native key-value storage

Enable `internalPlugins.keyValue: true` in the Radical config. It also includes the app-storage foundation. It adds no public SQLite capability, Capacitor Preferences dependency, or runtime permission.

## API

`keyValueStore({ store, namespace, backup })` constructs a handle without accessing the bridge or disk. Import it from `@akshatowo/radical/client` for Promises or `@akshatowo/radical/effect/client` for Effects. Effect operations require `Bridge`; provide `BridgeLive` in production or `bridgeTestLayer` in tests.

| Operation | Result |
| --- | --- |
| `get(key, { schema }?)` | `{ found: false }` or `{ found: true, value }` |
| `set(key, value, { schema }?)` | void |
| `remove(key)` | void, including when the key is missing |
| `clear()` | void; removes only this namespace's values |

Store and namespace names follow the [foundation rules](foundation.md). Keys contain 1–1024 UTF-16 code units. Keys are bound SQL values, never paths. Keys and JSON string values preserve embedded U+0000 and other UTF-8 characters. Namespace names follow the foundation ASCII rules and reject U+0000. Backup is explicitly `eligible`, `excluded`, or `cache`.

Values must be JSON: null, booleans, strings, finite numbers, dense arrays, and plain objects with enumerable string data properties. Undefined, bigint, functions, symbols, non-finite numbers, cycles, sparse arrays, accessors, and custom object instances are rejected. No `toJSON` conversion runs.

The limit is **1,048,576 bytes of UTF-8 JSON text per value**, including quotes and escapes. `KEY_VALUE_MAX_BYTES` exports this limit. The exact limit is accepted. Larger values fail with `InvalidStorageInput` before a bridge call; native commands also enforce the limit.

An optional Schema validates the JSON representation. On reads, its decoded value is returned. On writes, validation succeeds before the original JSON representation is stored. A corrupt value or failed read decode returns `InvalidStoredValue` and leaves the stored text untouched. Reads never repair or replace corrupt values. The app recovers explicitly with `set` to replace the row or `remove` to delete it. Both remain allowed when the existing row contains invalid JSON. Missing values are successful lookups, including when a Schema is provided.

Corrupt database bytes are a separate failure: operations return `StorageIOFailed` because SQLite cannot access the store. Android uses a non-destructive `DatabaseErrorHandler` instead of the platform default that deletes corrupt databases. Neither platform deletes or recreates a database after an open or query failure. These errors contain no SQLite diagnostics or stored data. Explicit row recovery requires a readable database; `set` and `clear` cannot repair a corrupt database file.

`InvalidStorageInput` covers invalid identity, keys, values, size, and write Schema validation. `StorePolicyConflict` means the identity already has another backup policy. Native I/O failures return `StorageIOFailed`. Browser and SSR operations return `Unavailable`; missing native commands return `BridgeUnavailable`. Storage errors and sanitized bridge errors contain no stored values.

## Example

```ts
import { keyValueStore } from "@akshatowo/radical/client";
import { Schema } from "effect";

const settings = keyValueStore({
  store: "settings",
  namespace: "user-one",
  backup: "eligible",
});
await settings.set("theme", "dark", { schema: Schema.String });
const theme = await settings.get("theme", { schema: Schema.String });
if (theme.found) {
  console.log(theme.value);
}
```

The example app's `/key-value` route uses `useKeyValue(options, key)` from `@akshatowo/radical/react`. The hook reads after mount and exposes `loading`, `value`, `error`, `refresh()`, `set(value)`, `remove()`, `clear()`, and `cancel()`. Writes refresh the lookup. It suppresses overlapping actions. Changing the identity or key interrupts the old lookup and hides its state. Interruption cannot undo a native write already in progress. The hook does not observe writes made through other handles.

## Storage and backup

Each foundation identity resolves to `stores/keyValue/<store>/<namespace>/key-value.sqlite` under its backup-class root. The private `radical_kv` table contains namespace, key, and JSON text, with a composite primary key. All SQL parameters are bound. WAL and atomic SQLite statements or transactions protect writes. Every operation, including SQLite file creation and cleanup, runs through the foundation's shared native mutation owner.

Database, WAL, shared-memory, and rollback-journal files stay together. Android uses the foundation's files, no-backup, or cache root with API 24-compatible platform SQLite. iOS uses Application Support or Caches and reapplies Foundation `isExcludedFromBackup` to the database and any existing sidecars after creation and mutation. Connections close after each operation.

The foundation persists policy per identity. A later conflicting policy fails instead of opening another empty database. Data survives web origin changes, remote/bundled switches, and app relaunches. It remains tied to the installed app identity. Cache data can be evicted by the OS.

Namespaces separate users but do not authorize bridge callers. Sign-out deletes nothing automatically. `clear` deletes values, not the identity's fixed policy. Applications send selected local data to servers explicitly through ordinary HTTP requests or server-function arguments; server rendering has no live native storage access. No values are forwarded automatically.
