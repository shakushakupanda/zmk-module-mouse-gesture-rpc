/**
 * Hand-rolled protobuf encoders/decoders for zmk.mouse_gesture.* messages.
 * Mirrors proto/zmk/mouse_gesture/custom.proto.
 *
 * Field numbers and structure must stay in sync with that .proto and with
 * the firmware's mg_pb.* usage.
 */

import {
    concat,
    encodeBoolField,
    encodeBytesField,
    encodeMessageField,
    encodeStringField,
    encodeVarintField,
    encodeVarint,
    encodeTag,
    walkFields,
} from "./protobuf";

// === Enums ===

export enum Direction {
    UP = 0,
    RIGHT = 1,
    DOWN = 2,
    LEFT = 3,
}

// === Message types ===

export interface GesturePattern {
    directions: Direction[];
}

export interface Binding {
    behavior: string;
    param1: number;
    param2: number;
}

export interface Gesture {
    id: number;
    name: string;
    pattern: GesturePattern;
    binding: Binding;
    enabled: boolean;
    /** Gesture key / activation set ID selected by &mg_set N. */
    setId: number;
}

export interface Settings {
    strokeSize: number;
    idleTimeoutMs: number;
    gestureCooldownMs: number;
    movementThreshold: number;
    enableEagerMode: boolean;
    alwaysActive: boolean;
    inertialScrollEnabled: boolean;
    inertialScrollTickMs: number;
    inertialScrollIdleMs: number;
    inertialScrollDecayPercent: number;
    inertialScrollImpulsePercent: number;
    inertialScrollMinVelocityQ8: number;
    inertialScrollMaxTicks: number;
}

export interface LogEntry {
    tsMs: number;
    code: number;
    arg1: number;
    arg2: number;
}

// === GesturePattern ===

function encodeGesturePattern(p: GesturePattern): Uint8Array {
    if (p.directions.length === 0) return new Uint8Array(0);
    // Packed repeated field: tag (wire=2) + length + concatenated varints
    const inner = concat(...p.directions.map((d) => encodeVarint(d)));
    return concat(encodeTag(1, 2), encodeVarint(inner.length), inner);
}

function decodeGesturePattern(buf: Uint8Array): GesturePattern {
    const directions: Direction[] = [];
    for (const f of walkFields(buf)) {
        if (f.field !== 1) continue;
        if (f.wire === 2) {
            // packed
            for (const f2 of walkVarintsPacked(f.raw)) directions.push(f2 as Direction);
        } else if (f.wire === 0 && f.value !== undefined) {
            directions.push(f.value as Direction);
        }
    }
    return { directions };
}

function* walkVarintsPacked(buf: Uint8Array): IterableIterator<number> {
    let i = 0;
    while (i < buf.length) {
        let result = 0;
        let shift = 0;
        while (true) {
            const b = buf[i++];
            result |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
        }
        yield result >>> 0;
    }
}

// === Binding ===

function encodeBinding(b: Binding): Uint8Array {
    const parts: Uint8Array[] = [];
    if (b.behavior.length > 0) parts.push(encodeStringField(1, b.behavior));
    if (b.param1 !== 0) parts.push(encodeVarintField(2, b.param1));
    if (b.param2 !== 0) parts.push(encodeVarintField(3, b.param2));
    return concat(...parts);
}

function decodeBinding(buf: Uint8Array): Binding {
    const out: Binding = { behavior: "", param1: 0, param2: 0 };
    for (const f of walkFields(buf)) {
        if (f.field === 1) out.behavior = new TextDecoder().decode(f.raw);
        else if (f.field === 2 && f.value !== undefined) out.param1 = f.value;
        else if (f.field === 3 && f.value !== undefined) out.param2 = f.value;
    }
    return out;
}

// === Gesture ===

function encodeGesture(g: Gesture): Uint8Array {
    const parts: Uint8Array[] = [];
    if (g.id !== 0) parts.push(encodeVarintField(1, g.id));
    if (g.name.length > 0) parts.push(encodeStringField(2, g.name));
    parts.push(encodeMessageField(3, encodeGesturePattern(g.pattern)));
    parts.push(encodeMessageField(4, encodeBinding(g.binding)));
    if (g.enabled) parts.push(encodeBoolField(5, g.enabled));
    if (g.setId !== 0) parts.push(encodeVarintField(6, g.setId));
    return concat(...parts);
}

