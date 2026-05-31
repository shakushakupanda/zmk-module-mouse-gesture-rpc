/**
 * ZMK Studio byte-stuffing framing.
 *
 * Port of tools/python_cli/framing.py.
 * Matches zmkfirmware/zmk-studio-ts-client/src/framing.ts:
 *
 *   SOF = 0xAB  start of frame
 *   ESC = 0xAC  escape (next byte is literal data)
 *   EOF = 0xAD  end of frame
 *
 * To encode: emit SOF, then for each data byte: if it equals SOF/ESC/EOF,
 * emit ESC first; then emit the byte; finish with EOF.
 */

export const SOF = 0xab;
export const ESC = 0xac;
export const EOF = 0xad;

export function encodeFrame(data: Uint8Array): Uint8Array {
    // Worst case: every byte gets escaped (= 2x size) + SOF + EOF.
    const out = new Uint8Array(data.length * 2 + 2);
    let i = 0;
    out[i++] = SOF;
    for (const b of data) {
        if (b === SOF || b === ESC || b === EOF) {
            out[i++] = ESC;
        }
        out[i++] = b;
    }
    out[i++] = EOF;
    return out.slice(0, i);
}

type DecoderState = "idle" | "awaiting_data" | "escaped";

export class FrameDecoder {
    private state: DecoderState = "idle";
    private buf: number[] = [];

    /** Feed bytes; yields each completed frame as Uint8Array. */
    *feed(chunk: Uint8Array): IterableIterator<Uint8Array> {
        for (const b of chunk) {
            const frame = this.step(b);
            if (frame !== null) yield frame;
        }
    }

    private step(b: number): Uint8Array | null {
        if (this.state === "idle") {
            if (b === SOF) this.state = "awaiting_data";
            // else: ignore garbage before SOF
            return null;
        }
        if (this.state === "awaiting_data") {
            if (b === SOF) throw new Error("Unexpected SoF mid-frame");
            if (b === ESC) {
                this.state = "escaped";
                return null;
            }
            if (b === EOF) {
                const frame = Uint8Array.from(this.buf);
                this.buf = [];
                this.state = "idle";
                return frame;
            }
            this.buf.push(b);
            return null;
        }
        if (this.state === "escaped") {
            this.buf.push(b);
            this.state = "awaiting_data";
            return null;
        }
        return null;
    }
}
