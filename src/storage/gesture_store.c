/*
 * Runtime gesture store -- Phase 3 implementation + Phase 5 sync to
 * kot149 trie + Option C breadcrumb logging.
 *
 * Layout:
 *   - mg_store_init() loads from Zephyr settings (key prefix "cmg/").
 *     If no saved data, seeds from DTS defaults.
 *   - Mutations call save() which writes the whole array as one blob.
 *   - Each mutation also calls sync_to_kot149() to push the new trie
 *     to the input processor. EXCEPT delete -- that has been disabled
 *     after the freeze investigation (see below).
 *   - Every checkpoint records a breadcrumb via mg_log_push for the
 *     GetLog RPC to read back later. See log_ring.h.
 */

#include "gesture_store.h"
#include "log_ring.h"

#include <errno.h>
#include <string.h>

#include <zephyr/devicetree.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys/util_macro.h>
#include <zephyr/settings/settings.h>
#include <zephyr/device.h>

#include <zmk/mouse_gesture/runtime.h>

#include <zephyr/logging/log.h>
LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* === Runtime array =================================================== */

static struct mg_gesture g_store[MG_MAX_GESTURES];
static size_t            g_count;
static uint32_t          g_next_id = 1;
static bool              g_loaded;

/* Settings (Phase 4). Defaults match kot149/zmk-mouse-gesture library defaults. */
static struct mg_settings g_settings = {
    .stroke_size         = 200,
    .idle_timeout_ms     = 150,
    .gesture_cooldown_ms = 500,
    .movement_threshold  = 0,
    .enable_eager_mode   = false,
    .always_active       = false,
};

/* === Phase 5: kot149 trie sync storage =================================
 * These arrays back the runtime gesture set we push to kot149's input
 * processor. The driver retains pointers into them via its trie nodes,
 * so they must outlive the trie (static storage = program lifetime).
 */
static struct gesture_pattern         g_kot_patterns[MG_MAX_GESTURES];
static uint8_t                        g_kot_pattern_bytes[MG_MAX_GESTURES][MG_PATTERN_MAX];
static struct zmk_behavior_binding    g_kot_bindings[MG_MAX_GESTURES][1];

/* Proto Direction (UP=0, RIGHT=1, DOWN=2, LEFT=3) -> kot149 GESTURE_*
 * bitmask (UP=1, DOWN=2, LEFT=4, RIGHT=8). */
static uint8_t proto_to_kot_direction(uint8_t d) {
    switch (d) {
    case 0: return 1; /* UP */
    case 1: return 8; /* RIGHT */
    case 2: return 2; /* DOWN */
    case 3: return 4; /* LEFT */
    default: return 1;
    }
}

static int sync_to_kot149(void) {
    mg_log_push(MG_LOG_SYNC_ENTER, 0, 0);
    size_t n = 0;
    for (size_t i = 0; i < MG_MAX_GESTURES && n < MG_MAX_GESTURES; i++) {
        if (!g_store[i].in_use || !g_store[i].enabled) continue;
        if (g_store[i].pattern_len == 0) continue;

        size_t plen = g_store[i].pattern_len;
        if (plen > MG_PATTERN_MAX) plen = MG_PATTERN_MAX;
        for (size_t j = 0; j < plen; j++) {
            g_kot_pattern_bytes[n][j] = proto_to_kot_direction(g_store[i].pattern[j]);
        }

        /* Best-effort: resolve the behavior name to a device. The
         * kot149 driver stores `behavior_dev` and looks it up later via
         * its name; we just hand the same string back. */
        g_kot_bindings[n][0].behavior_dev = g_store[i].binding_behavior;
        g_kot_bindings[n][0].param1       = g_store[i].binding_param1;
        g_kot_bindings[n][0].param2       = g_store[i].binding_param2;

        g_kot_patterns[n] = (struct gesture_pattern){
            .bindings_len = 1,
            .bindings     = g_kot_bindings[n],
            .pattern_len  = plen,
            .wait_ms      = 0,
            .tap_ms       = 0,
            .pattern      = g_kot_pattern_bytes[n],
        };
        n++;
    }
    mg_log_push(MG_LOG_SYNC_PATTERNS_BUILT, (uint32_t)n, 0);
    mg_log_push(MG_LOG_SYNC_RUNTIME_SET_PRE, (uint32_t)n, 0);
    int rc = zmk_mouse_gesture_runtime_set(g_kot_patterns, n);
    mg_log_push(MG_LOG_SYNC_RUNTIME_SET_POST, (uint32_t)n, (uint32_t)rc);
    if (rc) {
        LOG_WRN("mg_store: sync_to_kot149 failed: %d (n=%u)", rc, (unsigned)n);
    } else {
        LOG_INF("mg_store: synced %u gestures to kot149 trie", (unsigned)n);
    }
    mg_log_push(MG_LOG_SYNC_RETURN, (uint32_t)n, (uint32_t)rc);
    return rc;
}

