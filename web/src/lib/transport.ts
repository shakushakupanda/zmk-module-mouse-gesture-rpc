/**
 * Web Serial transport for the ZMK Studio protocol.
 *
 * Mirrors tools/python_cli/transport.py but uses navigator.serial.
 * Owns the serial port, reads continuously into a FrameDecoder, and
 * lets callers send a request and `await` the next inbound frame
 * (response correlation by request_id is left to the caller; the
 * firmware reliably echoes one response per request in order).
 */

import { encodeFrame, FrameDecoder } from "./framing";

export class SerialTransport {
    private port: SerialPort;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private decoder = new FrameDecoder();
    /** Frames decoded but not yet handed to a caller. */
    private pendingFrames: Uint8Array[] = [];
    /** Resolves with the next frame when one arrives. */
    private waiters: Array<(frame: Uint8Array) => void> = [];
    private closed = false;

    constructor(port: SerialPort) {
        this.port = port;
    }

    static async requestAndOpen(baudRate = 115200): Promise<SerialTransport> {
        if (!("serial" in navigator)) {
            throw new Error(
                "Web Serial API is not supported in this browser. Use Chrome or Edge.",
            );
        }
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate });
        const tp = new SerialTransport(port);
        tp.startReadLoop();
        return tp;
    }

    private startReadLoop(): void {
        if (!this.port.readable) return;
        this.reader = this.port.readable.getReader();
        void this.readLoop();
    }

    private async readLoop(): Promise<void> {
        try {
            while (true) {
                const r = await this.reader!.read();
                if (r.done) break;
                if (!r.value) continue;
                for (const frame of this.decoder.feed(r.value)) {
                    this.handleFrame(frame);
                }
            }
        } catch (e) {
            console.error("Read loop error:", e);
        }
    }

    private handleFrame(frame: Uint8Array): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(frame);
        } else {
            this.pendingFrames.push(frame);
        }
    }

    /** Send raw envelope bytes and await one response frame. */
    async call(envelope: Uint8Array, timeoutMs = 5000): Promise<Uint8Array> {
        if (this.closed) throw new Error("Transport closed");
        if (!this.writer) this.writer = this.port.writable!.getWriter();
        const framed = encodeFrame(envelope);
        await this.writer.write(framed);

        // If there's already a pending frame, return it.
        const pending = this.pendingFrames.shift();
        if (pending) return pending;

        // Otherwise wait for the next frame.
        return new Promise<Uint8Array>((resolve, reject) => {
            let resolved = false;
            const timer = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                const idx = this.waiters.indexOf(onFrame);
                if (idx >= 0) this.waiters.splice(idx, 1);
                reject(
                    new Error(
                        `No response from keyboard after ${timeoutMs}ms. Is Studio unlocked? ` +
                            `Is another app (Chrome / DYA Studio) using the port?`,
                    ),
                );
            }, timeoutMs);
            const onFrame = (frame: Uint8Array) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                resolve(frame);
            };
            this.waiters.push(onFrame);
        });
    }

    async close(): Promise<void> {
        this.closed = true;
        try {
            this.reader?.releaseLock();
        } catch {
            // ignore
        }
        try {
            this.writer?.releaseLock();
        } catch {
            // ignore
        }
        try {
            await this.port.close();
        } catch {
            // ignore
        }
    }
}
