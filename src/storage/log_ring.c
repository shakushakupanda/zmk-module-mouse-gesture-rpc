/*
 * Lightweight RAM ring buffer for breadcrumb logging.
 * See log_ring.h for the rationale.
 */

#include "log_ring.h"

#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/atomic.h>

#define RING_SIZE MG_LOG_RING_SIZE

static struct mg_log_entry g_ring[RING_SIZE];
static atomic_t            g_seq;   /* monotonic write counter */

/* Note: best-effort, no locking. If two threads race for the same slot
 * (rare with single RPC thread + a few work handlers) the entry may be
 * slightly garbled. Push must be cheap and callable from any context. */
void mg_log_push(uint32_t code, uint32_t arg1, uint32_t arg2) {
    atomic_val_t prev = atomic_inc(&g_seq);   /* returns old value */
    size_t pos = ((uint32_t)prev) % RING_SIZE;
    g_ring[pos].ts_ms = (uint32_t)k_uptime_get();
    g_ring[pos].code  = code;
    g_ring[pos].arg1  = arg1;
    g_ring[pos].arg2  = arg2;
}

size_t mg_log_get(struct mg_log_entry *out, size_t max_count) {
    atomic_val_t seq = atomic_get(&g_seq);
    uint32_t total = (uint32_t)seq;
    size_t available = total < RING_SIZE ? total : RING_SIZE;
    if (max_count < available) available = max_count;

    /* Oldest in-ring entry is at (seq - available) mod RING_SIZE */
    uint32_t start = (total - (uint32_t)available) % RING_SIZE;
    for (size_t i = 0; i < available; i++) {
        out[i] = g_ring[(start + i) % RING_SIZE];
    }
    return available;
}

void mg_log_clear(void) {
    atomic_set(&g_seq, 0);
    memset(g_ring, 0, sizeof(g_ring));
}
