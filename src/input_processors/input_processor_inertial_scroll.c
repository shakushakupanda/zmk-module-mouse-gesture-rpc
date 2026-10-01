/*
 * Flick-only inertia, controlled by the existing Mouse Gesture Studio settings.
 * SPDX-License-Identifier: MIT
 */
#define DT_DRV_COMPAT zmk_input_processor_inertial_scroll

#include <zephyr/device.h>
#include <zephyr/input/input.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <stdint.h>
#include <string.h>
#include <errno.h>
#include <drivers/input_processor.h>
#include <zmk/endpoints.h>
#include <zmk/hid.h>

#define Q_ONE 256
#define WINDOW_MS 80
#define BUCKET_MS 10
#define BUCKETS 9
#define MAX_GAP_MS 40
#define FLICK_COUNTS 4
#define MAX_VELOCITY_Q8 (4 * Q_ONE)

struct zmk_inertial_scroll_settings {
    bool enabled;
    uint16_t tick_ms;
    uint16_t idle_ms;
    uint8_t decay_percent;
    uint16_t impulse_percent;
    uint16_t min_velocity_q8;
    uint8_t max_ticks;
};

struct scroll_axis {
    int64_t bucket_id[BUCKETS];
    uint16_t counts[BUCKETS];
    uint8_t reports[BUCKETS];
    int64_t last_ms;
    int8_t direction;
    int32_t velocity;
    int32_t remainder;
};

struct inertial_scroll_data {
    struct k_work_delayable work;
    struct k_spinlock lock;
    struct zmk_inertial_scroll_settings settings;
    struct scroll_axis axis[2];
    int64_t due_ms;
    uint16_t ticks;
    bool coasting;
};

static struct inertial_scroll_data *g_inertial_scroll_data;

static int code_index(uint16_t code) {
    return code == INPUT_REL_WHEEL ? 0 : code == INPUT_REL_HWHEEL ? 1 : -1;
}

static int32_t magnitude(int32_t value) {
    return value < 0 ? -value : value;
}

static void clear_motion(struct inertial_scroll_data *data) {
    memset(data->axis, 0, sizeof(data->axis));
    data->ticks = 0;
    data->coasting = false;
}

static void add_sample(struct scroll_axis *axis, int32_t value, int64_t now) {
    int direction = value < 0 ? -1 : 1;
    if (axis->direction != direction || now - axis->last_ms > MAX_GAP_MS) {
        memset(axis, 0, sizeof(*axis));
    }
    axis->direction = direction;
    axis->last_ms = now;
    int64_t bucket = now / BUCKET_MS;
    size_t slot = bucket % BUCKETS;
    if (axis->bucket_id[slot] != bucket) {
        axis->bucket_id[slot] = bucket;
        axis->counts[slot] = 0;
        axis->reports[slot] = 0;
    }
    uint32_t amount = value < 0 ? (uint32_t)(-(int64_t)value) : (uint32_t)value;
    axis->counts[slot] = MIN((uint64_t)axis->counts[slot] + amount, UINT16_MAX);
    axis->reports[slot] = MIN((unsigned)axis->reports[slot] + 1, UINT8_MAX);
}

static int32_t flick_velocity(const struct scroll_axis *axis,
                              const struct zmk_inertial_scroll_settings *st, int64_t now) {
    if (!axis->direction || now - axis->last_ms > MAX_GAP_MS) {
        return 0;
    }
    uint32_t count = 0, reports = 0;
    for (size_t i = 0; i < BUCKETS; i++) {
        /* Exclude the partially expired bucket instead of counting old input. */
        int64_t start = axis->bucket_id[i] * BUCKET_MS;
        if (start >= now - WINDOW_MS && start <= now) {
            count += axis->counts[i];
            reports += axis->reports[i];
        }
    }
    /* A single isolated report never arms inertia, even if it is large. */
    if (count < FLICK_COUNTS || reports < 2) {
        return 0;
    }
    uint64_t velocity = (uint64_t)count * st->tick_ms * Q_ONE * st->impulse_percent /
                        (WINDOW_MS * 100U);
    return axis->direction * (int32_t)MIN(velocity, MAX_VELOCITY_Q8);
}

static void inertial_scroll_work_cb(struct k_work *work) {
    struct k_work_delayable *dwork = k_work_delayable_from_work(work);
    struct inertial_scroll_data *data = CONTAINER_OF(dwork, struct inertial_scroll_data, work);
    k_spinlock_key_t key = k_spin_lock(&data->lock);
    const struct zmk_inertial_scroll_settings st = data->settings;
    if (!st.enabled) {
        clear_motion(data);
        k_spin_unlock(&data->lock, key);
        return;
    }
    int64_t remaining = data->due_ms - k_uptime_get();
    if (remaining > 0) {
        k_work_reschedule(&data->work, K_MSEC(remaining));
        k_spin_unlock(&data->lock, key);
        return;
    }
    int16_t output[2] = {0};
    bool keep_running = false;
    data->coasting = true;
    data->ticks++;
    for (size_t i = 0; i < 2; i++) {
        struct scroll_axis *axis = &data->axis[i];
        if (data->ticks > st.max_ticks || magnitude(axis->velocity) < st.min_velocity_q8) {
            axis->velocity = axis->remainder = 0;
            continue;
        }
        /* Preserve fractions; never round a sub-step up to a whole wheel step. */
        axis->remainder += axis->velocity;
        output[i] = axis->remainder / Q_ONE;
        axis->remainder -= output[i] * Q_ONE;
        axis->velocity = (axis->velocity * st.decay_percent) / 100;
        keep_running |= magnitude(axis->velocity) >= st.min_velocity_q8;
    }
    if (keep_running && data->ticks < st.max_ticks) {
        data->due_ms = k_uptime_get() + st.tick_ms;
        k_work_reschedule(&data->work, K_MSEC(st.tick_ms));
    }
    k_spin_unlock(&data->lock, key);
    if (output[0] || output[1]) {
        zmk_hid_mouse_scroll_set(output[1], output[0]);
        zmk_endpoint_send_mouse_report();
        zmk_hid_mouse_scroll_set(0, 0);
    }
}

