/**
 * ZMK Studio outer protobuf envelope (cormoran fork).
 *
 * Port of tools/python_cli/studio_envelope.py. See that file for the
 * exact field numbers (zmk.studio.Request, zmk.custom.Request, etc).
 */

import {
    concat,
    encodeMessageField,
    encodeVarintField,
    encodeBytesField,
    walkFields,
} from "./protobuf";

// === Inner zmk.custom.Request construction ===

function encodeListCustomSubsystemsRequest(): Uint8Array {
    // ListCustomSubsystemRequest is empty
    return encodeMessageField(1, new Uint8Array(0));
}

function encodeCallRequest(subsystemIndex: number, payload: Uint8Array): Uint8Array {
    const callReq = concat(
        encodeVarintField(1, subsystemIndex), // CallRequest.subsystem_index = 1
        encodeBytesField(2, payload),         // CallRequest.payload = 2
    );
    return encodeMessageField(2, callReq);     // request_type.call = 2
}

// === Outer zmk.studio.Request construction ===

function encodeStudioRequest(customRequest: Uint8Array, requestId: number): Uint8Array {
    return concat(
        encodeVarintField(1, requestId),         // Request.request_id = 1
        encodeMessageField(100, customRequest),  // Request.subsystem.custom = 100
    );
}

// === Public builders ===

export function buildListSubsystemsRequest(requestId = 1): Uint8Array {
    return encodeStudioRequest(encodeListCustomSubsystemsRequest(), requestId);
}

export function buildCallRequest(
    subsystemIndex: number,
    payload: Uint8Array,
    requestId = 1,
): Uint8Array {
    return encodeStudioRequest(encodeCallRequest(subsystemIndex, payload), requestId);
}

// === Response parsers ===

export type ResponseKind = "list_custom_subsystems" | "call";

export interface ParsedResponse {
    payload: Uint8Array;
    kind: ResponseKind;
}

export function parseStudioResponse(envelope: Uint8Array): ParsedResponse {
    // envelope: Response { type oneof: request_response=1 | notification=2 }
    let rrBytes: Uint8Array | null = null;
    for (const f of walkFields(envelope)) {
        if (f.field === 1) {
            rrBytes = f.raw;
            break;
        }
        if (f.field === 2) throw new Error("Got a notification, not a request response");
    }
    if (rrBytes === null) throw new Error("Response had no request_response");

    // RequestResponse: request_id=1, subsystem.custom=100, maybe meta=2
    let customBytes: Uint8Array | null = null;
    let metaBytes: Uint8Array | null = null;
    for (const f of walkFields(rrBytes)) {
        if (f.field === 100) customBytes = f.raw;
        else if (f.field === 2) metaBytes = f.raw;
    }
    if (customBytes === null) {
        if (metaBytes !== null) {
            throw new Error(`Firmware returned meta error (${bytesToHex(metaBytes)})`);
        }
        throw new Error("Response missing zmk.custom.Response (field 100)");
    }

    // zmk.custom.Response oneof: 1=list_custom_subsystems, 2=call
    for (const f of walkFields(customBytes)) {
        if (f.field === 1) return { payload: f.raw, kind: "list_custom_subsystems" };
        if (f.field === 2) return { payload: f.raw, kind: "call" };
    }
    throw new Error("zmk.custom.Response had no recognized oneof variant");
}

export interface CallResponse {
    subsystemIndex: number;
    payload: Uint8Array;
}

export function parseCallResponse(payload: Uint8Array): CallResponse {
    let idx = 0;
    let inner = new Uint8Array(0);
    for (const f of walkFields(payload)) {
        if (f.field === 1 && f.value !== undefined) idx = f.value;
        else if (f.field === 2) inner = f.raw;
    }
    return { subsystemIndex: idx, payload: inner };
}

export interface SubsystemInfo {
    index: number;
    identifier: string;
    uiUrls: string[];
}

export function parseListCustomSubsystemsResponse(payload: Uint8Array): SubsystemInfo[] {
    const out: SubsystemInfo[] = [];
    for (const f of walkFields(payload)) {
        if (f.field !== 1) continue;
        const info: SubsystemInfo = { index: 0, identifier: "", uiUrls: [] };
        for (const f2 of walkFields(f.raw)) {
            if (f2.field === 1 && f2.value !== undefined) info.index = f2.value;
            else if (f2.field === 2) info.identifier = new TextDecoder().decode(f2.raw);
            else if (f2.field === 3) info.uiUrls.push(new TextDecoder().decode(f2.raw));
        }
        out.push(info);
    }
    return out;
}

function bytesToHex(b: Uint8Array): string {
    return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
