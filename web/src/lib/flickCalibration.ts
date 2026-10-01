import type { ScrollSample, Settings } from "./mouseGestureProto";

export type FlickParameters = Pick<Settings, "inertialScrollFlickWindowMs" | "inertialScrollFlickMinCounts" | "inertialScrollFlickMaxGapMs">;
export interface CalibrationResult { parameters: FlickParameters; normalTrials: number; flickTrials: number; detectedFlicks: number }

export function splitTrials(samples: ScrollSample[]): ScrollSample[][] {
    const trials: ScrollSample[][] = [];
    for (const s of samples) {
        if (!s.amount || s.axis > 1) continue;
        const last = trials.at(-1);
        if (!last || s.tsMs - last[last.length - 1].tsMs >= 350) trials.push([s]);
        else last.push(s);
    }
    return trials;
}

/* Replay the firmware's ten-ms buckets, reversal/gap reset and velocity gate.
 * A candidate counts only if inertia could actually start before the next input. */
export function triggers(samples: ScrollSample[], p: FlickParameters, st: Settings): boolean {
    let axes: ScrollSample[][] = [[], []];
    let armed = false;
    const idle = Math.max(st.inertialScrollIdleMs, p.inertialScrollFlickMaxGapMs);
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (i && armed && s.tsMs - samples[i - 1].tsMs >= idle) return true;
        let a = axes[s.axis];
        const prev = a.at(-1);
        if (prev && prev.negative !== s.negative) axes = [[], []];
        a = axes[s.axis];
        if (a.length && s.tsMs - a[a.length - 1].tsMs > p.inertialScrollFlickMaxGapMs) a = [];
        axes[s.axis] = [...a, s];
        armed = axes.some(history => {
            const last = history.at(-1);
            if (!last || s.tsMs - last.tsMs > p.inertialScrollFlickMaxGapMs) return false;
            const recent = history.filter(v => Math.floor(v.tsMs / 10) * 10 >= s.tsMs - p.inertialScrollFlickWindowMs);
            const buckets = new Map<number, number>();
            for (const v of recent) {
                const b = Math.floor(v.tsMs / 10);
                buckets.set(b, Math.min(65535, (buckets.get(b) ?? 0) + v.amount));
            }
            const count = [...buckets.values()].reduce((a, b) => a + b, 0);
            const velocity = Math.min(1024, Math.floor(count * Math.max(1, st.inertialScrollTickMs) * 256 * st.inertialScrollImpulsePercent / (p.inertialScrollFlickWindowMs * 100)));
            return recent.length >= 2 && count >= p.inertialScrollFlickMinCounts && velocity >= Math.max(1, st.inertialScrollMinVelocityQ8);
        });
    }
    return armed;
}

export function calibrate(normal: ScrollSample[], flick: ScrollSample[], settings: Settings): CalibrationResult {
    const ns = splitTrials(normal), fs = splitTrials(flick);
    if (ns.length < 3 || fs.length < 3) throw new Error("それぞれ3回以上、操作の間を1秒ほど空けて測り直してください。");
    if (ns.some(t => t.length < 2) || fs.some(t => t.length < 2)) throw new Error("短すぎる操作があります。ボールを少し長めに動かして測り直してください。");
    let best: CalibrationResult | undefined;
    let bestScore = -Infinity;
    for (let windowMs = 20; windowMs <= 200; windowMs += 10) {
        for (let gapMs = 10; gapMs <= Math.min(200, windowMs); gapMs += 10) {
            for (let counts = 2; counts <= 64; counts++) {
                const p: FlickParameters = { inertialScrollFlickWindowMs: windowMs, inertialScrollFlickMinCounts: counts, inertialScrollFlickMaxGapMs: gapMs };
                if (ns.some(t => triggers(t, p, settings))) continue;
                const detected = fs.filter(t => triggers(t, p, settings)).length;
                if (detected < Math.ceil(fs.length * 0.8)) continue;
                // Prefer a margin: normal motion still rejected with a lower threshold,
                // and flicks still accepted with a higher threshold.
                const loose = { ...p, inertialScrollFlickMinCounts: Math.max(2, counts - 1) };
                const strict = { ...p, inertialScrollFlickMinCounts: counts + 1 };
                const margin = Number(!ns.some(t => triggers(t, loose, settings))) + fs.filter(t => triggers(t, strict, settings)).length / fs.length;
                const score = detected / fs.length * 100 + margin * 10 - Math.abs(windowMs - 80) / 100 - Math.abs(gapMs - 40) / 100;
                if (score > bestScore) {
                    bestScore = score;
                    best = { parameters: p, normalTrials: ns.length, flickTrials: fs.length, detectedFlicks: detected };
                }
            }
        }
    }
    if (!best) throw new Error("通常操作と弾く操作を安定して区別できませんでした。普通の操作はそのまま、弾く操作は少し速くして再測定してください。設定は変更していません。");
    return best;
}