/* === DTS defaults extraction (mirrors handler.c phase-2 walk) ======= */

#define MG_COMPAT zmk_input_processor_mouse_gesture
#define MG_NODE   DT_COMPAT_GET_ANY_STATUS_OKAY(MG_COMPAT)

/* kot149 GESTURE_* bitmask values. */
#define KOT_GESTURE_UP    1
#define KOT_GESTURE_DOWN  2
#define KOT_GESTURE_LEFT  4
#define KOT_GESTURE_RIGHT 8

static inline uint8_t kot_to_proto_direction(uint8_t d) {
    switch (d) {
    case KOT_GESTURE_UP:    return 0;
    case KOT_GESTURE_RIGHT: return 1;
    case KOT_GESTURE_DOWN:  return 2;
    case KOT_GESTURE_LEFT:  return 3;
    default:                return 0;
    }
}

struct mg_dts_default {
    const char    *name;
    const uint8_t *pattern;
    size_t         pattern_len;
    const char    *binding_behavior;
    uint32_t       binding_param1;
    uint32_t       binding_param2;
};

#if DT_NODE_EXISTS(MG_NODE)

#define APPEND_PATTERN_BYTE(node_id, prop, idx) DT_PROP_BY_IDX(node_id, prop, idx),

#define BINDING_BEHAVIOR(child)                                                                    \
    COND_CODE_1(DT_NODE_HAS_PROP(child, bindings),                                                 \
                (DEVICE_DT_NAME(DT_PHANDLE_BY_IDX(child, bindings, 0))),                           \
                (""))

#define BINDING_PARAM(child, name)                                                                 \
    COND_CODE_1(DT_NODE_HAS_PROP(child, bindings),                                                 \
                (COND_CODE_1(DT_PHA_HAS_CELL_AT_IDX(child, bindings, 0, name),                     \
                             (DT_PHA_BY_IDX(child, bindings, 0, name)),                            \
                             (0))),                                                                \
                (0))

#define MAKE_DEFAULT_ENTRY(child)                                                                  \
    {                                                                                              \
        .name = DT_NODE_FULL_NAME(child),                                                          \
        .pattern = (const uint8_t[]){                                                              \
            DT_FOREACH_PROP_ELEM(child, pattern, APPEND_PATTERN_BYTE) 0},                          \
        .pattern_len      = DT_PROP_LEN(child, pattern),                                           \
        .binding_behavior = BINDING_BEHAVIOR(child),                                               \
        .binding_param1   = BINDING_PARAM(child, param1),                                          \
        .binding_param2   = BINDING_PARAM(child, param2),                                          \
    },

static const struct mg_dts_default g_dts_defaults[] = {
    DT_FOREACH_CHILD(MG_NODE, MAKE_DEFAULT_ENTRY)
};
#define NUM_DTS_DEFAULTS ARRAY_SIZE(g_dts_defaults)

#else
static const struct mg_dts_default g_dts_defaults[1] = {{0}};
#define NUM_DTS_DEFAULTS 0
#endif

/* === Internal helpers ================================================ */

