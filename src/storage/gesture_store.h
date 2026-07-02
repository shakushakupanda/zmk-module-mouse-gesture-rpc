/*
 * Runtime gesture store — Phase 3.
 *
 * Holds the user-editable list of mouse gestures in RAM, persists changes
 * to Zephyr settings (NVS), and seeds itself from the kot149 DTS defaults
 * on first boot or after a reset-to-defaults RPC.
 *
 * The actual gesture *matching* engine is still kot149's compile-time
 * trie. This store provides the configuration surface; wiring the store
 * into a runtime trie that overrides kot149's behavior is Phase 4+.
 */

#ifndef MG_GESTURE_STORE_H
#define MG_GESTURE_STORE_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#define MG_NAME_MAX     32
#define MG_BEHAVIOR_MAX 16
#define MG_PATTERN_MAX  8

/* Number of independent gesture sets, addressable by `&mg_set N`.
 * Each set has its own list of gestures (typically one per direction). */
#ifndef CONFIG_ZMK_MOUSE_GESTURE_RPC_NUM_SETS
#define CONFIG_ZMK_MOUSE_GESTURE_RPC_NUM_SETS 5
#endif
#define MG_NUM_SETS CONFIG_ZMK_MOUSE_GESTURE_RPC_NUM_SETS

/* Maximum gestures the store can hold across all sets. Hard-bounded by the
 * proto ListGesturesResponse.gestures max_count (32). */
#ifndef CONFIG_ZMK_MOUSE_GESTURE_RPC_MAX_GESTURES
#define CONFIG_ZMK_MOUSE_GESTURE_RPC_MAX_GESTURES 32
#endif
#define MG_MAX_GESTURES CONFIG_ZMK_MOUSE_GESTURE_RPC_MAX_GESTURES

/* Single gesture record. Directions use the proto Direction values
 * (UP=0, RIGHT=1, DOWN=2, LEFT=3), NOT kot149's bitmask. */
struct mg_gesture {
    uint32_t id;
    bool     in_use;             /* false = slot is free */
    bool     enabled;
    uint8_t  pattern_len;
    uint8_t  pattern[MG_PATTERN_MAX];
    uint32_t binding_param1;
    uint32_t binding_param2;
    uint32_t set_id;             /* which activation set this gesture belongs to (0..MG_NUM_SETS-1) */
    char     name[MG_NAME_MAX];
    char     binding_behavior[MG_BEHAVIOR_MAX];
};

/* Initialize the store. Loads from NVS settings if present, otherwise
 * seeds from kot149 DTS defaults. Idempotent. */
int mg_store_init(void);

/* Number of in-use entries. */
size_t mg_store_count(void);

/* Iterate. Returns NULL when idx >= count. The pointer is owned by the
 * store and remains valid until the next mutating call. */
const struct mg_gesture *mg_store_at(size_t idx);

/* Find by id. NULL if missing. */
const struct mg_gesture *mg_store_find(uint32_t id);

/* Create a new gesture. The caller provides the gesture record; the
 * store assigns a fresh id and copies the data. On success, *out_id is
 * set to the new id. Returns -ENOSPC if full, -EINVAL if pattern empty. */
int mg_store_add(const struct mg_gesture *g, uint32_t *out_id);

/* Update an existing gesture in place. Returns -ENOENT if missing. */
int mg_store_update(const struct mg_gesture *g);

/* Delete by id. Returns -ENOENT if missing. */
int mg_store_delete(uint32_t id);

/* Wipe the store and re-seed from DTS defaults. */
int mg_store_reset_to_defaults(void);

/* === Multi-set (Approach D) =========================================== */

/* Set the active set and push that set's gestures to kot149's trie.
 * Called by the `&mg_set N` behavior on press. Returns 0 on success,
 * -EINVAL if set_id is out of range. */
int mg_store_activate_set(uint32_t set_id);

/* Read the currently active set id. */
uint32_t mg_store_active_set(void);

/* === Settings (Phase 4) ============================================== */

struct mg_settings {
    uint32_t stroke_size;         /* pixels per stroke (default 200) */
    uint32_t idle_timeout_ms;     /* idle delay before fire (default 150) */
    uint32_t gesture_cooldown_ms; /* suppress further gestures (default 500) */
    uint32_t movement_threshold;  /* ignore deltas below this (default 0) */
    bool     enable_eager_mode;
    bool     always_active;

    bool     inertial_scroll_enabled;
    uint32_t inertial_scroll_tick_ms;
    uint32_t inertial_scroll_idle_ms;
    uint32_t inertial_scroll_decay_percent;
    uint32_t inertial_scroll_impulse_percent;
    uint32_t inertial_scroll_min_velocity_q8;
    uint32_t inertial_scroll_max_ticks;
};

/* Read the current settings (post-NVS-load) into *out. */
void mg_settings_get(struct mg_settings *out);

/* Replace settings + persist. Returns 0 on success. */
int mg_settings_set(const struct mg_settings *s);

#endif /* MG_GESTURE_STORE_H */
