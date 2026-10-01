/* Firmware-only smoothing and flick inertia. SPDX-License-Identifier: MIT */
#define DT_DRV_COMPAT zmk_input_processor_inertial_scroll
#include <zephyr/device.h>
#include <zephyr/input/input.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>
#include <stdint.h>
#include <string.h>
#include <errno.h>
#include <drivers/input_processor.h>
#include <zmk/event_manager.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/keymap.h>
#include "inertial_scroll.h"

#define Q_ONE 65536
#define BUCKET_MS 10
#define BUCKETS 21
#define FRAME_MS 8
#define MAX_VELOCITY_Q (4 * Q_ONE)
#define MAX_PENDING_Q (64 * Q_ONE)
#define MAX_COAST_MS 2000

struct inertial_scroll_config { uint16_t divisor; uint32_t layers; };
struct scroll_axis {
    int64_t bucket_id[BUCKETS];
    uint16_t counts[BUCKETS];
    uint8_t reports[BUCKETS];
    int64_t last_ms;
    int8_t direction;
    int64_t raw_bucket_id[BUCKETS];
    uint16_t raw_counts[BUCKETS];
    int64_t raw_last_ms;
    int8_t raw_direction;
    int32_t step_remainder, scale_remainder;
    int32_t pending, output_remainder;
    int32_t estimated_velocity, velocity;
    uint16_t phase_ms;
};
struct inertial_scroll_data {
    struct k_work_delayable work;
    struct k_spinlock lock;
    struct zmk_inertial_scroll_settings settings;
    const struct device *dev;
    struct scroll_axis axis[2];
    int64_t due_ms, last_input_ms, coast_start_ms, last_frame_ms;
    uint16_t generation;
    bool scheduled, armed, coasting;
};
static struct inertial_scroll_data *g_inertial_scroll_data;

static int32_t magnitude(int32_t v) { return v < 0 ? -v : v; }
static bool scroll_active(const struct inertial_scroll_data *data) {
    const struct inertial_scroll_config *cfg = data->dev->config;
    if (!cfg->layers) return true;
    for (uint8_t layer = 0; layer < 32; layer++)
        if ((cfg->layers & BIT(layer)) && zmk_keymap_layer_active(layer)) return true;
    return false;
}
static void cancel_motion(struct inertial_scroll_data *data) {
    memset(data->axis, 0, sizeof(data->axis));
    data->generation++;
    data->scheduled = data->armed = data->coasting = false;
    k_work_cancel_delayable(&data->work);
}
static void schedule_at(struct inertial_scroll_data *data, int64_t now, int64_t due) {
    if (!data->scheduled || due < data->due_ms) {
        data->due_ms = due;
        data->scheduled = true;
        k_work_reschedule(&data->work, K_MSEC(MAX(due - now, 0)));
    }
}

/* Capture only physical, post-scaling wheel input; never synthesized inertia. */
#define CAPTURE_SAMPLES 256
static struct mg_scroll_sample capture_samples[CAPTURE_SAMPLES];
static uint32_t capture_id, capture_count, capture_dropped;
static int64_t capture_start, capture_end;

int mg_scroll_capture_read(uint32_t action, uint32_t id, uint32_t offset,
                           struct mg_scroll_capture *out) {
    struct inertial_scroll_data *data = g_inertial_scroll_data;
    if (!data) return -ENOTSUP;
    if (!out || action > 2) return -EINVAL;
    k_spinlock_key_t key = k_spin_lock(&data->lock);
    int64_t now = k_uptime_get();
    if (action == 1) {
        capture_id++;
        if (!capture_id) capture_id++;
        capture_count = capture_dropped = 0;
        capture_start = (now / BUCKET_MS) * BUCKET_MS;
        capture_end = now + 10000;
        cancel_motion(data);
    } else if (!id || id != capture_id) {
        k_spin_unlock(&data->lock, key);
        return -EINVAL;
    }
    if (action == 2) { capture_end = 0; cancel_motion(data); }
    memset(out, 0, sizeof(*out));
    out->id = capture_id;
    out->total = capture_count;
    out->dropped = capture_dropped;
    out->active = now < capture_end;
    for (uint32_t i = offset; i < capture_count && out->count < 32; i++) {
        out->samples[out->count++] = capture_samples[i];
    }
    k_spin_unlock(&data->lock, key);
    return 0;
}


