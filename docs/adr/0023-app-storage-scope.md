---
status: accepted
---

# 0023: App storage scope

Radical's agreed storage scope covers key-value storage, a file system, SQLite, and secure storage as separate capabilities. These provide general on-device persistence. Managed content packs, their versioning, and their activation are not the abstraction requested for this design.

Native data belongs to the installed app rather than the web origin. Changing domains or switching between remote and bundled mode must preserve access to that data. This ownership prevents a web deployment change from stranding native app data. Storage is native-only, with documentation callouts. Server code can use local data explicitly sent by the device in HTTP requests, as described below.

File storage separates persistent files from disposable cache. Radical does not automatically evict persistent files. Local operations and direct-to-file downloads are included, with progress, cancellation, and resume. Native background transfers are included where supported, with persisted progress and resumability after interruption. Explicit pause remains in effect, and termination does not guarantee completion.

Downloads use a temporary file and replace an existing destination only after successful completion. Cancellation or failure preserves the existing destination. Apps may provide an expected hash for integrity verification. Insufficient space produces a typed error. Cache inspection and cleanup are explicit, and Radical does not silently delete persistent data or choose application files to discard.

Large downloads must not require the entire response in JavaScript memory. File access includes whole-file convenience methods, bounded reads, streaming writes, and local URLs usable by WebView libraries. Large files must not require base64 transfer across the bridge.

SQLite exposes SQL and transactions, with migrations controlled by the app and no required ORM. Key-value storage accepts JSON values with optional Schema validation, and distinguishes missing keys from invalid stored values. Secure storage initially excludes per-read biometric authentication, which needs a separate contract for cancellation and invalidation.

Apps explicitly delete their data and use namespaces to separate users. Sign-out does not implicitly delete native data. Web data clearing remains separate from native app-storage deletion.

Backup eligibility is configurable per store or data class. User-created files, settings, and databases are eligible for platform backup by default. Cache and redownloadable files are excluded. Device-bound secrets are excluded from migration where supported. Apps can explicitly request backup exclusion for persistent data. These policies follow platform controls and do not promise absolute exclusion from every backup or device transfer. Uninstall is not a universal secret-deletion guarantee, because iOS Keychain values can survive reinstall. See [Android backup behavior](https://developer.android.com/identity/data/autobackup), [Apple backup guidance](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup), and [SecureStore persistence](https://docs.expo.dev/versions/latest/sdk/securestore/#data-persistence).

Imports must be safe outside a native shell. Browser storage operations fail with a typed Unavailable error rather than silently doing nothing or substituting browser storage.

WebView code chooses storage operations at runtime through a general bridge API. Keys, SQL queries, file operations, and the data needed by each page are not enumerated in the native build. Updating web code can change how it uses storage commands already present in the installed shell. New native commands or capability declarations still require an app release.

No native-build-configured startup data list or mandatory startup function is required. Pages request the data they need through the bridge and control their own loading and error behavior. This avoids tying application data requirements to the native release cycle.

Native code reads local storage and sends selected data with ordinary HTTP requests. Server rendering and server functions can use those request values. Server responses can return results for application code to apply on-device. The server does not obtain live device storage access, and additional local data requires another exchange.

Application code chooses which local data to send as ordinary HTTP request data or server-function arguments and how to apply returned results. There is no separate server storage API or native-build-configured initial-render data list. Sending data is explicit, and secure-storage contents are not automatically forwarded.

Arbitrary server-to-device storage calls were considered, including temporary request-bound channels. They were dropped in favor of ordinary HTTP exchanges to avoid live connection routing and additional relay infrastructure. The earlier RPC-specific decisions about remote retries, capability access configuration, and remote transaction batching no longer define this design.

Hosting portability across TanStack-supported deployments is required, including serverless and multiple server instances. No persistent device connection, storage RPC relay, or long-lived app server is required.

These product boundaries were confirmed in the design interview. Public API signatures, native dependencies, and implementation details remain implementation work within these boundaries.
