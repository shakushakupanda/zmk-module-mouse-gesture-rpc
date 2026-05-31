/**
 * High-level API for the mouse-gesture custom Studio RPC.
 *
 * Mirrors tools/python_cli/mg_cli.py's helper functions. Manages
 * request_id, discovers the subsystem index, encodes mouse_gesture
 * requests, and decodes responses.
 */

import {
    buildCallRequest,
    buildListSubsystemsRequest,
    parseCallResponse,
    parseListCustomSubsystemsResponse,
    parseStudioResponse,
    SubsystemInfo,
} from "./studioEnvelope";
import {
    buildAddGestureRequest,
    buildDeleteGestureRequest,
    buildGetGestureRequest,
    buildGetLogRequest,
    buildGetSettingsRequest,
    buildListGesturesRequest,
    buildResetToDefaultsRequest,
    buildSetSettingsRequest,
    buildUpdateGestureRequest,
    Gesture,
    LogEntry,
    parseResponse,
    Response as MgResponse,
    Settings,
} from "./mouseGestureProto";
import { SerialTransport } from "./transport";

export const SUBSYSTEM_IDENTIFIER = "cormoran__mouse_gesture";

export class MouseGestureClient {
    private tp: SerialTransport;
    private nextRequestId = 1;
    /** Cached subsystem index after first discovery. */
    private cachedIndex: number | null = null;

    constructor(tp: SerialTransport) {
        this.tp = tp;
    }

    private allocRequestId(): number {
        return this.nextRequestId++;
    }

    /** List all custom subsystems the firmware exposes. */
    async listSubsystems(): Promise<SubsystemInfo[]> {
        const env = buildListSubsystemsRequest(this.allocRequestId());
        const frame = await this.tp.call(env);
        const parsed = parseStudioResponse(frame);
        if (parsed.kind !== "list_custom_subsystems") {
            throw new Error(`Expected list response, got ${parsed.kind}`);
        }
        return parseListCustomSubsystemsResponse(parsed.payload);
    }

    /** Discover our subsystem's index (cached after first call). */
    async getSubsystemIndex(): Promise<number> {
        if (this.cachedIndex !== null) return this.cachedIndex;
        const list = await this.listSubsystems();
        const found = list.find((s) => s.identifier === SUBSYSTEM_IDENTIFIER);
        if (!found) {
            throw new Error(
                `Subsystem '${SUBSYSTEM_IDENTIFIER}' not found. ` +
                    `Available: ${list.map((s) => s.identifier).join(", ")}`,
            );
        }
        this.cachedIndex = found.index;
        return found.index;
    }

    private async callRPC(payload: Uint8Array): Promise<MgResponse> {
        const idx = await this.getSubsystemIndex();
        const env = buildCallRequest(idx, payload, this.allocRequestId());
        const frame = await this.tp.call(env);
        const parsed = parseStudioResponse(frame);
        if (parsed.kind !== "call") {
            throw new Error(`Expected call response, got ${parsed.kind}`);
        }
        const callResp = parseCallResponse(parsed.payload);
        const resp = parseResponse(callResp.payload);
        if (resp.kind === "error") {
            throw new Error(`Firmware error: ${resp.message}`);
        }
        return resp;
    }

    async listGestures(): Promise<Gesture[]> {
        const resp = await this.callRPC(buildListGesturesRequest());
        if (resp.kind !== "listGestures") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.gestures;
    }

    async getGesture(id: number): Promise<Gesture> {
        const resp = await this.callRPC(buildGetGestureRequest(id));
        if (resp.kind !== "gesture") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.gesture;
    }

    async addGesture(g: Gesture): Promise<Gesture> {
        const resp = await this.callRPC(buildAddGestureRequest(g));
        if (resp.kind !== "gesture") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.gesture;
    }

    async updateGesture(g: Gesture): Promise<Gesture> {
        const resp = await this.callRPC(buildUpdateGestureRequest(g));
        if (resp.kind !== "gesture") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.gesture;
    }

    async deleteGesture(id: number): Promise<void> {
        const resp = await this.callRPC(buildDeleteGestureRequest(id));
        if (resp.kind !== "empty") throw new Error(`Unexpected: ${resp.kind}`);
    }

    async resetToDefaults(): Promise<void> {
        const resp = await this.callRPC(buildResetToDefaultsRequest());
        if (resp.kind !== "empty") throw new Error(`Unexpected: ${resp.kind}`);
    }

    async getSettings(): Promise<Settings> {
        const resp = await this.callRPC(buildGetSettingsRequest());
        if (resp.kind !== "settings") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.settings;
    }

    async setSettings(s: Settings): Promise<Settings> {
        const resp = await this.callRPC(buildSetSettingsRequest(s));
        if (resp.kind !== "settings") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.settings;
    }

    async getLog(): Promise<LogEntry[]> {
        const resp = await this.callRPC(buildGetLogRequest());
        if (resp.kind !== "log") throw new Error(`Unexpected: ${resp.kind}`);
        return resp.entries;
    }
}