function decodeGesture(buf: Uint8Array): Gesture {
    const out: Gesture = {
        id: 0,
        name: "",
        pattern: { directions: [] },
        binding: { behavior: "", param1: 0, param2: 0 },
        enabled: false,
        setId: 0,
    };
    for (const f of walkFields(buf)) {
        if (f.field === 1 && f.value !== undefined) out.id = f.value;
        else if (f.field === 2) out.name = new TextDecoder().decode(f.raw);
        else if (f.field === 3) out.pattern = decodeGesturePattern(f.raw);
        else if (f.field === 4) out.binding = decodeBinding(f.raw);
        else if (f.field === 5 && f.value !== undefined) out.enabled = f.value !== 0;
        else if (f.field === 6 && f.value !== undefined) out.setId = f.value;
    }
    return out;
}

// === Settings ===

function encodeSettings(s: Settings): Uint8Array {
    const parts: Uint8Array[] = [];
    if (s.strokeSize !== 0) parts.push(encodeVarintField(1, s.strokeSize));
    if (s.idleTimeoutMs !== 0) parts.push(encodeVarintField(2, s.idleTimeoutMs));
    if (s.gestureCooldownMs !== 0) parts.push(encodeVarintField(3, s.gestureCooldownMs));
    if (s.movementThreshold !== 0) parts.push(encodeVarintField(4, s.movementThreshold));
    if (s.enableEagerMode) parts.push(encodeBoolField(5, s.enableEagerMode));
    if (s.alwaysActive) parts.push(encodeBoolField(6, s.alwaysActive));
    if (s.inertialScrollEnabled) parts.push(encodeBoolField(7, s.inertialScrollEnabled));
    if (s.inertialScrollTickMs !== 0) parts.push(encodeVarintField(8, s.inertialScrollTickMs));
    if (s.inertialScrollIdleMs !== 0) parts.push(encodeVarintField(9, s.inertialScrollIdleMs));
    if (s.inertialScrollDecayPercent !== 0) parts.push(encodeVarintField(10, s.inertialScrollDecayPercent));
    if (s.inertialScrollImpulsePercent !== 0) parts.push(encodeVarintField(11, s.inertialScrollImpulsePercent));
    if (s.inertialScrollMinVelocityQ8 !== 0) parts.push(encodeVarintField(12, s.inertialScrollMinVelocityQ8));
    if (s.inertialScrollMaxTicks !== 0) parts.push(encodeVarintField(13, s.inertialScrollMaxTicks));
    return concat(...parts);
}

function decodeSettings(buf: Uint8Array): Settings {
    const out: Settings = {
        strokeSize: 0,
        idleTimeoutMs: 0,
        gestureCooldownMs: 0,
        movementThreshold: 0,
        enableEagerMode: false,
        alwaysActive: false,
        inertialScrollEnabled: true,
        inertialScrollTickMs: 20,
        inertialScrollIdleMs: 28,
        inertialScrollDecayPercent: 86,
        inertialScrollImpulsePercent: 180,
        inertialScrollMinVelocityQ8: 96,
        inertialScrollMaxTicks: 36,
    };
    for (const f of walkFields(buf)) {
        if (f.field === 1 && f.value !== undefined) out.strokeSize = f.value;
        else if (f.field === 2 && f.value !== undefined) out.idleTimeoutMs = f.value;
        else if (f.field === 3 && f.value !== undefined) out.gestureCooldownMs = f.value;
        else if (f.field === 4 && f.value !== undefined) out.movementThreshold = f.value;
        else if (f.field === 5 && f.value !== undefined) out.enableEagerMode = f.value !== 0;
        else if (f.field === 6 && f.value !== undefined) out.alwaysActive = f.value !== 0;
        else if (f.field === 7 && f.value !== undefined) out.inertialScrollEnabled = f.value !== 0;
        else if (f.field === 8 && f.value !== undefined) out.inertialScrollTickMs = f.value;
        else if (f.field === 9 && f.value !== undefined) out.inertialScrollIdleMs = f.value;
        else if (f.field === 10 && f.value !== undefined) out.inertialScrollDecayPercent = f.value;
        else if (f.field === 11 && f.value !== undefined) out.inertialScrollImpulsePercent = f.value;
        else if (f.field === 12 && f.value !== undefined) out.inertialScrollMinVelocityQ8 = f.value;
        else if (f.field === 13 && f.value !== undefined) out.inertialScrollMaxTicks = f.value;
    }
    return out;
}

// === LogEntry ===

function decodeLogEntry(buf: Uint8Array): LogEntry {
    const out: LogEntry = { tsMs: 0, code: 0, arg1: 0, arg2: 0 };
    for (const f of walkFields(buf)) {
        if (f.field === 1 && f.value !== undefined) out.tsMs = f.value;
        else if (f.field === 2 && f.value !== undefined) out.code = f.value;
        else if (f.field === 3 && f.value !== undefined) out.arg1 = f.value;
        else if (f.field === 4 && f.value !== undefined) out.arg2 = f.value;
    }
    return out;
}