static void seed_from_dts(void) {
    memset(g_store, 0, sizeof(g_store));
    g_count   = 0;
    g_next_id = 1;

    size_t n = NUM_DTS_DEFAULTS;
    if (n > MG_MAX_GESTURES) n = MG_MAX_GESTURES;

    for (size_t i = 0; i < n; i++) {
        const struct mg_dts_default *d = &g_dts_defaults[i];
        struct mg_gesture *g = &g_store[i];

        g->in_use  = true;
        g->enabled = true;
        g->id      = g_next_id++;
        if (d->name) strncpy(g->name, d->name, sizeof(g->name) - 1);
        if (d->binding_behavior) {
            strncpy(g->binding_behavior, d->binding_behavior,
                    sizeof(g->binding_behavior) - 1);
        }

        size_t plen = d->pattern_len;
        if (plen > MG_PATTERN_MAX) plen = MG_PATTERN_MAX;
        g->pattern_len = plen;
        for (size_t j = 0; j < plen; j++) {
            g->pattern[j] = kot_to_proto_direction(d->pattern[j]);
        }
        g->binding_param1 = d->binding_param1;
        g->binding_param2 = d->binding_param2;
    }
    g_count = n;
}

/* Persist the whole store to settings. */
static int store_save(void) {
    int rc;
    uint32_t hdr[2] = {(uint32_t)g_count, g_next_id};
    rc = settings_save_one("cmg/hdr", hdr, sizeof(hdr));
    if (rc) {
        LOG_WRN("mg_store: save hdr failed: %d", rc);
        return rc;
    }
    rc = settings_save_one("cmg/data", g_store,
                           sizeof(struct mg_gesture) * MG_MAX_GESTURES);
    if (rc) {
        LOG_WRN("mg_store: save data failed: %d", rc);
        return rc;
    }
    return 0;
}

/* Zephyr settings load handler. */
static int store_set_cb(const char *name, size_t len, settings_read_cb read_cb,
                        void *cb_arg) {
    if (strcmp(name, "hdr") == 0) {
        uint32_t hdr[2] = {0};
        ssize_t got = read_cb(cb_arg, hdr, MIN(sizeof(hdr), len));
        if (got > 0) {
            g_count   = hdr[0];
            if (g_count > MG_MAX_GESTURES) g_count = MG_MAX_GESTURES;
            g_next_id = hdr[1];
            if (g_next_id == 0) g_next_id = 1;
            g_loaded = true;
        }
        return 0;
    }
    if (strcmp(name, "data") == 0) {
        ssize_t got = read_cb(cb_arg, g_store,
                              MIN(sizeof(g_store), len));
        if (got > 0) {
            g_loaded = true;
        }
        return 0;
    }
    if (strcmp(name, "settings") == 0) {
        (void)read_cb(cb_arg, &g_settings,
                      MIN(sizeof(g_settings), len));
        return 0;
    }
    return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(mg_store, "cmg", NULL, store_set_cb, NULL, NULL);

/* Validate gesture and copy into a slot. */
static int copy_into_slot(struct mg_gesture *slot,
                          const struct mg_gesture *src,
                          uint32_t id) {
    if (src->pattern_len == 0 || src->pattern_len > MG_PATTERN_MAX) {
        return -EINVAL;
    }
    memset(slot, 0, sizeof(*slot));
    slot->in_use      = true;
    slot->enabled     = src->enabled;
    slot->id          = id;
    slot->pattern_len = src->pattern_len;
    memcpy(slot->pattern, src->pattern, src->pattern_len);
    slot->binding_param1 = src->binding_param1;
    slot->binding_param2 = src->binding_param2;
    strncpy(slot->name, src->name, sizeof(slot->name) - 1);
    strncpy(slot->binding_behavior, src->binding_behavior,
            sizeof(slot->binding_behavior) - 1);
    return 0;
}

static struct mg_gesture *find_slot_by_id_mut(uint32_t id) {
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (g_store[i].in_use && g_store[i].id == id) {
            return &g_store[i];
        }
    }
    return NULL;
}

static int find_free_slot_index(void) {
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (!g_store[i].in_use) return (int)i;
    }
    return -1;
}

static void recount(void) {
    size_t c = 0;
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (g_store[i].in_use) c++;
    }
    g_count = c;
}

