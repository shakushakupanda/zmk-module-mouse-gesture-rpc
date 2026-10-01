import { useEffect, useRef, useState } from "react";
import type { MouseGestureClient } from "./lib/mouseGestureClient";
import type { ScrollSample, Settings } from "./lib/mouseGestureProto";
import { calibrate, type CalibrationResult, type FlickParameters } from "./lib/flickCalibration";

export function FlickCalibration({ client, settings, disabled, onBusy, onApply }: {
    client: MouseGestureClient; settings: Settings; disabled: boolean;
    onBusy: (busy: boolean) => void; onApply: (p: FlickParameters) => void;
}) {
    const [normal, setNormal] = useState<ScrollSample[]>([]);
    const [flick, setFlick] = useState<ScrollSample[]>([]);
    const [phase, setPhase] = useState<"normal" | "flick" | null>(null);
    const [seconds, setSeconds] = useState(0);
    const [error, setError] = useState("");
    const [result, setResult] = useState<CalibrationResult | null>(null);
    const cancelled = useRef(false);
    const settingsKey = JSON.stringify(settings);
    useEffect(() => setResult(null), [settingsKey]);
    useEffect(() => () => { cancelled.current = true; }, []);
    const capture = async (kind: "normal" | "flick") => {
        cancelled.current = false;
        setPhase(kind); setError(""); setResult(null); onBusy(true);
        if (kind === "normal") { setNormal([]); setFlick([]); } else setFlick([]);
        let id = 0;
        try {
            const start = await client.captureScroll(1); id = start.id;
            for (let left = 10; left > 0; left--) {
                setSeconds(left);
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (cancelled.current) return;
            }
            let page = await client.captureScroll(2, id);
            const samples = [...page.samples];
            if (page.dropped) throw new Error("入力が多すぎました。短い操作を3〜5回、間を空けて測り直してください。");
            while (samples.length < page.total) {
                page = await client.captureScroll(0, id, samples.length);
                if (!page.samples.length || page.id !== id || page.dropped) throw new Error("測定が中断されました。再測定してください。");
                samples.push(...page.samples);
            }
            if (!samples.length) throw new Error("スクロール入力を検出できませんでした。スクロールレイヤーのキーを押してボールを回してください。");
            if (kind === "normal") setNormal(samples); else setFlick(samples);
        } catch (e) { if (!cancelled.current) setError(String(e instanceof Error ? e.message : e)); }
        finally {
            if (id) { try { await client.captureScroll(2, id); } catch { /* Firmware expires capture after ten seconds. */ } }
            if (!cancelled.current) { setPhase(null); setSeconds(0); }
            onBusy(false);
        }
    };
    const cancel = () => { cancelled.current = true; setPhase(null); setSeconds(0); };
    return <div className="card" style={{ marginTop: 16 }}>
        <h3>スクロールを測って自動調整</h3>
        <p>スクロールレイヤーのキーを押しながら操作してください。各10秒間で3〜5回、操作の間を1秒ほど空けます。測定中だけ慣性を止め、通常のスクロールはそのまま動きます。</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={disabled || !!phase} onClick={() => void capture("normal")}>① 普段のスクロールを測る{normal.length ? " ✓" : ""}</button>
            <button className="btn" disabled={disabled || !!phase || !normal.length} onClick={() => void capture("flick")}>② 慣性を始めたい弾き方を測る{flick.length ? " ✓" : ""}</button>
            <button className="btn" disabled={disabled || !!phase || !normal.length || !flick.length} onClick={() => {
                setError(""); setResult(null);
                try { setResult(calibrate(normal, flick, settings)); } catch (e) { setError((e as Error).message); }
            }}>③ 判定条件を計算</button>
        </div>
        {phase && <p role="status">{phase === "normal" ? "普段の速さでスクロールしてください" : "慣性を始めたい速さで弾いてください"} — 残り {seconds} 秒 <button className="btn" onClick={cancel}>中止</button></p>}
        {error && <p role="alert" className="warning">{error}</p>}
        {result && <div>
            <p>判定時間 {result.parameters.inertialScrollFlickWindowMs} ms・最低 {result.parameters.inertialScrollFlickMinCounts} 段・最大入力間隔 {result.parameters.inertialScrollFlickMaxGapMs} ms</p>
            <p>今回の測定では、通常操作の誤判定 0 / {result.normalTrials} 回、弾く操作の検出 {result.detectedFlicks} / {result.flickTrials} 回。未測定の操作でも同じ精度になる保証はないため、適用後に感触を確認してください。</p>
            <button className="btn btn-primary" disabled={disabled} onClick={() => { onApply(result.parameters); setResult(null); }}>提案を設定欄に入れる</button>
            <p className="muted">上の Save でキーボードに保存します。変更するのは弾く操作の判定条件だけです。慣性の強さ・長さは現在の値を使います。</p>
        </div>}
    </div>;
}