// === Request builders ===

// Request.request_type oneof tag numbers:
const REQ_LIST_GESTURES = 1;
const REQ_GET_GESTURE = 2;
const REQ_ADD_GESTURE = 3;
const REQ_UPDATE_GESTURE = 4;
const REQ_DELETE_GESTURE = 5;
const REQ_RESET_TO_DEFAULTS = 6;
const REQ_GET_SETTINGS = 7;
const REQ_SET_SETTINGS = 8;
const REQ_GET_LOG = 9;

export function buildListGesturesRequest(): Uint8Array {
    return encodeMessageField(REQ_LIST_GESTURES, new Uint8Array(0));
}

export function buildGetGestureRequest(id: number): Uint8Array {
    const inner = encodeVarintField(1, id);
    return encodeMessageField(REQ_GET_GESTURE, inner);
}

export function buildAddGestureRequest(g: Gesture): Uint8Array {
    // AddGestureRequest { Gesture gesture = 1 }
    const inner = encodeMessageField(1, encodeGesture(g));
    return encodeMessageField(REQ_ADD_GESTURE, inner);
}

export function buildUpdateGestureRequest(g: Gesture): Uint8Array {
    const inner = encodeMessageField(1, encodeGesture(g));
    return encodeMessageField(REQ_UPDATE_GESTURE, inner);
}

export function buildDeleteGestureRequest(id: number): Uint8Array {
    const inner = encodeVarintField(1, id);
    return encodeMessageField(REQ_DELETE_GESTURE, inner);
}

export function buildResetToDefaultsRequest(): Uint8Array {
    return encodeMessageField(REQ_RESET_TO_DEFAULTS, new Uint8Array(0));
}

export function buildGetSettingsRequest(): Uint8Array {
    return encodeMessageField(REQ_GET_SETTINGS, new Uint8Array(0));
}

export function buildSetSettingsRequest(s: Settings): Uint8Array {
    const inner = encodeMessageField(1, encodeSettings(s));
    return encodeMessageField(REQ_SET_SETTINGS, inner);
}

export function buildGetLogRequest(): Uint8Array {
    return encodeMessageField(REQ_GET_LOG, new Uint8Array(0));
}

// === Response parser ===

// Response.response_type oneof tag numbers:
const RESP_ERROR = 1;
const RESP_LIST_GESTURES = 2;
const RESP_GESTURE = 3;
const RESP_EMPTY = 4;
const RESP_SETTINGS = 5;
const RESP_LOG = 6;

export type Response =
    | { kind: "error"; message: string }
    | { kind: "listGestures"; gestures: Gesture[] }
    | { kind: "gesture"; gesture: Gesture }
    | { kind: "empty" }
    | { kind: "settings"; settings: Settings }
    | { kind: "log"; entries: LogEntry[] };

export function parseResponse(buf: Uint8Array): Response {
    for (const f of walkFields(buf)) {
        if (f.field === RESP_ERROR) {
            let message = "";
            for (const f2 of walkFields(f.raw)) {
                if (f2.field === 1) message = new TextDecoder().decode(f2.raw);
            }
            return { kind: "error", message };
        }
        if (f.field === RESP_LIST_GESTURES) {
            const gestures: Gesture[] = [];
            for (const f2 of walkFields(f.raw)) {
                if (f2.field === 1) gestures.push(decodeGesture(f2.raw));
            }
            return { kind: "listGestures", gestures };
        }
        if (f.field === RESP_GESTURE) {
            let g: Gesture = {
                id: 0,
                name: "",
                pattern: { directions: [] },
                binding: { behavior: "", param1: 0, param2: 0 },
                enabled: false,
                setId: 0,
            };
            for (const f2 of walkFields(f.raw)) {
                if (f2.field === 1) g = decodeGesture(f2.raw);
            }
            return { kind: "gesture", gesture: g };
        }
        if (f.field === RESP_EMPTY) {
            return { kind: "empty" };
        }
        if (f.field === RESP_SETTINGS) {
            let s: Settings = {
                strokeSize: 0,
                idleTimeoutMs: 0,
                gestureCooldownMs: 0,
                movementThreshold: 0,
                enableEagerMode: false,
                alwaysActive: false,
            };
            for (const f2 of walkFields(f.raw)) {
                if (f2.field === 1) s = decodeSettings(f2.raw);
            }
            return { kind: "settings", settings: s };
        }
        if (f.field === RESP_LOG) {
            const entries: LogEntry[] = [];
            for (const f2 of walkFields(f.raw)) {
                if (f2.field === 1) entries.push(decodeLogEntry(f2.raw));
            }
            return { kind: "log", entries };
        }
    }
    throw new Error("Response had no recognized response_type oneof variant");
}