static void compact(void) {
    size_t dst = 0;
    for (size_t src = 0; src < MG_MAX_GESTURES; src++) {
        if (g_store[src].in_use) {
            if (src != dst) {
                g_store[dst] = g_store[src];
                memset(&g_store[src], 0, sizeof(g_store[src]));
            }
            dst++;
        }
    }
    g_count = dst;
}

/* === Public API ====================================================== */

int mg_store_init(void) {
    mg_log_push(MG_LOG_BOOT_ENTER, 0, 0);

    int rc = settings_subsys_init();
    if (rc) {
        LOG_WRN("mg_store: settings_subsys_init failed: %d", rc);
    }

    g_loaded = false;
    memset(g_store, 0, sizeof(g_store));
    g_count   = 0;
    g_next_id = 1;

    (void)settings_load_subtree("cmg");

    if (!g_loaded || g_count == 0) {
        LOG_INF("mg_store: no saved data, seeding from DTS defaults (n=%u)",
                (unsigned)NUM_DTS_DEFAULTS);
        seed_from_dts();
        mg_log_push(MG_LOG_BOOT_SEEDED, (uint32_t)NUM_DTS_DEFAULTS, 0);
        store_save();
    } else {
        recount();
        mg_log_push(MG_LOG_BOOT_LOADED, (uint32_t)g_count, 0);
        LOG_INF("mg_store: loaded %u gestures from NVS", (unsigned)g_count);
    }

    mg_log_push(MG_LOG_BOOT_SYNC_PRE, (uint32_t)g_count, 0);
    sync_to_kot149();
    mg_log_push(MG_LOG_BOOT_SYNC_POST, (uint32_t)g_count, 0);

    mg_log_push(MG_LOG_BOOT_DONE, (uint32_t)g_count, 0);
    return 0;
}

size_t mg_store_count(void) { return g_count; }

const struct mg_gesture *mg_store_at(size_t idx) {
    size_t seen = 0;
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (!g_store[i].in_use) continue;
        if (seen == idx) return &g_store[i];
        seen++;
    }
    return NULL;
}

const struct mg_gesture *mg_store_find(uint32_t id) {
    return find_slot_by_id_mut(id);
}

int mg_store_add(const struct mg_gesture *g, uint32_t *out_id) {
    mg_log_push(MG_LOG_ADD_ENTER, g->pattern_len, g->binding_param1);
    int slot = find_free_slot_index();
    if (slot < 0) return -ENOSPC;
    uint32_t id = g_next_id++;
    int rc = copy_into_slot(&g_store[slot], g, id);
    if (rc) {
        g_next_id--;
        return rc;
    }
    g_count++;
    if (out_id) *out_id = id;
    mg_log_push(MG_LOG_ADD_COPIED, id, (uint32_t)slot);
    rc = store_save();
    mg_log_push(MG_LOG_ADD_SAVED, id, (uint32_t)rc);
    sync_to_kot149();
    mg_log_push(MG_LOG_ADD_SYNCED, id, 0);
    mg_log_push(MG_LOG_ADD_RETURN, id, (uint32_t)rc);
    return rc;
}

int mg_store_update(const struct mg_gesture *g) {
    mg_log_push(MG_LOG_UPDATE_ENTER, g->id, 0);
    struct mg_gesture *slot = find_slot_by_id_mut(g->id);
    if (!slot) return -ENOENT;
    uint32_t keep_id = slot->id;
    int rc = copy_into_slot(slot, g, keep_id);
    if (rc) return rc;
    rc = store_save();
    mg_log_push(MG_LOG_UPDATE_SAVED, g->id, (uint32_t)rc);
    sync_to_kot149();
    mg_log_push(MG_LOG_UPDATE_SYNCED, g->id, 0);
    mg_log_push(MG_LOG_UPDATE_RETURN, g->id, (uint32_t)rc);
    return rc;
}

