/*
 * Lightweight inertial scroll input processor for moNa2.
 *
 * SPDX-License-Identifier: MIT
 */

#define DT_DRV_COMPAT zmk_input_processor_inertial_scroll

#include <zephyr/device.h>
#include <zephyr/input/input.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>
#include <stdint.h>
#include <errno.h>
#include <limits.h>
#include <drivers/input_processor.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);


#define Q 8
#define Q_ONE (1 << Q)

struct zmk_inertial_scroll_settings {
    bool enabled;
    uint16_t tick_ms;
    uint16_t idle_ms;
    uint8_t decay_percent;
    uint16_t impulse_percent;
    uint16_t min_velocity_q8;
    uint8_t max_ticks;
};

struct inertial_scroll_config {
    size_t codes_len;
    const uint16_t *codes;
    struct zmk_inertial_scroll_settings defaults;
};

struct inertial_scroll_data {
    struct k_work_delayable work;
    const struct device *dev;
    const struct device *input_dev;
    struct zmk_inertial_scroll_settings settings;
    int32_t velocity[2];
    uint8_t ticks;
    bool injecting;
};

static int code_index(const struct inertial_scroll_config *cfg, uint16_t code) {
    for (size_t i = 0; i < cfg->codes_len && i < 2; i++) {
        if (cfg->codes[i] == code) {
            return (int)i;
        }
    }
    return -1;
}

static void inertial_scroll_work_cb(struct k_work *work) {
    struct k_work_delayable *dwork = k_work_delayable_from_work(work);
    struct inertial_scroll_data *data = CONTAINER_OF(dwork, struct inertial_scroll_data, work);
    const struct device *dev = data->dev;
    const struct inertial_scroll_config *cfg = dev->config;
    struct zmk_inertial_scroll_settings st = data->settings;
    uint16_t tick_ms = st.tick_ms == 0 ? 20 : st.tick_ms;

    if (!st.enabled) {
        data->velocity[0] = 0;
        data->velocity[1] = 0;
        return;
    }

    bool keep_running = false;
    data->ticks++;
    data->injecting = true;

    for (size_t i = 0; i < cfg->codes_len && i < 2; i++) {
        int32_t v = data->velocity[i];
        if (ABS(v) < st.min_velocity_q8 || data->ticks > st.max_ticks) {
            data->velocity[i] = 0;
            continue;
        }

        int16_t out = (int16_t)CLAMP(v / Q_ONE, INT16_MIN, INT16_MAX);
        if (out == 0) {
            out = v > 0 ? 1 : -1;
        }

        input_report_rel(data->input_dev ? data->input_dev : dev, cfg->codes[i], out, true, K_NO_WAIT);

        data->velocity[i] = (v * st.decay_percent) / 100;
        if (ABS(data->velocity[i]) >= st.min_velocity_q8) {
            keep_running = true;
        }
    }

    data->injecting = false;

    if (keep_running && data->ticks <= st.max_ticks) {
        k_work_schedule(&data->work, K_MSEC(tick_ms));
    }
}

static int inertial_scroll_handle_event(const struct device *dev, struct input_event *event,
                                        uint32_t param1, uint32_t param2,
                                        struct zmk_input_processor_state *state) {
    ARG_UNUSED(param1);
    ARG_UNUSED(param2);
    ARG_UNUSED(state);

    const struct inertial_scroll_config *cfg = dev->config;
    struct inertial_scroll_data *data = dev->data;

    if (event->type != INPUT_EV_REL || data->injecting) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    int idx = code_index(cfg, event->code);
    if (idx < 0 || event->value == 0 || !data->settings.enabled) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    data->input_dev = event->dev;
    data->velocity[idx] = ((int32_t)event->value * (int32_t)data->settings.impulse_percent * Q_ONE) / 100;
    data->ticks = 0;

    /* Any new real movement restarts inertia from the latest velocity. */
    k_work_reschedule(&data->work, K_MSEC(data->settings.idle_ms));

    return ZMK_INPUT_PROC_CONTINUE;
}

static int inertial_scroll_init(const struct device *dev) {
    struct inertial_scroll_data *data = dev->data;
    const struct inertial_scroll_config *cfg = dev->config;
    data->dev = dev;
    data->settings = cfg->defaults;
    k_work_init_delayable(&data->work, inertial_scroll_work_cb);
    return 0;
}

static const struct zmk_input_processor_driver_api inertial_scroll_driver_api = {
    .handle_event = inertial_scroll_handle_event,
};

#define INERTIAL_SCROLL_INST(n)                                                                    \
    static struct inertial_scroll_data inertial_scroll_data_##n = {};                              \
    static const uint16_t inertial_scroll_codes_##n[] = DT_INST_PROP(n, codes);                    \
    static const struct inertial_scroll_config inertial_scroll_config_##n = {                      \
        .codes_len = ARRAY_SIZE(inertial_scroll_codes_##n),                                        \
        .codes = inertial_scroll_codes_##n,                                                        \
        .defaults = {                                                                              \
            .enabled = DT_INST_PROP(n, enabled),                                                   \
            .tick_ms = DT_INST_PROP_OR(n, tick_ms, 20),                                            \
            .idle_ms = DT_INST_PROP_OR(n, idle_ms, 24),                                            \
            .decay_percent = DT_INST_PROP_OR(n, decay_percent, 86),                                \
            .impulse_percent = DT_INST_PROP_OR(n, impulse_percent, 180),                           \
            .min_velocity_q8 = DT_INST_PROP_OR(n, min_velocity_q8, 96),                            \
            .max_ticks = DT_INST_PROP_OR(n, max_ticks, 36),                                        \
        },                                                                                         \
    };                                                                                             \
    DEVICE_DT_INST_DEFINE(n, inertial_scroll_init, NULL, &inertial_scroll_data_##n,                \
                          &inertial_scroll_config_##n, POST_KERNEL,                               \
                          CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &inertial_scroll_driver_api);

DT_INST_FOREACH_STATUS_OKAY(INERTIAL_SCROLL_INST)

int zmk_inertial_scroll_runtime_get(struct zmk_inertial_scroll_settings *out) {
#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)
    if (!out) {
        return -EINVAL;
    }
    const struct device *dev = DEVICE_DT_GET(DT_DRV_INST(0));
    if (!device_is_ready(dev)) {
        return -ENODEV;
    }
    struct inertial_scroll_data *data = dev->data;
    *out = data->settings;
    return 0;
#else
    return -ENODEV;
#endif
}

int zmk_inertial_scroll_runtime_set(const struct zmk_inertial_scroll_settings *settings) {
#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)
    if (!settings) {
        return -EINVAL;
    }
#define APPLY_INERTIAL_SETTINGS(n) do {                                                           \
        const struct device *dev = DEVICE_DT_GET(DT_DRV_INST(n));                                  \
        if (device_is_ready(dev)) {                                                                \
            struct inertial_scroll_data *data = dev->data;                                         \
            data->settings = *settings;                                                           \
            if (!data->settings.enabled) {                                                        \
                data->velocity[0] = 0;                                                            \
                data->velocity[1] = 0;                                                            \
                k_work_cancel_delayable(&data->work);                                             \
            }                                                                                     \
        }                                                                                         \
    } while (0);
    DT_INST_FOREACH_STATUS_OKAY(APPLY_INERTIAL_SETTINGS)
#undef APPLY_INERTIAL_SETTINGS
    return 0;
#else
    return -ENODEV;
#endif
}
