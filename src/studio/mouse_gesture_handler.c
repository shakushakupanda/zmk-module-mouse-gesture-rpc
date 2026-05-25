/*
 * zmk-module-mouse-gesture-rpc — Custom Studio RPC handler
 *
 * Phase 2: ListGestures now returns the gestures defined under the
 * kot149/zmk-mouse-gesture devicetree node. Add/Update/Delete and
 * SetSettings remain stubs for later phases.
 */

#include <pb_decode.h>
#include <pb_encode.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys/util_macro.h>

#include <zmk/studio/custom.h>
#include <zmk/mouse_gesture/custom.pb.h>

#include <zephyr/logging/log.h>
LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* === Subsystem registration ============================================= */

static struct zmk_rpc_custom_subsystem_meta mouse_gesture_meta = {
    /* Where DYA Studio's "Subsystems" page should link to. */
    ZMK_RPC_CUSTOM_SUBSYSTEM_UI_URLS(
        "https://shakushakupanda.github.io/zmk-module-mouse-gesture-rpc/"),
    .security = ZMK_STUDIO_RPC_HANDLER_UNSECURED,
};

static bool mouse_gesture_rpc_handle_request(
    const zmk_custom_CallRequest *raw_request,
    pb_callback_t *encode_response);

/* The first argument is the public subsystem identifier shown in DYA
 * Studio's Subsystems page. Format: <namespace>__<feature>. */
ZMK_RPC_CUSTOM_SUBSYSTEM(cormoran__mouse_gesture, &mouse_gesture_meta,
                        mouse_gesture_rpc_handle_request);

ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(cormoran__mouse_gesture,
                                       zmk_mouse_gesture_Response);

/* === DTS gesture iteration ============================================== */
/*
 * kot149/zmk-mouse-gesture stores its gesture patterns as child nodes of
 * an `&zip_mouse_gesture` instance. The driver itself does not expose a
 * public API to enumerate them at runtime, so we replicate the devicetree
 * walk here against the same compatible string. This is a read-only mirror
 * of the static DT data; Phase 3 will add a runtime-mutable store on top.
 */

#define MG_COMPAT zmk_input_processor_mouse_gesture
#define MG_NODE   DT_COMPAT_GET_ANY_STATUS_OKAY(MG_COMPAT)

struct dts_gesture_info {
    const char *name;
    const uint8_t *pattern;
    size_t pattern_len;
    const char *binding_behavior;
    uint32_t binding_param1;
    uint32_t binding_param2;
};

#if DT_NODE_EXISTS(MG_NODE)

#define APPEND_PATTERN_BYTE(node_id, prop, idx) DT_PROP_BY_IDX(node_id, prop, idx),

/* Behavior is a phandle-array; the first phandle is the behavior device and
 * the following cells are its params (count depends on #binding-cells). */
#define BINDING_BEHAVIOR(child) \
    COND_CODE_1(DT_NODE_HAS_PROP(child, bindings), \
        (DEVICE_DT_NAME(DT_PHANDLE_BY_IDX(child, bindings, 0))), \
        (""))

#define BINDING_PARAM(child, name) \
    COND_CODE_1(DT_NODE_HAS_PROP(child, bindings), \
        (COND_CODE_1(DT_PHA_HAS_CELL_AT_IDX(child, bindings, 0, name), \
                     (DT_PHA_BY_IDX(child, bindings, 0, name)), \
                     (0))), \
        (0))

#define MAKE_GESTURE_ENTRY(child)                                                                  \
    {                                                                                              \
        .name = DT_NODE_FULL_NAME(child),                                                          \
        .pattern = (const uint8_t[]){                                                              \
            DT_FOREACH_PROP_ELEM(child, pattern, APPEND_PATTERN_BYTE) 0},                          \
        .pattern_len = DT_PROP_LEN(child, pattern),                                                \
        .binding_behavior = BINDING_BEHAVIOR(child),                                               \
        .binding_param1 = BINDING_PARAM(child, param1),                                            \
        .binding_param2 = BINDING_PARAM(child, param2),                                            \
    },

static const struct dts_gesture_info dts_gestures[] = {
    DT_FOREACH_CHILD(MG_NODE, MAKE_GESTURE_ENTRY)
};

#define NUM_DTS_GESTURES ARRAY_SIZE(dts_gestures)

#else

static const struct dts_gesture_info dts_gestures[1] = {{.name = NULL}};
#define NUM_DTS_GESTURES 0

#endif

/* kot149 GESTURE_* bitmask values from <dt-bindings/zmk/mouse-gesture.h>.
 * Replicated here to avoid a hard include dependency when the module is
 * built without kot149 in the manifest. */