static int code_index(uint16_t code) {
    return code == INPUT_REL_WHEEL ? 0 : code == INPUT_REL_HWHEEL ? 1 : -1;
}
/* Preserve the previous post-scaling detector/capture units for Studio. */
static void add_step_sample(struct scroll_axis *a, int32_t value, int64_t now,
                            uint16_t gap) {
    if (!value) return;
    int direction = value < 0 ? -1 : 1;
    if (a->direction != direction || now - a->last_ms > gap) {
        memset(a->counts, 0, sizeof(a->counts));
        memset(a->reports, 0, sizeof(a->reports));
    }
    a->direction = direction; a->last_ms = now;
    int64_t bucket = now / BUCKET_MS;
    size_t slot = bucket % BUCKETS;
    if (a->bucket_id[slot] != bucket) {
        a->bucket_id[slot] = bucket; a->counts[slot] = a->reports[slot] = 0;
    }
    uint32_t amount = value < 0 ? (uint32_t)(-(int64_t)value) : (uint32_t)value;
    a->counts[slot] = MIN((uint64_t)a->counts[slot] + amount, UINT16_MAX);
    a->reports[slot] = MIN((unsigned)a->reports[slot] + 1, UINT8_MAX);
}
static bool flick_armed(const struct scroll_axis *a,
                        const struct zmk_inertial_scroll_settings *st, int64_t now) {
    if (!a->direction || now - a->last_ms > st->flick_max_gap_ms) return false;
    uint32_t count = 0, reports = 0;
    for (size_t i = 0; i < BUCKETS; i++) {
        int64_t start = a->bucket_id[i] * BUCKET_MS;
        if (start >= now - st->flick_window_ms && start <= now) {
            count += a->counts[i]; reports += a->reports[i];
        }
    }
    uint64_t old_velocity = (uint64_t)count * st->tick_ms * 256 * st->impulse_percent /
                            (st->flick_window_ms * 100U);
    return count >= st->flick_min_counts && reports >= 2 &&
           MIN(old_velocity, 1024) >= st->min_velocity_q8;
}
/* Estimate release speed from recent raw movement, before whole-step rounding. */
static void update_velocity(struct scroll_axis *a, int32_t raw, int64_t now,
                            const struct inertial_scroll_config *cfg,
                            const struct zmk_inertial_scroll_settings *st) {
    int direction = raw < 0 ? -1 : 1;
    if (a->raw_direction != direction || now - a->raw_last_ms > st->flick_max_gap_ms) {
        memset(a->raw_counts, 0, sizeof(a->raw_counts));
        a->estimated_velocity = 0;
    }
    a->raw_direction = direction; a->raw_last_ms = now;
    int64_t bucket = now / BUCKET_MS;
    size_t slot = bucket % BUCKETS;
    if (a->raw_bucket_id[slot] != bucket) {
        a->raw_bucket_id[slot] = bucket; a->raw_counts[slot] = 0;
    }
    uint32_t amount = raw < 0 ? (uint32_t)(-(int64_t)raw) : (uint32_t)raw;
    a->raw_counts[slot] = MIN((uint64_t)a->raw_counts[slot] + amount, UINT16_MAX);
    uint32_t count = 0;
    for (size_t i = 0; i < BUCKETS; i++) {
        int64_t start = a->raw_bucket_id[i] * BUCKET_MS;
        if (start >= now - 40 && start <= now) count += a->raw_counts[i];
    }
    uint64_t speed = (uint64_t)count * Q_ONE * st->tick_ms / ((uint32_t)40 * cfg->divisor);
    int32_t target = direction * (int32_t)MIN(speed, MAX_VELOCITY_Q);
    a->estimated_velocity = (a->estimated_velocity + 2 * target) / 3;
}
/* Linear interpolation between each configured decay tick. Integrating at
 * 8 ms keeps fractional travel, while tick_ms still defines decay/max_ticks. */
