#include <sqlite3.h>
#include "wal-config.h"
int RadicalWalNoCheckpoint(void *database, int *enabled) {
    return sqlite3_db_config((sqlite3 *)database, SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, 1, enabled);
}
int RadicalWalPersist(void *database, int *enabled) {
    int value = 1;
    int rc = sqlite3_file_control((sqlite3 *)database, "main", SQLITE_FCNTL_PERSIST_WAL, &value);
    if (rc != SQLITE_OK) return rc;
    *enabled = -1;
    return sqlite3_file_control((sqlite3 *)database, "main", SQLITE_FCNTL_PERSIST_WAL, enabled);
}
