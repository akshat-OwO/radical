# App-storage foundation

Enable `internalPlugins.appStorage` to include the shared native resolver. This slice supplies identity and backup roots for subsequent storage capabilities. It does not supply key-value, Keychain, SQL, or file operations.

The Effect API exports `resolveAppStorage`, `StoreIdentity`, `StoreRequest`, `StorageCapability`, `StorageName`, and `BackupClass`. The resolver requires the `Bridge` service. A request contains `capability`, `store`, `namespace`, `backup`, and `path`. The result contains `relativePath`, never a native container path.

Store and namespace names contain 1–128 lowercase ASCII letters, digits, underscores, or hyphens, starting with a letter or digit. Logical paths use forward slashes. The empty path identifies the store root. Absolute paths, empty components, dot components, backslashes, colons, and control characters are rejected. Native resolution rejects symlinks in the resolved path, including dangling links. iOS uses descriptor-relative access with no-follow flags. Android uses API 24-compatible lstat and no-follow opens.

Identity contains the capability, store, and namespace. It contains no origin or build identifier. Eligible policy metadata is backed up with eligible data. Excluded and cache policy metadata belongs to excluded storage. Resolution checks all existing store roots and policy records before creating a store. A restored data directory therefore retains its class even if its policy metadata is missing. Reopening an identity with a different policy returns `StorePolicyConflict`.

Android uses internal files for eligible data and policy records, `noBackupFilesDir` for excluded data and excluded/cache policy records, and the app cache directory for cache data. Generated rules include the eligible root for cloud backup and device transfer. Both old and new backup-rule attributes belong to the application element.

iOS uses Application Support for eligible and excluded data, and Caches for cache data. Excluded directories receive `isExcludedFromBackup`. Future writers must preserve this attribute on newly staged and replaced files.

The build contribution API accepts `privacyAccessedApis`, a map from Apple API categories to reason codes. Generation unions reasons and bundles one privacy manifest. The resolver declares file metadata access under `NSPrivacyAccessedAPICategoryFileTimestamp`, reason `C617.1`, for metadata within the app container.

Browser and SSR operations fail with `Unavailable`. An installed shell missing the command returns `BridgeUnavailable`. Storage-specific errors contain no input values or native exception descriptions.

Web-data clearing preserves the app-storage cache root and notification topic membership. Sign-out does not delete app storage. Namespaces separate data but do not authorize bridge callers. Platform backup controls do not guarantee exclusion from every device transfer.

Policy publication flushes a temporary record before publishing it atomically. Android publishes a nonempty policy directory by rename, which cannot replace another nonempty policy directory. iOS publishes with an exclusive hard link. An advisory lock serializes store creation and publication across callers. Abandoned temporary records do not become authoritative policy records.

## Confinement and native mutation ownership

Namespaces separate data, not authorization: any bridged JavaScript may request another namespace. Native app code sharing the app uid is trusted code, not a separate sandbox principal.

Android API 24 exposes no public descriptor-relative openat or mkdirat API. Per-component lstat and final-component O_NOFOLLOW checks alone cannot stop an independent native writer swapping a parent between validation and use. Radical therefore owns its private roots structurally: every Radical app-storage mutation in the shell process must run synchronously through RadicalStorageOwner.mutate, from validation through final use. This one owner covers all three roots and all capabilities, including future background jobs, directory creation, rename, replacement, and deletion. Internal filesystem helpers require the owner. No Radical API creates symlinks or returns writable native paths. Unrelated native code or another app process must not mutate these roots behind the owner; supporting another process requires routing its operations through the same shell owner. The advisory policy lock additionally coordinates policy publication.

On iOS, directory operations and backup-exclusion writes use verified descriptors. RadicalStorageBackup applies or removes the on-disk backup-exclusion marker with fsetxattr or fremovexattr, without resolving the directory pathname again. Renaming a verified directory and substituting a symlink cannot redirect the attribute write.

Deterministic native regression tests compile the production helpers directly. StorageOwnerTest schedules a competing parent-swap model after validation and waits until that thread is blocked on the owner; only the validated root receives the modeled namespace creation. StorageBackupTest replaces the real parent with a symlink after opening the target descriptor, then verifies both setting and clearing the exclusion leave the outside target untouched. The native test commands and device checks are recorded in the verification document.