static int32_t advance_velocity(struct scroll_axis *a, uint16_t elapsed,
                                const struct zmk_inertial_scroll_settings *st) {
    int64_t distance = 0;
    while (elapsed && a->velocity) {
        uint16_t dt = MIN(elapsed, st->tick_ms - a->phase_ms);
        int32_t next = (int64_t)a->velocity * st->decay_percent / 100;
        int32_t loss = a->velocity - next;
        int32_t v0 = a->velocity - (int64_t)loss * a->phase_ms / st->tick_ms;
        int32_t v1 = a->velocity - (int64_t)loss * (a->phase_ms + dt) / st->tick_ms;
        distance += (int64_t)(v0 + v1) * dt / (2U * st->tick_ms);
        a->phase_ms += dt; elapsed -= dt;
        if (a->phase_ms == st->tick_ms) { a->velocity = next; a->phase_ms = 0; }
    }
    return distance;
}
static int16_t quantize(struct scroll_axis *a, int32_t delta) {
    int64_t total = (int64_t)a->output_remainder + delta;
    int16_t out = CLAMP(total / Q_ONE, -4, 4);
    a->output_remainder = total - (int32_t)out * Q_ONE;
    return out;
}
static void inertial_scroll_work_cb(struct k_work *work) {
    struct k_work_delayable *dw = k_work_delayable_from_work(work);
    struct inertial_scroll_data *d = CONTAINER_OF(dw, struct inertial_scroll_data, work);
    k_spinlock_key_t key = k_spin_lock(&d->lock);
    int64_t now = k_uptime_get();
    if (!scroll_active(d)) { cancel_motion(d); k_spin_unlock(&d->lock, key); return; }
    if (now < d->due_ms) {
        k_work_reschedule(&d->work, K_MSEC(d->due_ms - now));
        k_spin_unlock(&d->lock, key); return;
    }
    d->scheduled = false;
    const struct zmk_inertial_scroll_settings *st = &d->settings;
    int16_t output[2] = {0};
    bool pending = false;
    for (size_t i = 0; i < 2; i++) {
        struct scroll_axis *a = &d->axis[i];
        int32_t take = magnitude(a->pending) <= Q_ONE ? a->pending : a->pending / 2;
        take = CLAMP(take, -MAX_VELOCITY_Q, MAX_VELOCITY_Q);
        a->pending -= take;
        output[i] = quantize(a, take);
        pending |= a->pending != 0;
    }
    int64_t release = d->last_input_ms + MAX(st->idle_ms, st->flick_max_gap_ms);
    if (!pending && st->enabled && d->armed && !d->coasting && now >= release) {
        d->coasting = true; d->coast_start_ms = now; d->last_frame_ms = now;
        for (size_t i = 0; i < 2; i++) {
            struct scroll_axis *a = &d->axis[i];
            int64_t seed = (int64_t)a->estimated_velocity * st->impulse_percent / 100;
            a->velocity = flick_armed(a, st, d->last_input_ms) ?
                CLAMP(seed, -MAX_VELOCITY_Q, MAX_VELOCITY_Q) : 0;
            a->phase_ms = 0;
            /* Waiting must not restart the old speed after a pause. */
            (void)advance_velocity(a, MIN(now - d->last_input_ms, MAX_COAST_MS), st);
        }
    }
    bool coast = false;
    if (d->coasting) {
        uint32_t duration = MIN((uint32_t)st->tick_ms * st->max_ticks, MAX_COAST_MS);
        int64_t elapsed = now - d->last_frame_ms;
        for (size_t i = 0; i < 2; i++) {
            struct scroll_axis *a = &d->axis[i];
            if (now - d->coast_start_ms >= duration || elapsed > 32 ||
                (uint32_t)magnitude(a->velocity) < (uint32_t)st->min_velocity_q8 * 256) {
                a->velocity = 0;
            } else {
                int32_t travel = advance_velocity(a, elapsed, st);
                output[i] += quantize(a, travel);
                coast |= (uint32_t)magnitude(a->velocity) >= (uint32_t)st->min_velocity_q8 * 256;
            }
        }
        d->last_frame_ms = now;
        if (!coast) d->armed = d->coasting = false;
    }
    if (pending || coast) schedule_at(d, now, now + MIN(st->tick_ms, FRAME_MS));
    else if (d->armed && st->enabled) schedule_at(d, now, MAX(release, now + 1));
    uint16_t generation = d->generation;
    k_spin_unlock(&d->lock, key);
    /* Route synthetic output through Zephyr's input thread: it serializes HID
     * updates with pointer/buttons. The processor rejects queued stale epochs. */
    for (size_t i = 0; i < 2; i++) if (output[i]) {
        int32_t encoded = ((uint32_t)generation << 16) | (uint16_t)output[i];
        (void)input_report_rel(d->dev, i ? INPUT_REL_HWHEEL : INPUT_REL_WHEEL,
                               encoded, true, K_NO_WAIT);
    }
}
static int inertial_scroll_handle_event(const struct device *dev, struct input_event *event,
                                        uint32_t p1, uint32_t p2,
                                        struct zmk_input_processor_state *state) {
    ARG_UNUSED(p1); ARG_UNUSED(p2); ARG_UNUSED(state);
    struct inertial_scroll_data *d = dev->data;
    const struct inertial_scroll_config *cfg = dev->config;
    k_spinlock_key_t key = k_spin_lock(&d->lock);
    int idx = code_index(event->code);
    if (event->dev == dev) {
        uint16_t generation = (uint32_t)event->value >> 16;
        event->value = generation == d->generation && scroll_active(d) ? (int16_t)event->value : 0;
        k_spin_unlock(&d->lock, key); return ZMK_INPUT_PROC_CONTINUE;
    }
    if (event->type != INPUT_EV_REL || idx < 0 || !event->value) {
        if (event->type == INPUT_EV_REL && event->value &&
            (event->code == INPUT_REL_X || event->code == INPUT_REL_Y)) cancel_motion(d);
        k_spin_unlock(&d->lock, key); return ZMK_INPUT_PROC_CONTINUE;
    }
    int64_t now = k_uptime_get();
    if (capture_end && now >= capture_end) { capture_end = 0; cancel_motion(d); }
    int32_t raw = event->value;
    int direction = raw < 0 ? -1 : 1;
    if (d->coasting || (d->axis[idx].raw_direction && d->axis[idx].raw_direction != direction))
        cancel_motion(d);
    struct scroll_axis *a = &d->axis[idx];
    int64_t step_total = (int64_t)a->step_remainder + raw;
    int32_t steps = step_total / cfg->divisor;
    a->step_remainder = step_total % cfg->divisor;
    if (now < capture_end || !scroll_active(d)) {
        if (now < capture_end && steps) {
            if (capture_count < CAPTURE_SAMPLES) capture_samples[capture_count++] =
                (struct mg_scroll_sample){ .ts_ms = now - capture_start, .value = steps, .axis = idx };
            else capture_dropped++;
        }
        event->value = steps;
        k_spin_unlock(&d->lock, key); return ZMK_INPUT_PROC_CONTINUE;
    }
    update_velocity(a, raw, now, cfg, &d->settings);
    add_step_sample(a, steps, now, d->settings.flick_max_gap_ms);
    bool fresh = !d->scheduled && !a->pending;
    int64_t scaled = (int64_t)raw * Q_ONE + a->scale_remainder;
    int32_t delta = CLAMP(scaled / cfg->divisor, -MAX_PENDING_Q, MAX_PENDING_Q);
    a->scale_remainder = scaled % cfg->divisor;
    a->pending = CLAMP((int64_t)a->pending + delta, -MAX_PENDING_Q, MAX_PENDING_Q);
    event->value = 0;
    /* First whole step is immediate; split only the rest of a burst. */
    if (fresh && magnitude(a->pending + a->output_remainder) >= Q_ONE) {
        int32_t first = direction * Q_ONE;
        a->pending -= first;
        event->value = quantize(a, first);
    }
    d->last_input_ms = now;
    d->armed = d->settings.enabled &&
        (flick_armed(&d->axis[0], &d->settings, now) || flick_armed(&d->axis[1], &d->settings, now));
    schedule_at(d, now, now + MIN(d->settings.tick_ms, FRAME_MS));
    k_spin_unlock(&d->lock, key); return ZMK_INPUT_PROC_CONTINUE;
}
static int inertial_scroll_init(const struct device *dev) {
    struct inertial_scroll_data *d = dev->data;
    d->dev = dev;
    if (!g_inertial_scroll_data) g_inertial_scroll_data = d;
    d->settings = (struct zmk_inertial_scroll_settings){
        .enabled = false, .tick_ms = 20, .idle_ms = 28, .decay_percent = 86,
        .impulse_percent = 180, .min_velocity_q8 = 96, .max_ticks = 36,
        .flick_window_ms = 80, .flick_min_counts = 4, .flick_max_gap_ms = 40,
    };
    k_work_init_delayable(&d->work, inertial_scroll_work_cb);
    return 0;
}
static const struct zmk_input_processor_driver_api inertial_scroll_driver_api = {
    .handle_event = inertial_scroll_handle_event,
};
static int layer_changed(const zmk_event_t *eh) {
    ARG_UNUSED(eh);
    struct inertial_scroll_data *d = g_inertial_scroll_data;
    if (d) {
        k_spinlock_key_t key = k_spin_lock(&d->lock);
        if (!scroll_active(d)) cancel_motion(d);
        k_spin_unlock(&d->lock, key);
    }
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(inertial_scroll_layers, layer_changed);
ZMK_SUBSCRIPTION(inertial_scroll_layers, zmk_layer_state_changed);

#define LAYER_BIT(node, prop, idx) | BIT(DT_PROP_BY_IDX(node, prop, idx))
#define INERTIAL_SCROLL_INST(n) \
    BUILD_ASSERT(DT_INST_PROP(n, input_divisor) > 0 && DT_INST_PROP(n, input_divisor) <= UINT16_MAX); \
    static const struct inertial_scroll_config inertial_scroll_cfg_##n = { \
        .divisor = DT_INST_PROP(n, input_divisor), \
        .layers = (0 COND_CODE_1(DT_NODE_HAS_PROP(DT_DRV_INST(n), scroll_layers), \
            (DT_FOREACH_PROP_ELEM(DT_DRV_INST(n), scroll_layers, LAYER_BIT)), ())), \
    }; \
    static struct inertial_scroll_data inertial_scroll_data_##n; \
    DEVICE_DT_INST_DEFINE(n, inertial_scroll_init, NULL, &inertial_scroll_data_##n, \
                          &inertial_scroll_cfg_##n, POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, \
                          &inertial_scroll_driver_api);
