#pragma once
#include <stdbool.h>
#include <stdint.h>

struct zmk_inertial_scroll_settings {
    bool enabled;
    uint16_t tick_ms;
    uint16_t idle_ms;
    uint8_t decay_percent;
    uint16_t impulse_percent;
    uint16_t min_velocity_q8;
    uint8_t max_ticks;
    uint16_t flick_window_ms;
    uint16_t flick_min_counts;
    uint16_t flick_max_gap_ms;
};

struct mg_scroll_sample { uint32_t ts_ms; int32_t value; uint8_t axis; };
struct mg_scroll_capture {
    uint32_t id, total, dropped;
    bool active;
    uint8_t count;
    struct mg_scroll_sample samples[32];
};
/* action: 0 read, 1 start (10 seconds), 2 stop. Reads require the current id. */
int mg_scroll_capture_read(uint32_t action, uint32_t id, uint32_t offset,
                           struct mg_scroll_capture *out);