int mg_store_delete(uint32_t id) {
    mg_log_push(MG_LOG_DELETE_ENTER, id, 0);
    struct mg_gesture *slot = find_slot_by_id_mut(id);
    if (!slot) return -ENOENT;
    memset(slot, 0, sizeof(*slot));
    compact();
    mg_log_push(MG_LOG_DELETE_COMPACTED, id, (uint32_t)g_count);
    int rc = store_save();
    mg_log_push(MG_LOG_DELETE_SAVED, id, (uint32_t)rc);
    /* sync_to_kot149() intentionally skipped here -- caused freeze in
     * the previous investigation. Will revisit once log_ring tells us
     * exactly where runtime_set hangs. */
    mg_log_push(MG_LOG_DELETE_RETURN, id, (uint32_t)rc);
    return rc;
}

int mg_store_reset_to_defaults(void) {
    mg_log_push(MG_LOG_RESET_ENTER, 0, 0);
    seed_from_dts();
    mg_log_push(MG_LOG_RESET_SEEDED, (uint32_t)g_count, 0);
    int rc = store_save();
    mg_log_push(MG_LOG_RESET_SAVED, (uint32_t)g_count, (uint32_t)rc);
    sync_to_kot149();
    mg_log_push(MG_LOG_RESET_SYNCED, (uint32_t)g_count, 0);
    mg_log_push(MG_LOG_RESET_RETURN, (uint32_t)g_count, (uint32_t)rc);
    return rc;
}

/* === Settings (Phase 4) ============================================== */

void mg_settings_get(struct mg_settings *out) {
    if (out) *out = g_settings;
}

int mg_settings_set(const struct mg_settings *s) {
    if (!s) return -EINVAL;
    g_settings = *s;
    int rc = settings_save_one("cmg/settings", &g_settings, sizeof(g_settings));
    if (rc) {
        LOG_WRN("mg_store: save settings failed: %d", rc);
    }
    return rc;
}
/*
 * Runtime gesture store — Phase 3 implementation.
 *
 * Layout:
 *   - mg_store_init() loads from Zephyr settings (key prefix "cmg/").
 *     If no saved data, seeds from DTS defaults (extracted via the same
 *     DT macros that the firmware's compile-time trie uses, so the seed
 *     matches what kot149 actually matches today).
 *   - Mutations call save() which writes the whole array as one blob.
 *     Simpler than per-slot keys; the blob is at most ~6KB.
 */

#include "gesture_store.h"

#include <errno.h>
#include <string.h>

#include <zephyr/devicetree.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys/util_macro.h>
#include <zephyr/settings/settings.h>
#include <zephyr/device.h>

#include <zmk/mouse_gesture/runtime.h>

#include <zephyr/logging/log.h>
LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* === Runtime array =================================================== */

static struct mg_gesture g_store[MG_MAX_GESTURES];
static size_t            g_count;
static uint32_t          g_next_id = 1;
static bool              g_loaded;

/* Settings (Phase 4). Defaults match kot149/zmk-mouse-gesture library defaults. */
static struct mg_settings g_settings = {
    .stroke_size         = 200,
    .idle_timeout_ms     = 150,
    .gesture_cooldown_ms = 500,
    .movement_threshold  = 0,
    .enable_eager_mode   = false,
    .always_active       = false,
};

/* === Phase 5: kot149 trie sync storage =================================
 * These arrays back the runtime gesture set we push to kot149's input
 * processor. The driver retains pointers into them via its trie nodes,
 * so they must outlive the trie (static storage = program lifetime).
 */
static struct gesture_pattern         g_kot_patterns[MG_MAX_GESTURES];
static uint8_t                        g_kot_pattern_bytes[MG_MAX_GESTURES][MG_PATTERN_MAX];
static struct zmk_behavior_binding    g_kot_bindings[MG_MAX_GESTURES][1];

/* Proto Direction (UP=0, RIGHT=1, DOWN=2, LEFT=3) -> kot149 GESTURE_*
 * bitmask (UP=1, DOWN=2, LEFT=4, RIGHT=8). */
static uint8_t proto_to_kot_direction(uint8_t d) {
    switch (d) {
    case 0: return 1; /* UP */
    case 1: return 8; /* RIGHT */
    case 2: return 2; /* DOWN */
    case 3: return 4; /* LEFT */
    default: return 1;
    }
}

