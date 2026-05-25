/*
 * zmk-module-mouse-gesture-rpc — Custom Studio RPC handler.
 *
 * Phase 3: all 6 mutating RPCs (List/Get/Add/Update/Delete/Reset) go
 * through gesture_store.c, which persists to Zephyr settings. The
 * settings RPCs still return library defaults (Phase 4 wiring).
 *
 * Important caveat: kot149/zmk-mouse-gesture's input processor still
 * matches against its compile-time trie. The store changes are visible
 * to RPC clients and survive reboots, but actual gesture matching
 * behavior is unchanged until we route input through the store in
 * Phase 4+.
 */

#include <pb_decode.h>
#include <pb_encode.h>
#include <string.h>
#include <errno.h>

#include <zephyr/init.h>
#include <zephyr/kernel.h>

#include <zmk/studio/custom.h>
#include <zmk/mouse_gesture/custom.pb.h>

#include "../storage/gesture_store.h"

#include <zephyr/logging/log.h>
LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* === Subsystem registration ============================================= */

static struct zmk_rpc_custom_subsystem_meta mouse_gesture_meta = {
    ZMK_RPC_CUSTOM_SUBSYSTEM_UI_URLS(
        "https://shakushakupanda.github.io/zmk-module-mouse-gesture-rpc/"),
    .security = ZMK_STUDIO_RPC_HANDLER_UNSECURED,
};

static bool mouse_gesture_rpc_handle_request(
    const zmk_custom_CallRequest *raw_request,
    pb_callback_t *encode_response);

ZMK_RPC_CUSTOM_SUBSYSTEM(cormoran__mouse_gesture, &mouse_gesture_meta,
                        mouse_gesture_rpc_handle_request);

ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(cormoran__mouse_gesture,
                                       zmk_mouse_gesture_Response);

/* Initialize the gesture store at boot. */
static int mg_handler_init(void) {
    return mg_store_init();
}
SYS_INIT(mg_handler_init, APPLICATION, 90);

/* === Convenience helpers =============================================== */

static void set_error(zmk_mouse_gesture_Response *resp, const char *msg) {
    zmk_mouse_gesture_ErrorResponse err = zmk_mouse_gesture_ErrorResponse_init_zero;
    strncpy(err.message, msg, sizeof(err.message) - 1);
    resp->which_response_type = zmk_mouse_gesture_Response_error_tag;
    resp->response_type.error = err;
}

/* Copy a stored gesture into a proto Gesture struct. */
static void copy_to_proto(const struct mg_gesture *src,
                          zmk_mouse_gesture_Gesture *out) {
    out->id = src->id;
    strncpy(out->name, src->name, sizeof(out->name) - 1);
    out->has_pattern = true;
    size_t plen = src->pattern_len;
    if (plen > ARRAY_SIZE(out->pattern.directions)) {
        plen = ARRAY_SIZE(out->pattern.directions);
    }
    out->pattern.directions_count = plen;
    for (size_t j = 0; j < plen; j++) {
        out->pattern.directions[j] = src->pattern[j];
    }
    out->has_binding = true;
    strncpy(out->binding.behavior, src->binding_behavior,
            sizeof(out->binding.behavior) - 1);
    out->binding.param1 = src->binding_param1;
    out->binding.param2 = src->binding_param2;
    out->enabled = src->enabled;
}

/* Copy from proto Gesture into our store struct (caller fills id). */
static void copy_from_proto(const zmk_mouse_gesture_Gesture *src,
                            struct mg_gesture *out) {
    memset(out, 0, sizeof(*out));
    out->id = src->id;
    out->enabled = src->enabled;
    strncpy(out->name, src->name, sizeof(out->name) - 1);
    strncpy(out->binding_behavior, src->binding.behavior,
            sizeof(out->binding_behavior) - 1);
    out->binding_param1 = src->binding.param1;
    out->binding_param2 = src->binding.param2;
    size_t plen = src->has_pattern ? src->pattern.directions_count : 0;
    if (plen > MG_PATTERN_MAX) plen = MG_PATTERN_MAX;
    out->pattern_len = plen;
    for (size_t j = 0; j < plen; j++) {
        out->pattern[j] = (uint8_t)src->pattern.directions[j];
    }
}

/* === Per-message handlers ============================================== */

static int handle_list_gestures(
    const zmk_mouse_gesture_ListGesturesRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    zmk_mouse_gesture_ListGesturesResponse out =
        zmk_mouse_gesture_ListGesturesResponse_init_zero;

    size_t count = mg_store_count();
    if (count > ARRAY_SIZE(out.gestures)) count = ARRAY_SIZE(out.gestures);
    out.gestures_count = count;
    for (size_t i = 0; i < count; i++) {
        const struct mg_gesture *src = mg_store_at(i);
        if (!src) break;
        copy_to_proto(src, &out.gestures[i]);
    }
    resp->which_response_type = zmk_mouse_gesture_Response_list_gestures_tag;
    resp->response_type.list_gestures = out;
    return 0;
}

static int handle_get_gesture(
    const zmk_mouse_gesture_GetGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    const struct mg_gesture *src = mg_store_find(req->id);
    if (!src) {
        set_error(resp, "gesture not found");
        return 0;
    }
    zmk_mouse_gesture_GestureResponse out =
        zmk_mouse_gesture_GestureResponse_init_zero;
    out.has_gesture = true;
    copy_to_proto(src, &out.gesture);
    resp->which_response_type = zmk_mouse_gesture_Response_gesture_tag;
    resp->response_type.gesture = out;
    return 0;
}