DT_INST_FOREACH_STATUS_OKAY(INERTIAL_SCROLL_INST)

int zmk_inertial_scroll_runtime_get(struct zmk_inertial_scroll_settings *out) {
    if (!out) return -EINVAL;
    struct inertial_scroll_data *d = g_inertial_scroll_data;
    if (!d) return -ENODEV;
    k_spinlock_key_t key = k_spin_lock(&d->lock); *out = d->settings;
    k_spin_unlock(&d->lock, key); return 0;
}
int zmk_inertial_scroll_runtime_set(const struct zmk_inertial_scroll_settings *st) {
    if (!st) return -EINVAL;
    struct inertial_scroll_data *d = g_inertial_scroll_data;
    if (!d) return -ENODEV;
    k_spinlock_key_t key = k_spin_lock(&d->lock);
    d->settings = *st;
    d->settings.tick_ms = MAX(st->tick_ms, 1);
    d->settings.decay_percent = CLAMP(st->decay_percent, 1, 99);
    d->settings.min_velocity_q8 = MAX(st->min_velocity_q8, 1);
    d->settings.flick_window_ms = CLAMP(st->flick_window_ms ? st->flick_window_ms : 80, 20, 200);
    d->settings.flick_min_counts = CLAMP(st->flick_min_counts ? st->flick_min_counts : 4, 2, 64);
    d->settings.flick_max_gap_ms = CLAMP(st->flick_max_gap_ms ? st->flick_max_gap_ms : 40, 10, 200);
    cancel_motion(d);
    k_spin_unlock(&d->lock, key); return 0;
}