static int sync_to_kot149(void) {
    size_t n = 0;
    for (size_t i = 0; i < MG_MAX_GESTURES && n < MG_MAX_GESTURES; i++) {
        if (!g_store[i].in_use || !g_store[i].enabled) continue;
        if (g_store[i].pattern_len == 0) continue;

        size_t plen = g_store[i].pattern_len;
        if (plen > MG_PATTERN_MAX) plen = MG_PATTERN_MAX;
        for (size_t j = 0; j < plen; j++) {
            g_kot_pattern_bytes[n][j] = proto_to_kot_direction(g_store[i].pattern[j]);
        }

        g_kot_bindings[n][0].behavior_dev = g_store[i].binding_behavior;
        g_kot_bindings[n][0].param1       = g_store[i].binding_param1;
        g_kot_bindings[n][0].param2       = g_store[i].binding_param2;

        g_kot_patterns[n] = (struct gesture_pattern){
            .bindings_len = 1,
            .bindings     = g_kot_bindings[n],
            .pattern_len  = plen,
            .wait_ms      = 0,
            .tap_ms       = 0,
            .pattern      = g_kot_pattern_bytes[n],
        };
        n++;
    }
    int rc = zmk_mouse_gesture_runtime_set(g_kot_patterns, n);
    if (rc) {
        LOG_WRN("mg_store: sync_to_kot149 failed: %d (n=%u)", rc, (unsigned)n);
    } else {
        LOG_INF("mg_store: synced %u gestures to kot149 trie", (unsigned)n);
    }
    return rc;
}

/* === DTS defaults extraction (mirrors handler.c phase-2 walk) ======= */

#define MG_COMPAT zmk_input_processor_mouse_gesture
#define MG_NODE   DT_COMPAT_GET_ANY_STATUS_OKAY(MG_COMPAT)

/* kot149 GESTURE_* bitmask values. */
#define KOT_GESTURE_UP    1
#define KOT_GESTURE_DOWN  2
#define KOT_GESTURE_LEFT  4
#define KOT_GESTURE_RIGHT 8

static inline uint8_t kot_to_proto_direction(uint8_t d) {
    switch (d) {
    case KOT_GESTURE_UP:    return 0;
    case KOT_GESTURE_RIGHT: return 1;
    case KOT_GESTURE_DOWN:  return 2;
    case KOT_GESTURE_LEFT:  return 3;
    default:                return 0;
    }
}

/* Always-visible struct so the #else branch compiles too. */
struct mg_dts_default {
    const char    *name;
    const uint8_t *pattern;
    size_t         pattern_len;
    const char    *binding_behavior;
    uint32_t       binding_param1;
    uint32_t       binding_param2;
};

#if DT_NODE_EXISTS(MG_NODE)

#define APPEND_PATTERN_BYTE(node_id, prop, idx) DT_PROP_BY_IDX(node_id, prop, idx),

#define BINDING_BEHAVIOR(child)                                                                    \
    COND_CODE_1(DT_NODE_HAS_PROP(child, bindings),                                                 \
                (DEVICE_DT_NAME(DT_PHANDLE_BY_IDX(child, bindings, 0))),                           \
                (""))

#define BINDING_PARAM(child, name)                                                                 \
    COND_CODE_1(DT_NODE_HAS_PROP(child, bindings),                                                 \
                (COND_CODE_1(DT_PHA_HAS_CELL_AT_IDX(child, bindings, 0, name),                     \
                             (DT_PHA_BY_IDX(child, bindings, 0, name)),                            \
                             (0))),                                                                \
                (0))

#define MAKE_DEFAULT_ENTRY(child)                                                                  \
    {                                                                                              \
        .name = DT_NODE_FULL_NAME(child),                                                          \
        .pattern = (const uint8_t[]){                                                              \
            DT_FOREACH_PROP_ELEM(child, pattern, APPEND_PATTERN_BYTE) 0},                          \
        .pattern_len      = DT_PROP_LEN(child, pattern),                                           \
        .binding_behavior = BINDING_BEHAVIOR(child),                                               \
        .binding_param1   = BINDING_PARAM(child, param1),                                          \
        .binding_param2   = BINDING_PARAM(child, param2),                                          \
    },