static int inertial_scroll_handle_event(const struct device *dev, struct input_event *event,
                                        uint32_t param1, uint32_t param2,
                                        struct zmk_input_processor_state *state) {
    ARG_UNUSED(param1);
    ARG_UNUSED(param2);
    ARG_UNUSED(state);
    int idx = code_index(event->code);
    if (event->type != INPUT_EV_REL || idx < 0 || event->value == 0) {
        return ZMK_INPUT_PROC_CONTINUE;
    }
    struct inertial_scroll_data *data = dev->data;
    k_spinlock_key_t key = k_spin_lock(&data->lock);
    if (!data->settings.enabled) {
        k_spin_unlock(&data->lock, key);
        return ZMK_INPUT_PROC_CONTINUE;
    }
    int direction = event->value < 0 ? -1 : 1;
    /* A new manual movement brakes the tail. Reversing also discards the flick. */
    if (data->coasting || (data->axis[idx].direction && data->axis[idx].direction != direction)) {
        clear_motion(data);
    }
    int64_t now = k_uptime_get();
    add_sample(&data->axis[idx], event->value, now);
    data->ticks = 0;
    bool armed = false;
    for (size_t i = 0; i < 2; i++) {
        data->axis[i].remainder = 0;
        data->axis[i].velocity = flick_velocity(&data->axis[i], &data->settings, now);
        armed |= magnitude(data->axis[i].velocity) >= data->settings.min_velocity_q8;
    }
    if (armed) {
        /* Do not start between the closely spaced reports of an ongoing flick. */
        uint16_t delay = MAX(data->settings.idle_ms, MAX_GAP_MS);
        data->due_ms = now + delay;
        k_work_reschedule(&data->work, K_MSEC(delay));
    } else {
        k_work_cancel_delayable(&data->work);
    }
    k_spin_unlock(&data->lock, key);
    return ZMK_INPUT_PROC_CONTINUE;
}

static int inertial_scroll_init(const struct device *dev) {
    struct inertial_scroll_data *data = dev->data;
    if (!g_inertial_scroll_data) {
        g_inertial_scroll_data = data;
    }
    data->settings = (struct zmk_inertial_scroll_settings){
        .enabled = false, .tick_ms = 20, .idle_ms = 28, .decay_percent = 86,
        .impulse_percent = 180, .min_velocity_q8 = 96, .max_ticks = 36,
    };
    k_work_init_delayable(&data->work, inertial_scroll_work_cb);
    return 0;
}

static const struct zmk_input_processor_driver_api inertial_scroll_driver_api = {
    .handle_event = inertial_scroll_handle_event,
};

#define INERTIAL_SCROLL_INST(n) \
    static struct inertial_scroll_data inertial_scroll_data_##n; \
    DEVICE_DT_INST_DEFINE(n, inertial_scroll_init, NULL, &inertial_scroll_data_##n, NULL, \
                          POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, \
                          &inertial_scroll_driver_api);
DT_INST_FOREACH_STATUS_OKAY(INERTIAL_SCROLL_INST)

int zmk_inertial_scroll_runtime_get(struct zmk_inertial_scroll_settings *out) {
    if (!out) return -EINVAL;
    struct inertial_scroll_data *data = g_inertial_scroll_data;
    if (!data) return -ENODEV;
    k_spinlock_key_t key = k_spin_lock(&data->lock);
    *out = data->settings;
    k_spin_unlock(&data->lock, key);
    return 0;
}

int zmk_inertial_scroll_runtime_set(const struct zmk_inertial_scroll_settings *settings) {
    if (!settings) return -EINVAL;
    struct inertial_scroll_data *data = g_inertial_scroll_data;
    if (!data) return -ENODEV;
    k_spinlock_key_t key = k_spin_lock(&data->lock);
    data->settings = *settings;
    data->settings.tick_ms = MAX(settings->tick_ms, 1);
    data->settings.decay_percent = CLAMP(settings->decay_percent, 1, 99);
    data->settings.min_velocity_q8 = MAX(settings->min_velocity_q8, 1);
    clear_motion(data);
    k_work_cancel_delayable(&data->work);
    k_spin_unlock(&data->lock, key);
    return 0;
}