#define KOT_GESTURE_UP    1
#define KOT_GESTURE_DOWN  2
#define KOT_GESTURE_LEFT  4
#define KOT_GESTURE_RIGHT 8

static inline zmk_mouse_gesture_Direction kot_to_proto_direction(uint8_t d) {
    switch (d) {
    case KOT_GESTURE_UP:    return zmk_mouse_gesture_Direction_DIRECTION_UP;
    case KOT_GESTURE_RIGHT: return zmk_mouse_gesture_Direction_DIRECTION_RIGHT;
    case KOT_GESTURE_DOWN:  return zmk_mouse_gesture_Direction_DIRECTION_DOWN;
    case KOT_GESTURE_LEFT:  return zmk_mouse_gesture_Direction_DIRECTION_LEFT;
    default:                return zmk_mouse_gesture_Direction_DIRECTION_UP;
    }
}

/* === Forward declarations of per-message handlers ====================== */

static int handle_list_gestures(const zmk_mouse_gesture_ListGesturesRequest *req,
                                zmk_mouse_gesture_Response *resp);
static int handle_get_gesture(const zmk_mouse_gesture_GetGestureRequest *req,
                              zmk_mouse_gesture_Response *resp);
static int handle_add_gesture(const zmk_mouse_gesture_AddGestureRequest *req,
                              zmk_mouse_gesture_Response *resp);
static int handle_update_gesture(const zmk_mouse_gesture_UpdateGestureRequest *req,
                                 zmk_mouse_gesture_Response *resp);
static int handle_delete_gesture(const zmk_mouse_gesture_DeleteGestureRequest *req,
                                 zmk_mouse_gesture_Response *resp);
static int handle_reset_to_defaults(const zmk_mouse_gesture_ResetToDefaultsRequest *req,
                                    zmk_mouse_gesture_Response *resp);
static int handle_get_settings(const zmk_mouse_gesture_GetSettingsRequest *req,
                               zmk_mouse_gesture_Response *resp);
static int handle_set_settings(const zmk_mouse_gesture_SetSettingsRequest *req,
                               zmk_mouse_gesture_Response *resp);

/* Convenience: set the response's error variant. */
static void set_error(zmk_mouse_gesture_Response *resp, const char *msg) {
    zmk_mouse_gesture_ErrorResponse err = zmk_mouse_gesture_ErrorResponse_init_zero;
    strncpy(err.message, msg, sizeof(err.message) - 1);
    resp->which_response_type = zmk_mouse_gesture_Response_error_tag;
    resp->response_type.error = err;
}

/* === Dispatcher ======================================================== */

static bool mouse_gesture_rpc_handle_request(
    const zmk_custom_CallRequest *raw_request,
    pb_callback_t *encode_response) {

    zmk_mouse_gesture_Response *resp =
        ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(
            cormoran__mouse_gesture, encode_response);

    zmk_mouse_gesture_Request req = zmk_mouse_gesture_Request_init_zero;

    pb_istream_t in = pb_istream_from_buffer(raw_request->payload.bytes,
                                              raw_request->payload.size);
    if (!pb_decode(&in, zmk_mouse_gesture_Request_fields, &req)) {
        LOG_WRN("mouse_gesture: failed to decode request: %s",
                PB_GET_ERROR(&in));
        set_error(resp, "decode failed");
        return true;
    }

    int rc = 0;
    switch (req.which_request_type) {
    case zmk_mouse_gesture_Request_list_gestures_tag:
        rc = handle_list_gestures(&req.request_type.list_gestures, resp);
        break;
    case zmk_mouse_gesture_Request_get_gesture_tag:
        rc = handle_get_gesture(&req.request_type.get_gesture, resp);
        break;
    case zmk_mouse_gesture_Request_add_gesture_tag:
        rc = handle_add_gesture(&req.request_type.add_gesture, resp);
        break;
    case zmk_mouse_gesture_Request_update_gesture_tag:
        rc = handle_update_gesture(&req.request_type.update_gesture, resp);
        break;
    case zmk_mouse_gesture_Request_delete_gesture_tag:
        rc = handle_delete_gesture(&req.request_type.delete_gesture, resp);
        break;
    case zmk_mouse_gesture_Request_reset_to_defaults_tag:
        rc = handle_reset_to_defaults(&req.request_type.reset_to_defaults, resp);
        break;
    case zmk_mouse_gesture_Request_get_settings_tag:
        rc = handle_get_settings(&req.request_type.get_settings, resp);
        break;
    case zmk_mouse_gesture_Request_set_settings_tag:
        rc = handle_set_settings(&req.request_type.set_settings, resp);
        break;
    default:
        LOG_WRN("mouse_gesture: unsupported request type: %d",
                req.which_request_type);
        rc = -1;
        break;
    }

    if (rc != 0 && resp->which_response_type == 0) {
        set_error(resp, "request failed");
    }
    return true;
}