static const struct mg_dts_default g_dts_defaults[] = {
    DT_FOREACH_CHILD(MG_NODE, MAKE_DEFAULT_ENTRY)
};
#define NUM_DTS_DEFAULTS ARRAY_SIZE(g_dts_defaults)

#else
static const struct mg_dts_default g_dts_defaults[1] = {{0}};
#define NUM_DTS_DEFAULTS 0
#endif

/* === Internal helpers ================================================ */

static void seed_from_dts(void) {
    memset(g_store, 0, sizeof(g_store));
    g_count   = 0;
    g_next_id = 1;

    size_t n = NUM_DTS_DEFAULTS;
    if (n > MG_MAX_GESTURES) n = MG_MAX_GESTURES;

    for (size_t i = 0; i < n; i++) {
        const struct mg_dts_default *d = &g_dts_defaults[i];
        struct mg_gesture *g = &g_store[i];

        g->in_use  = true;
        g->enabled = true;
        g->id      = g_next_id++;
        if (d->name) strncpy(g->name, d->name, sizeof(g->name) - 1);
        if (d->binding_behavior) {
            strncpy(g->binding_behavior, d->binding_behavior,
                    sizeof(g->binding_behavior) - 1);
        }

        size_t plen = d->pattern_len;
        if (plen > MG_PATTERN_MAX) plen = MG_PATTERN_MAX;
        g->pattern_len = plen;
        for (size_t j = 0; j < plen; j++) {
            g->pattern[j] = kot_to_proto_direction(d->pattern[j]);
        }
        g->binding_param1 = d->binding_param1;
        g->binding_param2 = d->binding_param2;
    }
    g_count = n;
}

/* Persist the whole store to settings. */
static int store_save(void) {
    int rc;
    /* The blob: [count:4][next_id:4][gestures...] */
    uint32_t hdr[2] = {(uint32_t)g_count, g_next_id};
    rc = settings_save_one("cmg/hdr", hdr, sizeof(hdr));
    if (rc) {
        LOG_WRN("mg_store: save hdr failed: %d", rc);
        return rc;
    }
    rc = settings_save_one("cmg/data", g_store,
                           sizeof(struct mg_gesture) * MG_MAX_GESTURES);
    if (rc) {
        LOG_WRN("mg_store: save data failed: %d", rc);
        return rc;
    }
    return 0;
}

/* Zephyr settings load handler. */
static int store_set_cb(const char *name, size_t len, settings_read_cb read_cb,
                        void *cb_arg) {
    if (strcmp(name, "hdr") == 0) {
        uint32_t hdr[2] = {0};
        ssize_t got = read_cb(cb_arg, hdr, MIN(sizeof(hdr), len));
        if (got > 0) {
            g_count   = hdr[0];
            if (g_count > MG_MAX_GESTURES) g_count = MG_MAX_GESTURES;
            g_next_id = hdr[1];
            if (g_next_id == 0) g_next_id = 1;
            g_loaded = true;
        }
        return 0;
    }
    if (strcmp(name, "data") == 0) {
        ssize_t got = read_cb(cb_arg, g_store,
                              MIN(sizeof(g_store), len));
        if (got > 0) {
            g_loaded = true;
        }
        return 0;
    }
    if (strcmp(name, "settings") == 0) {
        (void)read_cb(cb_arg, &g_settings,
                      MIN(sizeof(g_settings), len));
        return 0;
    }
    return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(mg_store, "cmg", NULL, store_set_cb, NULL, NULL);

/* Validate gesture and copy into a slot. */
static int copy_into_slot(struct mg_gesture *slot,
                          const struct mg_gesture *src,
                          uint32_t id) {
    if (src->pattern_len == 0 || src->pattern_len > MG_PATTERN_MAX) {
        return -EINVAL;
    }
    memset(slot, 0, sizeof(*slot));
    slot->in_use      = true;
    slot->enabled     = src->enabled;
    slot->id          = id;
    slot->pattern_len = src->pattern_len;
    memcpy(slot->pattern, src->pattern, src->pattern_len);
    slot->binding_param1 = src->binding_param1;
    slot->binding_param2 = src->binding_param2;
    strncpy(slot->name, src->name, sizeof(slot->name) - 1);
    strncpy(slot->binding_behavior, src->binding_behavior,
            sizeof(slot->binding_behavior) - 1);
    return 0;
}

static struct mg_gesture *find_slot_by_id_mut(uint32_t id) {
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (g_store[i].in_use && g_store[i].id == id) {
            return &g_store[i];
        }
    }
    return NULL;
}

