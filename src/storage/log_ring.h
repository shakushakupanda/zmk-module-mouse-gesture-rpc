/*
 * Lightweight RAM ring buffer for breadcrumb logging.
 *
 * Phase 5 freeze debugging aid: the firmware records short (timestamp,
 * code, args) tuples at each checkpoint. After a freeze, if the RPC
 * thread is still serviceable, the host can read the ring via the
 * GetLog RPC and inspect where the firmware got stuck.
 */

#ifndef MG_LOG_RING_H
#define MG_LOG_RING_H

#include <stdint.h>
#include <stddef.h>

#ifndef MG_LOG_RING_SIZE
#define MG_LOG_RING_SIZE 32
#endif

/* Checkpoint codes. Packed as 0xMMSS  MM = module, SS = step. */
enum mg_log_code {
    /* boot init (0x00) */
    MG_LOG_BOOT_ENTER             = 0x0001,
    MG_LOG_BOOT_LOADED            = 0x0002,
    MG_LOG_BOOT_SEEDED            = 0x0003,
    MG_LOG_BOOT_SYNC_PRE          = 0x0004,
    MG_LOG_BOOT_SYNC_POST         = 0x0005,
    MG_LOG_BOOT_DONE              = 0x0006,

    /* mg_store_add (0x01) */
    MG_LOG_ADD_ENTER              = 0x0101,
    MG_LOG_ADD_COPIED             = 0x0102,
    MG_LOG_ADD_SAVED              = 0x0103,
    MG_LOG_ADD_SYNCED             = 0x0104,
    MG_LOG_ADD_RETURN             = 0x0105,

    /* mg_store_update (0x02) */
    MG_LOG_UPDATE_ENTER           = 0x0201,
    MG_LOG_UPDATE_SAVED           = 0x0202,
    MG_LOG_UPDATE_SYNCED          = 0x0203,
    MG_LOG_UPDATE_RETURN          = 0x0204,

    /* mg_store_delete (0x03) */
    MG_LOG_DELETE_ENTER           = 0x0301,
    MG_LOG_DELETE_COMPACTED       = 0x0302,
    MG_LOG_DELETE_SAVED           = 0x0303,
    MG_LOG_DELETE_RETURN          = 0x0304,

    /* mg_store_reset_to_defaults (0x04) */
    MG_LOG_RESET_ENTER            = 0x0401,
    MG_LOG_RESET_SEEDED           = 0x0402,
    MG_LOG_RESET_SAVED            = 0x0403,
    MG_LOG_RESET_SYNCED           = 0x0404,
    MG_LOG_RESET_RETURN           = 0x0405,

    /* sync_to_kot149 (0x05) */
    MG_LOG_SYNC_ENTER             = 0x0501,
    MG_LOG_SYNC_PATTERNS_BUILT    = 0x0502,
    MG_LOG_SYNC_RUNTIME_SET_PRE   = 0x0503,
    MG_LOG_SYNC_RUNTIME_SET_POST  = 0x0504,
    MG_LOG_SYNC_RETURN            = 0x0505,

    /* RPC dispatcher (0x06) */
    MG_LOG_RPC_ENTER              = 0x0601,
    MG_LOG_RPC_DECODE_OK          = 0x0602,
    MG_LOG_RPC_DECODE_FAIL        = 0x0603,
    MG_LOG_RPC_DISPATCH           = 0x0604,
    MG_LOG_RPC_HANDLER_RETURN     = 0x0605,

    /* &mg_set behavior (0x07) */
    MG_LOG_MGSET_PRESSED          = 0x0701,
    MG_LOG_MGSET_RELEASED         = 0x0702,
    MG_LOG_MGSET_ACTIVATED        = 0x0703,
};

struct mg_log_entry {
    uint32_t ts_ms;
    uint32_t code;
    uint32_t arg1;
    uint32_t arg2;
};

/* Append a breadcrumb. Safe from any thread. */
void mg_log_push(uint32_t code, uint32_t arg1, uint32_t arg2);

/* Copy up to max_count most-recent entries into `out` (oldest first).
 * Returns the number actually copied. */
size_t mg_log_get(struct mg_log_entry *out, size_t max_count);

/* Drop everything. */
void mg_log_clear(void);

#endif /* MG_LOG_RING_H */
