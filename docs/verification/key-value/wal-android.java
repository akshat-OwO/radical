            if (key.startsWith("__fixture_")) {
                File database = new File(root, "key-value.sqlite");
                if (key.equals("__fixture_crash")) Runtime.getRuntime().halt(0);
                if (key.equals("__fixture_seed")) {
                    SQLiteDatabase seed = SQLiteDatabase.openDatabase(database.getPath(), null,
                        SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                        PRESERVE_CORRUPT_DATABASE);
                    seed.execSQL("PRAGMA synchronous=FULL");
                    seed.execSQL("CREATE TABLE radical_kv(namespace TEXT,key TEXT,json TEXT,PRIMARY KEY(namespace,key))");
                    seed.execSQL("INSERT INTO radical_kv VALUES(?,?,?)", new Object[]{call.getString("namespace"),"key","1"});
                    try (Cursor checkpoint = seed.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) { while (checkpoint.moveToNext()) {} }
                    if ("nonempty".equals(call.getString("walFixture"))) seed.execSQL("UPDATE radical_kv SET json=? WHERE key=?", new Object[]{"2","key"});
                    WAL_SEEDS.add(seed);
                    call.resolve(new JSObject());
                    return;
                }
                if (key.equals("__fixture_mid")) {
                    SQLiteDatabase db = CONNECTIONS.get(identity(call)).database;
                    db.execSQL("CREATE TABLE wal_marker(value TEXT)");
                    db.execSQL("INSERT INTO wal_marker VALUES(?)", new Object[]{"one"});
                    JSObject settings = new JSObject();
                    db.beginTransactionNonExclusive();
                    try {
                        for (String pragma : new String[]{"synchronous", "wal_autocheckpoint"}) {
                            try (Cursor value = db.rawQuery("PRAGMA " + pragma, null)) {
                                if (!value.moveToFirst()) throw new java.io.IOException();
                                settings.put(pragma, value.getInt(0));
                            }
                        }
                        db.setTransactionSuccessful();
                    } finally { db.endTransaction(); }
                    SETTINGS.put(identity(call), settings);
                    try (Cursor checkpoint = db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) { while (checkpoint.moveToNext()) {} }
                    long pageSize;
                    try (Cursor size = db.rawQuery("PRAGMA page_size", null)) { size.moveToFirst(); pageSize = size.getLong(0); }
                    java.util.List<Long> offsets = new java.util.ArrayList<>();
                    try (Cursor pages = db.rawQuery("SELECT rootpage FROM sqlite_master WHERE tbl_name=? AND rootpage>0", new String[]{"radical_kv"})) {
                        while (pages.moveToNext()) offsets.add((pages.getLong(0) - 1) * pageSize);
                    }
                    // Invalidate the writer's page cache through a separate commit.
                    try (SQLiteDatabase other = SQLiteDatabase.openDatabase(database.getPath(), null,
                        SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING | SQLiteDatabase.NO_LOCALIZED_COLLATORS, PRESERVE_CORRUPT_DATABASE)) {
                        other.execSQL("PRAGMA synchronous=FULL");
                        other.execSQL("UPDATE wal_marker SET value=?", new Object[]{"two"});
                    }
                    try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(database, "rw")) {
                        for (long offset : offsets) { file.seek(offset); file.writeByte(255); }
                        file.getFD().sync();
                    }
                }
                if (key.equals("__fixture_damage")) {
                    try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(database, "rw")) {
                        file.seek(100); file.writeByte(255); file.getFD().sync();
                    }
                    if ("orphan-shm".equals(call.getString("walFixture"))) {
                        File wal = new File(database.getPath() + "-wal");
                        if (wal.exists() && !wal.delete()) throw new java.io.IOException();
                    }
                }
                JSObject files = new JSObject();
                String[] names = {"database", "wal", "shm", "journal"};
                String[] suffixes = {"", "-wal", "-shm", "-journal"};
                for (int index = 0; index < names.length; index++) {
                    File target = new File(database.getPath() + suffixes[index]);
                    JSObject file = new JSObject();
                    file.put("exists", target.exists());
                    if (target.exists()) {
                        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
                        try (java.io.FileInputStream input = new java.io.FileInputStream(target)) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                        }
                        StringBuilder hex = new StringBuilder();
                        for (byte value : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                        file.put("bytes", target.length()); file.put("sha256", hex.toString());
                    }
                    files.put(names[index], file);
                }
                StoreConnection cached = CONNECTIONS.get(identity(call));
                JSObject result = new JSObject();
                result.put("files", files);
                result.put("preflights", PREFLIGHTS.getOrDefault(database.getPath(), 0));
                result.put("operations", OPERATIONS.getOrDefault(identity(call), 0));
                result.put("quarantined", cached != null && cached.quarantined);
                result.put("handleRetained", cached != null && cached.database != null);
                if (SETTINGS.containsKey(identity(call))) result.put("settings", SETTINGS.get(identity(call)));
                call.resolve(result);
                return;
            }