static int find_free_slot_index(void) {
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (!g_store[i].in_use) return (int)i;
    }
    return -1;
}

static void recount(void) {
    size_t c = 0;
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (g_store[i].in_use) c++;
    }
    g_count = c;
}

/* Compact: move in_use entries to the front so iteration is contiguous. */
static void compact(void) {
    size_t dst = 0;
    for (size_t src = 0; src < MG_MAX_GESTURES; src++) {
        if (g_store[src].in_use) {
            if (src != dst) {
                g_store[dst] = g_store[src];
                memset(&g_store[src], 0, sizeof(g_store[src]));
            }
            dst++;
        }
    }
    g_count = dst;
}

/* === Public API ====================================================== */

int mg_store_init(void) {
    int rc = settings_subsys_init();
    if (rc) {
        LOG_WRN("mg_store: settings_subsys_init failed: %d", rc);
    }

    g_loaded = false;
    memset(g_store, 0, sizeof(g_store));
    g_count   = 0;
    g_next_id = 1;

    (void)settings_load_subtree("cmg");

    if (!g_loaded || g_count == 0) {
        LOG_INF("mg_store: no saved data, seeding from DTS defaults (n=%u)",
                (unsigned)NUM_DTS_DEFAULTS);
        seed_from_dts();
        store_save();
    } else {
        recount();
        LOG_INF("mg_store: loaded %u gestures from NVS", (unsigned)g_count);
    }
    /* Push the loaded/seeded store to kot149's runtime trie. */
    sync_to_kot149();
    return 0;
}

size_t mg_store_count(void) { return g_count; }

const struct mg_gesture *mg_store_at(size_t idx) {
    size_t seen = 0;
    for (size_t i = 0; i < MG_MAX_GESTURES; i++) {
        if (!g_store[i].in_use) continue;
        if (seen == idx) return &g_store[i];
        seen++;
    }
    return NULL;
}

const struct mg_gesture *mg_store_find(uint32_t id) {
    return find_slot_by_id_mut(id);
}

int mg_store_add(const struct mg_gesture *g, uint32_t *out_id) {
    int slot = find_free_slot_index();
    if (slot < 0) return -ENOSPC;
    uint32_t id = g_next_id++;
    int rc = copy_into_slot(&g_store[slot], g, id);
    if (rc) {
        g_next_id--;
        return rc;
    }
    g_count++;
    if (out_id) *out_id = id;
    rc = store_save();
    sync_to_kot149();
    return rc;
}

int mg_store_update(const struct mg_gesture *g) {
    struct mg_gesture *slot = find_slot_by_id_mut(g->id);
    if (!slot) return -ENOENT;
    uint32_t keep_id = slot->id;
    int rc = copy_into_slot(slot, g, keep_id);
    if (rc) return rc;
    rc = store_save();
    sync_to_kot149();
    return rc;
}

int mg_store_delete(uint32_t id) {
    struct mg_gesture *slot = find_slot_by_id_mut(id);
    if (!slot) return -ENOENT;
    memset(slot, 0, sizeof(*slot));
    compact();
    int rc = store_save();
    /* sync_to_kot149(); */
    return rc;
}

int mg_store_reset_to_defaults(void) {
    seed_from_dts();
    int rc = store_save();
    sync_to_kot149();
    return rc;
}

/* === Settings (Phase 4) ============================================== */

void mg_settings_get(struct mg_settings *out) {
    if (out) *out = g_settings;
}

int mg_settings_set(const struct mg_settings *s) {
    if (!s) return -EINVAL;
    g_settings = *s;
    int rc = settings_save_one("cmg/settings", &g_settings, sizeof(g_settings));
    if (rc) {
        LOG_WRN("mg_store: save settings failed: %d", rc);
    }
    return rc;
}
