/**
 * Minimal hand-rolled protobuf wire-format encoder/decoder.
 * Just enough for our outer envelope + mouse_gesture messages.
 * No reflection, no codegen — keeps the bundle tiny.
 */

// === Encoding helpers ===================================================

export function encodeVarint(n: number): Uint8Array {
    // JS numbers can hold up to 2^53; for our uint32 fields this is fine.
    const out: number[] = [];
    let v = n >>> 0; // force unsigned 32-bit interpretation
    while (true) {
        const b = v & 0x7f;
        v = v >>> 7;
        if (v === 0) {
            out.push(b);
            return Uint8Array.from(out);
        }
        out.push(b | 0x80);
    }
}

export function encodeTag(field: number, wireType: number): Uint8Array {
    return encodeVarint((field << 3) | wireType);
}

export function encodeVarintField(field: number, n: number): Uint8Array {
    return concat(encodeTag(field, 0), encodeVarint(n));
}

export function encodeBytesField(field: number, data: Uint8Array): Uint8Array {
    return concat(encodeTag(field, 2), encodeVarint(data.length), data);
}

export function encodeStringField(field: number, s: string): Uint8Array {
    const data = new TextEncoder().encode(s);
    return encodeBytesField(field, data);
}

export function encodeBoolField(field: number, b: boolean): Uint8Array {
    return encodeVarintField(field, b ? 1 : 0);
}

export function encodeMessageField(field: number, body: Uint8Array): Uint8Array {
    return encodeBytesField(field, body);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

// === Decoding helpers ===================================================

export interface FieldEntry {
    field: number;
    wire: number;
    /** For varint: numeric value. For length-delimited: undefined. */
    value: number | undefined;
    /** For length-delimited: the raw bytes (just the payload). For varint: empty. */
    raw: Uint8Array;
}

export function readVarint(buf: Uint8Array, offset: number): [number, number] {
    let result = 0;
    let shift = 0;
    let i = offset;
    while (true) {
        const b = buf[i++];
        result |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) {
            // force to unsigned 32-bit
            return [result >>> 0, i];
        }
        shift += 7;
        if (shift >= 64) throw new Error("varint overflow");
    }
}

export function* walkFields(buf: Uint8Array): IterableIterator<FieldEntry> {
    let i = 0;
    while (i < buf.length) {
        const [tag, after] = readVarint(buf, i);
        const field = tag >>> 3;
        const wire = tag & 7;
        i = after;
        if (wire === 0) {
            const [val, j] = readVarint(buf, i);
            yield { field, wire, value: val, raw: new Uint8Array(0) };
            i = j;
        } else if (wire === 1) {
            // 64-bit fixed — we don't use this, just skip 8 bytes
            yield { field, wire, value: undefined, raw: buf.slice(i, i + 8) };
            i += 8;
        } else if (wire === 2) {
            const [len, j] = readVarint(buf, i);
            yield { field, wire, value: undefined, raw: buf.slice(j, j + len) };
            i = j + len;
        } else if (wire === 5) {
            yield { field, wire, value: undefined, raw: buf.slice(i, i + 4) };
            i += 4;
        } else {
            throw new Error(`unknown wire type ${wire} at offset ${i}`);
        }
    }
}
