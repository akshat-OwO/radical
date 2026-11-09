# App-storage foundation

Enable `internalPlugins.appStorage` to include the shared native resolver. This slice supplies identity and backup roots for subsequent storage capabilities. It does not supply key-value, Keychain, SQL, or file operations.

The Effect API exports `resolveAppStorage`, `StoreIdentity`, `StoreRequest`, `StorageCapability`, `StorageName`, and `BackupClass`. The resolver requires the `Bridge` service. A request contains `capability`, `store`, `namespace`, `backup`, and `path`. The result contains `relativePath`, never a native container path.

Store and namespace names contain 1–128 lowercase ASCII letters, digits, underscores, or hyphens, starting with a letter or digit. Logical paths use forward slashes. The empty path identifies the store root. Absolute paths, empty components, dot components, backslashes, colons, and control characters are rejected. Native resolution rejects symlinks in the resolved path.

Identity contains the capability, store, and namespace. It contains no origin or build identifier. Backup policy is recorded separately from the data root, including for cache stores. Reopening an identity with a different policy returns `StorePolicyConflict`.

Android uses internal files for eligible data, `noBackupFilesDir` for excluded data and policy records, and the app cache directory for cache data. Generated rules include the eligible root for cloud backup and device transfer. Both old and new backup-rule attributes belong to the application element.

iOS uses Application Support for eligible and excluded data, and Caches for cache data. Excluded directories receive `isExcludedFromBackup`. Future writers must preserve this attribute on newly staged and replaced files.

The build contribution API accepts `privacyAccessedApis`, a map from Apple API categories to reason codes. Generation unions reasons and bundles one privacy manifest. The resolver contributes an empty API list because it does not use a required-reason API.

Browser and SSR operations fail with `Unavailable`. An installed shell missing the command returns `BridgeUnavailable`. Storage-specific errors contain no input values or native exception descriptions.

Web-data clearing preserves the app-storage cache root and notification topic membership. Sign-out does not delete app storage. Namespaces separate data but do not authorize bridge callers. Platform backup controls do not guarantee exclusion from every device transfer.