static int handle_add_gesture(
    const zmk_mouse_gesture_AddGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    if (!req->has_gesture) {
        set_error(resp, "add: missing gesture");
        return 0;
    }
    struct mg_gesture tmp;
    copy_from_proto(&req->gesture, &tmp);

    uint32_t new_id = 0;
    int rc = mg_store_add(&tmp, &new_id);
    if (rc == -ENOSPC) {
        set_error(resp, "store full");
        return 0;
    }
    if (rc == -EINVAL) {
        set_error(resp, "invalid pattern");
        return 0;
    }
    if (rc) {
        set_error(resp, "add failed");
        return 0;
    }

    /* Echo the freshly-stored gesture back, with the assigned id. */
    zmk_mouse_gesture_GestureResponse out =
        zmk_mouse_gesture_GestureResponse_init_zero;
    out.has_gesture = true;
    const struct mg_gesture *stored = mg_store_find(new_id);
    if (stored) copy_to_proto(stored, &out.gesture);
    resp->which_response_type = zmk_mouse_gesture_Response_gesture_tag;
    resp->response_type.gesture = out;
    return 0;
}

static int handle_update_gesture(
    const zmk_mouse_gesture_UpdateGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    if (!req->has_gesture) {
        set_error(resp, "update: missing gesture");
        return 0;
    }
    struct mg_gesture tmp;
    copy_from_proto(&req->gesture, &tmp);
    int rc = mg_store_update(&tmp);
    if (rc == -ENOENT) {
        set_error(resp, "gesture not found");
        return 0;
    }
    if (rc) {
        set_error(resp, "update failed");
        return 0;
    }

    zmk_mouse_gesture_GestureResponse out =
        zmk_mouse_gesture_GestureResponse_init_zero;
    out.has_gesture = true;
    const struct mg_gesture *stored = mg_store_find(tmp.id);
    if (stored) copy_to_proto(stored, &out.gesture);
    resp->which_response_type = zmk_mouse_gesture_Response_gesture_tag;
    resp->response_type.gesture = out;
    return 0;
}

static int handle_delete_gesture(
    const zmk_mouse_gesture_DeleteGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    int rc = mg_store_delete(req->id);
    if (rc == -ENOENT) {
        set_error(resp, "gesture not found");
        return 0;
    }
    if (rc) {
        set_error(resp, "delete failed");
        return 0;
    }
    zmk_mouse_gesture_Empty out = zmk_mouse_gesture_Empty_init_zero;
    resp->which_response_type = zmk_mouse_gesture_Response_empty_tag;
    resp->response_type.empty = out;
    return 0;
}

static int handle_reset_to_defaults(
    const zmk_mouse_gesture_ResetToDefaultsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    int rc = mg_store_reset_to_defaults();
    if (rc) {
        set_error(resp, "reset failed");
        return 0;
    }
    zmk_mouse_gesture_Empty out = zmk_mouse_gesture_Empty_init_zero;
    resp->which_response_type = zmk_mouse_gesture_Response_empty_tag;
    resp->response_type.empty = out;
    return 0;
}

static int handle_get_settings(
    const zmk_mouse_gesture_GetSettingsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    zmk_mouse_gesture_GetSettingsResponse out =
        zmk_mouse_gesture_GetSettingsResponse_init_zero;
    out.has_settings = true;
    out.settings.stroke_size         = 200;
    out.settings.idle_timeout_ms     = 150;
    out.settings.gesture_cooldown_ms = 500;
    out.settings.movement_threshold  = 0;
    out.settings.enable_eager_mode   = false;
    out.settings.always_active       = false;
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
        LOG_WRN("mouse_gesture: decode failed: %s", PB_GET_ERROR(&in));
        set_error(resp, "decode failed");
        return true;
    }

    int rc = 0;
    switch (req.which_request_type) {
    case zmk_mouse_gesture_Request_list_gestures_tag:
        rc = handle_list_gestures(&req.request_type.list_gestures, resp); break;
    case zmk_mouse_gesture_Request_get_gesture_tag:
        rc = handle_get_gesture(&req.request_type.get_gesture, resp); break;
    case zmk_mouse_gesture_Request_add_gesture_tag:
        rc = handle_add_gesture(&req.request_type.add_gesture, resp); break;
    case zmk_mouse_gesture_Request_update_gesture_tag:
        rc = handle_update_gesture(&req.request_type.update_gesture, resp); break;
    case zmk_mouse_gesture_Request_delete_gesture_tag:
        rc = handle_delete_gesture(&req.request_type.delete_gesture, resp); break;
    case zmk_mouse_gesture_Request_reset_to_defaults_tag:
        rc = handle_reset_to_defaults(&req.request_type.reset_to_defaults, resp); break;
    case zmk_mouse_gesture_Request_get_settings_tag:
        rc = handle_get_settings(&req.request_type.get_settings, resp); break;
    case zmk_mouse_gesture_Request_set_settings_tag:
        rc = handle_set_settings(&req.request_type.set_settings, resp); break;
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
