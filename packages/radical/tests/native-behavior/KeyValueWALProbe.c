#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "wal-config.h"

/* Standalone diagnostic, not production code. "seed" deliberately bypasses close. */
int main(int argc, char **argv) {
    if (argc < 4) return 2;
    sqlite3 *db = NULL;
    const char *mode = argv[1];
    int readonly = strncmp(mode, "ro", 2) == 0;
    int rc = sqlite3_open_v2(argv[2], &db, readonly ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL);
    if (strcmp(mode, "seed") == 0) {
        if (rc != SQLITE_OK) return 3;
        rc = sqlite3_exec(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT); INSERT INTO kv VALUES('key','one'); PRAGMA wal_checkpoint(TRUNCATE)", NULL, NULL, NULL);
        if (rc != SQLITE_OK) return 4;
        if (strcmp(argv[3], "nonempty") == 0 && sqlite3_exec(db, "UPDATE kv SET v='two' WHERE k='key'", NULL, NULL, NULL) != SQLITE_OK) return 5;
        _exit(0);
    }
    int noCheckpointRC = -1, noCheckpoint = 0, persistRC = -1, persist = 0;
    if (strstr(mode, "controls")) {
        noCheckpointRC = RadicalWalNoCheckpoint(db, &noCheckpoint);
        persistRC = RadicalWalPersist(db, &persist);
    }
    int exclusiveRC = -1;
    if (strstr(mode, "exclusive")) exclusiveRC = sqlite3_exec(db, "PRAGMA locking_mode=EXCLUSIVE", NULL, NULL, NULL);
    int query = sqlite3_exec(db, readonly ? "PRAGMA integrity_check(1)" : "PRAGMA journal_mode=WAL", NULL, NULL, NULL);
    int close = sqlite3_close(db);
    printf("{\"sqliteVersion\":\"%s\",\"open\":%d,\"query\":%d,\"close\":%d,\"noCheckpointRC\":%d,\"noCheckpoint\":%d,\"persistRC\":%d,\"persist\":%d,\"exclusiveRC\":%d}\n", sqlite3_libversion(), rc, query, close, noCheckpointRC, noCheckpoint, persistRC, persist, exclusiveRC);
    return 0;
}
