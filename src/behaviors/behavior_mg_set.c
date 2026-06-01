/*
 * Custom ZMK behavior: `&mg_set N`.
 *
 * On press: ask the gesture store to activate set N (which re-syncs
 * kot149's trie to that set's gestures), then raise the mouse_gesture
 * state-changed ON event so kot149's matcher engages.
 *
 * On release: refcount-decrement; when no `&mg_set` is held anymore,
 * raise the state-changed OFF event so kot149's matcher fires the
 * matched gesture (if any) and disengages.
 *
 * Multiple keys held: each press switches the active set; the matcher
 * stays ON until the LAST key is released. This is the natural Logicool
 * behavior — you can transition between sets without losing gesture mode.
 */

#define DT_DRV_COMPAT zmk_behavior_mg_set

#include <zephyr/device.h>
#include <zephyr/logging/log.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/atomic.h>
#include <drivers/behavior.h>

#include <zmk/behavior.h>
#include <zmk/events/mouse_gesture_state_changed.h>

#include "../storage/gesture_store.h"
#include "../storage/log_ring.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)

/* Global refcount of currently-held mg_set keys. Atomic for thread safety. */
static atomic_t g_held_count;

static void raise_state(bool is_active) {
    raise_zmk_mouse_gesture_state_changed((struct zmk_mouse_gesture_state_changed){
        .is_active = is_active
    });
}

static int on_pressed(struct zmk_behavior_binding *binding,
                      struct zmk_behavior_binding_event event) {
    ARG_UNUSED(event);
    uint32_t set_id = binding->param1;

    mg_log_push(MG_LOG_MGSET_PRESSED, set_id, (uint32_t)atomic_get(&g_held_count));

    int rc = mg_store_activate_set(set_id);
    if (rc) {
        LOG_WRN("mg_set: activate_set(%u) failed: %d", (unsigned)set_id, rc);
    }
    mg_log_push(MG_LOG_MGSET_ACTIVATED, set_id, (uint32_t)rc);

    /* If this is the first key held, turn matcher ON. */
    atomic_val_t prev = atomic_inc(&g_held_count);
    if (prev == 0) {
        raise_state(true);
    }

    return ZMK_BEHAVIOR_OPAQUE;
}

static int on_released(struct zmk_behavior_binding *binding,
                       struct zmk_behavior_binding_event event) {
    ARG_UNUSED(event);
    ARG_UNUSED(binding);

    mg_log_push(MG_LOG_MGSET_RELEASED, binding->param1,
                (uint32_t)atomic_get(&g_held_count));

    /* If this was the last key held, turn matcher OFF (fires matched gesture). */
    atomic_val_t prev = atomic_dec(&g_held_count);
    if (prev == 1) {
        raise_state(false);
    } else if (prev <= 0) {
        /* Safety: shouldn't happen, but reset to 0 if it does. */
        atomic_set(&g_held_count, 0);
    }

    return ZMK_BEHAVIOR_OPAQUE;
}

static int behavior_mg_set_init(const struct device *dev) {
    ARG_UNUSED(dev);
    return 0;
}

static const struct behavior_driver_api behavior_mg_set_driver_api = {
    .binding_pressed = on_pressed,
    .binding_released = on_released,
};

#define MG_SET_INST(n)                                                             \
    BEHAVIOR_DT_INST_DEFINE(n, behavior_mg_set_init, NULL, NULL, NULL,             \
                            POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEFAULT,      \
                            &behavior_mg_set_driver_api);

DT_INST_FOREACH_STATUS_OKAY(MG_SET_INST)

#endif /* DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT) */
