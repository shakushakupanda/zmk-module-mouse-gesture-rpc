/*
 * zmk-module-mouse-gesture-rpc — Custom Studio RPC handler
 *
 * Phase 1 skeleton: registers the subsystem and dispatches all 8 RPC
 * message types. Currently all handlers return empty / not-implemented
 * placeholders; subsequent phases fill in the runtime gesture store and
 * NVS persistence.
 */

#include <pb_decode.h>
#include <pb_encode.h>
#include <string.h>

#include <zmk/studio/custom.h>
#include <zmk/mouse_gesture/custom.pb.h>

#include <zephyr/logging/log.h>
LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* === Subsystem registration ============================================= */

static struct zmk_rpc_custom_subsystem_meta mouse_gesture_meta = {
    /* Where DYA Studio's "Subsystems" page should link to. Replace with
     * the published Web UI URL (GitHub Pages / Cloudflare Pages) once the
     * web/ frontend is deployed.
     */
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
/* Phase 1: every handler returns an empty / placeholder response.        */
/* Phase 2+ will replace these with real logic that reads / writes a      */
/* runtime store backed by Zephyr settings (NVS).                         */

static int handle_list_gestures(
    const zmk_mouse_gesture_ListGesturesRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    zmk_mouse_gesture_ListGesturesResponse out =
        zmk_mouse_gesture_ListGesturesResponse_init_zero;
    out.gestures_count = 0;  /* empty for now */
    resp->which_response_type = zmk_mouse_gesture_Response_list_gestures_tag;
    resp->response_type.list_gestures = out;
    return 0;
}

static int handle_get_gesture(
    const zmk_mouse_gesture_GetGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "get_gesture: not implemented");
    return 0;
}

static int handle_add_gesture(
    const zmk_mouse_gesture_AddGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "add_gesture: not implemented");
    return 0;
}

static int handle_update_gesture(
    const zmk_mouse_gesture_UpdateGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "update_gesture: not implemented");
    return 0;
}

static int handle_delete_gesture(
    const zmk_mouse_gesture_DeleteGestureRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "delete_gesture: not implemented");
    return 0;
}

static int handle_reset_to_defaults(
    const zmk_mouse_gesture_ResetToDefaultsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    set_error(resp, "reset_to_defaults: not implemented");
    return 0;
}

static int handle_get_settings(
    const zmk_mouse_gesture_GetSettingsRequest *req,
    zmk_mouse_gesture_Response *resp) {
    (void)req;
    /* Phase 1: return library defaults from kot149/zmk-mouse-gesture README.
     * Phase 4 will read from NVS-backed Settings struct.
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
    set_error(resp, "set_settings: not implemented");
    return 0;
}
