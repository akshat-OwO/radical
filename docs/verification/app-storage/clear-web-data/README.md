# Backup defaults and native web-data clearing

Verified on 2026-11-09 on Pixel_9, Android 16, and iPhone 17 Pro simulator, iOS 26.5. Both production examples and test-only instrumented examples built successfully. Android commands used JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home. [Android builds](android-build.txt), [iOS builds](ios-build.txt).

## Backup rules preserve the default domains

Parsed the merged Android application element and the generated resource XML with ElementTree. The application references radical_data_extraction_rules and radical_backup_rules. Legacy backup uses an empty full-backup-content element. Data extraction contains empty cloud-backup and device-transfer sections. None contains include or exclude entries. This retains Android's full default traversal, including device_root, device_file, device_database, device_sharedpref, and future platform domains. Enumerating only five domains was incomplete. No exclude is needed for noBackupFilesDir, cache, or code cache; Android omits those platform directories.

- [Merged attributes and parsed empty-rule sections](android-backup.json)
- [Legacy backup XML](radical_backup_rules.xml)
- [Cloud/device-transfer XML](radical_data_extraction_rules.xml)

[Android's include/exclude documentation](https://developer.android.com/identity/data/autobackup#xml-include-exclude) explains why any include creates an allowlist. Leaving includes absent preserves the platform default rather than attempting to enumerate it.

Effect tests check that no include is emitted, legacy rules are empty, and both empty data-extraction sections exist. They also check the existing application contribution composer rejects different backup-attribute values with typed InvalidConfig, equal values deduplicate, and template attributes survive when app storage contributes none. A generation test starts with an app's custom fullBackupContent, verifies the typed conflict, and verifies the previously published shell is preserved. Application generation now composes with existing template attributes rather than adding duplicate attributes or overwriting them.

The latest follow-up rebuilt and launched only Pixel_9, since iOS and topic-clearing code are unchanged. The [JDK 21 build](android-default-build.txt) passed with 489 tasks executed, and the [launch snapshot](android-default-launch.txt) shows all five storage-root checks passing. The XML files and Android manifest evidence above are refreshed; the topic-clearing and iOS results remain those verified at 346b3c8.

## Topic membership is cleared; app storage survives

The test-only [instrumenter](instrument.py) changes only generated example code. It adds seed/inspect branches to the existing Echo command, preserving production source beside the generated file. Tracked example sources and production helpers are unchanged. The seeds use the real notification record formats: an Android SharedPreferences string set named topics in radical.notificationTopics, and an iOS UserDefaults string array under radical.notificationTopics. No Firebase subscription or network action is requested.

The [probe page](probe.html) first resolves a cache store, seeds a local topic record and a cache sentinel, calls the real RadicalDataProtection.clearWebData, then inspects both through native APIs. App-storage fixture writes run under the shared owner. After clearing:

- Android SharedPreferences is empty and iOS UserDefaults has no topic key.
- The app-storage cache root remains a directory.
- The sentinel still contains the original cache-survives bytes.

The page is then relaunched with stage reopen, which only inspects state. It neither resolves/recreates a store nor reseeds data. The topic record stays absent and cache contents stay intact.

| Platform | Clear | Relaunch |
| --- | --- | --- |
| Pixel_9 | [results](android-clear.json), [snapshot](android-clear.txt) | [results](android-reopen.json), [snapshot](android-reopen.txt) |
| iPhone 17 Pro | [results](ios-clear.json), [snapshot](ios-clear.txt) | [results](ios-reopen.json), [snapshot](ios-reopen.txt) |

These device fixtures use the example's enabled plugins. Separate in-memory generation tests disable both notification capabilities and verify that native topic clearing is still generated, no notification plugin class is linked, and the app-storage cache skip remains present. This restores ADR 0012 without treating topic membership as app storage. Clearing the local history does not unsubscribe from FCM topics.

## Reproduce

Generate the examples, then run these commands before repeating the native build commands in the parent verification document:

```sh
python3 docs/verification/app-storage/clear-web-data/instrument.py android
python3 docs/verification/app-storage/clear-web-data/instrument.py ios
```

Install each test app. Serve probe.html as index.html on a disposable loopback HTTP server at port 4173, with stage.json containing {"stage":"seed"}. Android uses a task-owned adb reverse for port 4173. Launch through the command returned by T3 device_open. Save the result, change stage.json to {"stage":"reopen"}, and relaunch through that command. The generated test branches do not ship in the Radical package.

## Cleanup

Both example apps are uninstalled. Device sessions are closed and both devices shut down. The task-owned Gradle daemon was stopped with ./gradlew --stop. The server, port reversal, generated native projects/builds, saved production copies, and temporary files are removed. Evidence and reproducible fixtures remain here.