/* === Per-message handlers ============================================== */

static int handle_list_gestures(
    const zmk_mouse_gesture_ListGesturesRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    zmk_mouse_gesture_ListGesturesResponse out =
        zmk_mouse_gesture_ListGesturesResponse_init_zero;

    size_t count = NUM_DTS_GESTURES;
    if (count > ARRAY_SIZE(out.gestures)) {
        count = ARRAY_SIZE(out.gestures);
    }

    out.gestures_count = count;
    for (size_t i = 0; i < count; i++) {
        zmk_mouse_gesture_Gesture *g = &out.gestures[i];
        const struct dts_gesture_info *src = &dts_gestures[i];

        g->id = (uint32_t)i;
        if (src->name) {
            strncpy(g->name, src->name, sizeof(g->name) - 1);
        }

        g->has_pattern = true;
        size_t plen = src->pattern_len;
        if (plen > ARRAY_SIZE(g->pattern.directions)) {
            plen = ARRAY_SIZE(g->pattern.directions);
        }
        g->pattern.directions_count = plen;
        for (size_t j = 0; j < plen; j++) {
            g->pattern.directions[j] = kot_to_proto_direction(src->pattern[j]);
        }

        g->has_binding = true;
        if (src->binding_behavior) {
            strncpy(g->binding.behavior, src->binding_behavior,
                    sizeof(g->binding.behavior) - 1);
        }
        g->binding.param1 = src->binding_param1;
        g->binding.param2 = src->binding_param2;

        g->enabled = true;
    }

    resp->which_response_type = zmk_mouse_gesture_Response_list_gestures_tag;
    resp->response_type.list_gestures = out;
    return 0;
}

static int handle_get_gesture(
    const zmk_mouse_gesture_GetGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    if (req->id >= NUM_DTS_GESTURES) {
        set_error(resp, "gesture id out of range");
        return 0;
    }
    zmk_mouse_gesture_GestureResponse out =
        zmk_mouse_gesture_GestureResponse_init_zero;
    out.has_gesture = true;

    const struct dts_gesture_info *src = &dts_gestures[req->id];
    zmk_mouse_gesture_Gesture *g = &out.gesture;
    g->id = req->id;
    if (src->name) {
        strncpy(g->name, src->name, sizeof(g->name) - 1);
    }
    g->has_pattern = true;
    size_t plen = src->pattern_len;
    if (plen > ARRAY_SIZE(g->pattern.directions)) {
        plen = ARRAY_SIZE(g->pattern.directions);
    }
    g->pattern.directions_count = plen;
    for (size_t j = 0; j < plen; j++) {
        g->pattern.directions[j] = kot_to_proto_direction(src->pattern[j]);
    }
    g->has_binding = true;
    if (src->binding_behavior) {
        strncpy(g->binding.behavior, src->binding_behavior,
                sizeof(g->binding.behavior) - 1);
    }
    g->binding.param1 = src->binding_param1;
    g->binding.param2 = src->binding_param2;
    g->enabled = true;

    resp->which_response_type = zmk_mouse_gesture_Response_gesture_tag;
    resp->response_type.gesture = out;
    return 0;
}

static int handle_add_gesture(
    const zmk_mouse_gesture_AddGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "add_gesture: Phase 3");
    return 0;
}

static int handle_update_gesture(
    const zmk_mouse_gesture_UpdateGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "update_gesture: Phase 3");
    return 0;
}

static int handle_delete_gesture(
    const zmk_mouse_gesture_DeleteGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "delete_gesture: Phase 3");
    return 0;
}

static int handle_reset_to_defaults(
    const zmk_mouse_gesture_ResetToDefaultsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "reset_to_defaults: Phase 3");
    return 0;
}

static int handle_get_settings(
    const zmk_mouse_gesture_GetSettingsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    /* Phase 2: still hardcoded library defaults. Phase 4 will read from
     * the live driver config (and Phase 4 will let us write to NVS).
     */
    zmk_mouse_gesture_GetSettingsResponse out =
        zmk_mouse_gesture_GetSettingsResponse_init_zero;
    out.has_settings = true;
    out.settings.stroke_size = 200;
    out.settings.idle_timeout_ms = 150;
    out.settings.gesture_cooldown_ms = 500;
    out.settings.movement_threshold = 0;
    out.settings.enable_eager_mode = false;
    out.settings.always_active = false;
    resp->which_response_type = zmk_mouse_gesture_Response_settings_tag;
    resp->response_type.settings = out;
    return 0;
}

static int handle_set_settings(
    const zmk_mouse_gesture_SetSettingsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "set_settings: Phase 4");
    return 0;
}
