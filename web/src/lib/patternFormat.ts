/**
 * UI helpers for rendering gestures and bindings.
 */

import { Direction } from "./mouseGestureProto";

export const DIRECTION_ARROWS: Record<Direction, string> = {
    [Direction.UP]: "↑",
    [Direction.RIGHT]: "→",
    [Direction.DOWN]: "↓",
    [Direction.LEFT]: "←",
};

export const DIRECTION_LABELS: Record<Direction, string> = {
    [Direction.UP]: "UP",
    [Direction.RIGHT]: "RIGHT",
    [Direction.DOWN]: "DOWN",
    [Direction.LEFT]: "LEFT",
};

export function patternToArrows(directions: Direction[]): string {
    if (!directions.length) return "—";
    return directions.map((d) => DIRECTION_ARROWS[d] ?? "?").join(" ");
}

/** Format binding for display: `&key_press 0x0800001A` etc. */
export function bindingToString(
    behavior: string,
    param1: number,
    param2: number,
): string {
    if (!behavior) return "—";
    const p1 = `0x${param1.toString(16).padStart(p1Width(param1), "0").toUpperCase()}`;
    if (param2 === 0) return `&${behavior} ${p1}`;
    const p2 = `0x${param2.toString(16).toUpperCase()}`;
    return `&${behavior} ${p1} ${p2}`;
}

function p1Width(p: number): number {
    if (p === 0) return 1;
    // Show 8 hex digits if upper bytes used (e.g. modifiers), else minimal
    return p > 0xffff ? 8 : 4;
}

/** Parse a string like "0x1A", "26", "0b00011010" into a number. */
export function parseIntLoose(s: string): number {
    const t = s.trim();
    if (t === "") return 0;
    if (/^0x/i.test(t)) return parseInt(t.slice(2), 16);
    if (/^0b/i.test(t)) return parseInt(t.slice(2), 2);
    return parseInt(t, 10);
}

/** Breadcrumb code → mnemonic. Mirrors src/storage/log_ring.h. */
export const LOG_CODE_NAMES: Record<number, string> = {
    0x0001: "BOOT_ENTER",
    0x0002: "BOOT_LOADED",
    0x0003: "BOOT_SEEDED",
    0x0004: "BOOT_SYNC_PRE",
    0x0005: "BOOT_SYNC_POST",
    0x0006: "BOOT_DONE",
    0x0101: "ADD_ENTER",
    0x0102: "ADD_COPIED",
    0x0103: "ADD_SAVED",
    0x0104: "ADD_SYNCED",
    0x0105: "ADD_RETURN",
    0x0201: "UPDATE_ENTER",
    0x0202: "UPDATE_SAVED",
    0x0203: "UPDATE_SYNCED",
    0x0204: "UPDATE_RETURN",
    0x0301: "DELETE_ENTER",
    0x0302: "DELETE_COMPACTED",
    0x0303: "DELETE_SAVED",
    0x0304: "DELETE_RETURN",
    0x0401: "RESET_ENTER",
    0x0402: "RESET_SEEDED",
    0x0403: "RESET_SAVED",
    0x0404: "RESET_SYNCED",
    0x0405: "RESET_RETURN",
    0x0501: "SYNC_ENTER",
    0x0502: "SYNC_PATTERNS_BUILT",
    0x0503: "SYNC_RUNTIME_SET_PRE",
    0x0504: "SYNC_RUNTIME_SET_POST",
    0x0505: "SYNC_RETURN",
    0x0601: "RPC_ENTER",
    0x0602: "RPC_DECODE_OK",
    0x0603: "RPC_DECODE_FAIL",
    0x0604: "RPC_DISPATCH",
    0x0605: "RPC_HANDLER_RETURN",
};
