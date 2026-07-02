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
#include <zmk/endpoints.h>
#include <zmk/hid.h>

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

struct inertial_scroll_data {
    struct k_work_delayable work;
    const struct device *dev;
    struct zmk_inertial_scroll_settings settings;
    int32_t velocity[2];
    uint8_t ticks;
    bool injecting;
};

static struct inertial_scroll_data *g_inertial_scroll_data;

static int code_index(uint16_t code) {
    switch (code) {
    case INPUT_REL_WHEEL:
        return 0;
    case INPUT_REL_HWHEEL:
        return 1;
    default:
        return -1;
    }
}

static uint16_t code_for_index(size_t idx) {
    return idx == 0 ? INPUT_REL_WHEEL : INPUT_REL_HWHEEL;
}

static int32_t i32_abs(int32_t v) {
    return v < 0 ? -v : v;
}

static void inertial_scroll_work_cb(struct k_work *work) {
    struct k_work_delayable *dwork = k_work_delayable_from_work(work);
    struct inertial_scroll_data *data = CONTAINER_OF(dwork, struct inertial_scroll_data, work);
    struct zmk_inertial_scroll_settings st = data->settings;
    uint16_t tick_ms = st.tick_ms == 0 ? 20 : st.tick_ms;

    if (!st.enabled) {
        data->velocity[0] = 0;
        data->velocity[1] = 0;
        return;
    }

    bool keep_running = false;
    int16_t scroll_x = 0;
    int16_t scroll_y = 0;
    data->ticks++;
    data->injecting = true;

    for (size_t i = 0; i < 2; i++) {
        int32_t v = data->velocity[i];
        if (i32_abs(v) < st.min_velocity_q8 || data->ticks > st.max_ticks) {
            data->velocity[i] = 0;
            continue;
        }

        int16_t out = (int16_t)CLAMP(v / Q_ONE, INT16_MIN, INT16_MAX);
        if (out == 0) {
            out = v > 0 ? 1 : -1;
        }

        if (code_for_index(i) == INPUT_REL_WHEEL) {
            scroll_y += out;
        } else {
            scroll_x += out;
        }

        data->velocity[i] = (v * st.decay_percent) / 100;
        if (i32_abs(data->velocity[i]) >= st.min_velocity_q8) {
            keep_running = true;
        }
    }

    if (scroll_x != 0 || scroll_y != 0) {
        zmk_hid_mouse_scroll_set(scroll_x, scroll_y);
        zmk_endpoints_send_mouse_report();
        zmk_hid_mouse_scroll_set(0, 0);
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

    struct inertial_scroll_data *data = dev->data;

    if (event->type != INPUT_EV_REL || data->injecting) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    int idx = code_index(event->code);
    if (idx < 0 || event->value == 0 || !data->settings.enabled) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    data->velocity[idx] = ((int32_t)event->value * (int32_t)data->settings.impulse_percent * Q_ONE) / 100;
    data->ticks = 0;

    /* Any new real movement restarts inertia from the latest velocity. */
    k_work_reschedule(&data->work, K_MSEC(data->settings.idle_ms));

    return ZMK_INPUT_PROC_CONTINUE;
}

static int inertial_scroll_init(const struct device *dev) {
    struct inertial_scroll_data *data = dev->data;
    data->dev = dev;
    if (!g_inertial_scroll_data) {
        g_inertial_scroll_data = data;
    }
    data->settings = (struct zmk_inertial_scroll_settings){
        .enabled = true,
        .tick_ms = 20,
        .idle_ms = 28,
        .decay_percent = 86,
        .impulse_percent = 180,
        .min_velocity_q8 = 96,
        .max_ticks = 36,
    };
    k_work_init_delayable(&data->work, inertial_scroll_work_cb);
    return 0;
}

static const struct zmk_input_processor_driver_api inertial_scroll_driver_api = {
    .handle_event = inertial_scroll_handle_event,
};

#define INERTIAL_SCROLL_INST(n)                                                                    \
    static struct inertial_scroll_data inertial_scroll_data_##n = {};                              \
    DEVICE_DT_INST_DEFINE(n, inertial_scroll_init, NULL, &inertial_scroll_data_##n, NULL,          \
                          POST_KERNEL, CONFIG_KERNEL_INIT_PRIORITY_DEFAULT,                       \
                          &inertial_scroll_driver_api);

DT_INST_FOREACH_STATUS_OKAY(INERTIAL_SCROLL_INST)

int zmk_inertial_scroll_runtime_get(struct zmk_inertial_scroll_settings *out) {
    if (!out) {
        return -EINVAL;
    }
    if (!g_inertial_scroll_data) {
        return -ENODEV;
    }
    *out = g_inertial_scroll_data->settings;
    return 0;
}

int zmk_inertial_scroll_runtime_set(const struct zmk_inertial_scroll_settings *settings) {
    if (!settings) {
        return -EINVAL;
    }
    if (!g_inertial_scroll_data) {
        return -ENODEV;
    }

    struct inertial_scroll_data *data = g_inertial_scroll_data;
    data->settings = *settings;
    if (!data->settings.enabled) {
        data->velocity[0] = 0;
        data->velocity[1] = 0;
        k_work_cancel_delayable(&data->work);
    }
    return 0;
}
