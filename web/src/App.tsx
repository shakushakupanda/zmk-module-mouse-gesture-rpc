/**
 * Mouse Gesture Studio — standalone UI for the zmk-module-mouse-gesture-rpc
 * custom Studio RPC subsystem.
 *
 * Connects to the keyboard directly via Web Serial (requires Chrome/Edge),
 * speaks the same ZMK Studio protocol as DYA Studio / mg_cli.py.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { MouseGestureClient } from "./lib/mouseGestureClient";
import {
    Direction,
    Gesture,
    LogEntry,
    Settings,
} from "./lib/mouseGestureProto";
import {
    LOG_CODE_NAMES,
    bindingToString,
    parseIntLoose,
    patternToArrows,
} from "./lib/patternFormat";
import { SerialTransport } from "./lib/transport";
import {
    KEY_GROUPS,
    MODIFIERS,
    decodeKey,
    describeEncoded,
    encodeKey,
} from "./lib/hidKeycodes";

type ConnState =
    | { kind: "idle" }
    | { kind: "connecting" }
    | { kind: "connected"; client: MouseGestureClient; transport: SerialTransport }
    | { kind: "error"; message: string };

interface AppData {
    gestures: Gesture[];
    settings: Settings | null;
}

function App() {
    const [conn, setConn] = useState<ConnState>({ kind: "idle" });
    const [data, setData] = useState<AppData>({ gestures: [], settings: null });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Gesture | null>(null);
    const [adding, setAdding] = useState<Gesture | null>(null);
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [logVisible, setLogVisible] = useState(false);

    const nonGridGestures = useMemo(
        () => data.gestures.filter((g) => !isGridGesture(g)),
        [data.gestures],
    );

    const connect = useCallback(async () => {
        setConn({ kind: "connecting" });
        setError(null);
        try {
            const tp = await SerialTransport.requestAndOpen();
            const client = new MouseGestureClient(tp);
            await client.getSubsystemIndex();
            setConn({ kind: "connected", client, transport: tp });
        } catch (e) {
            setConn({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
    }, []);

    const disconnect = useCallback(async () => {
        if (conn.kind === "connected") {
            await conn.transport.close();
        }
        setConn({ kind: "idle" });
        setData({ gestures: [], settings: null });
        setLogEntries([]);
        setLogVisible(false);
    }, [conn]);

    const reload = useCallback(async () => {
        if (conn.kind !== "connected") return;
        setBusy(true);
        setError(null);
        try {
            const gestures = await conn.client.listGestures();
            const settings = await conn.client.getSettings();
            setData({ gestures, settings });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [conn]);

    useEffect(() => {
        if (conn.kind === "connected") void reload();
    }, [conn.kind, reload]);

    const onAdd = useCallback(
        async (g: Gesture) => {
            if (conn.kind !== "connected") return;
            setBusy(true);
            setError(null);
            try {
                await conn.client.addGesture(g);
                setAdding(null);
                await reload();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [conn, reload],
    );

    const onUpdate = useCallback(
        async (g: Gesture) => {
            if (conn.kind !== "connected") return;
            setBusy(true);
            setError(null);
            try {
                await conn.client.updateGesture(g);
                setEditing(null);
                await reload();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [conn, reload],
    );

    const onDelete = useCallback(
        async (id: number) => {
            if (conn.kind !== "connected") return;
            if (!confirm(`Delete gesture #${id}?`)) return;
            setBusy(true);
            setError(null);
            try {
                await conn.client.deleteGesture(id);
                await reload();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [conn, reload],
    );

    const onReset = useCallback(async () => {
        if (conn.kind !== "connected") return;
        if (!confirm("Reset to DTS defaults? This will erase all custom gestures.")) return;
        setBusy(true);
        setError(null);
        try {
            await conn.client.resetToDefaults();
            await reload();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [conn, reload]);

    const onSetSettings = useCallback(
        async (s: Settings) => {
            if (conn.kind !== "connected") return;
            setBusy(true);
            setError(null);
            try {
                const updated = await conn.client.setSettings(s);
                setData((d) => ({ ...d, settings: updated }));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [conn],
    );


    const exportConfig = useCallback(() => {
        const payload = {
            format: "zmk-module-mouse-gesture-rpc.config",
            version: 1,
            exportedAt: new Date().toISOString(),
            gestures: data.gestures,
            settings: data.settings,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mouse-gesture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, [data]);

    const importConfig = useCallback(() => {
        if (conn.kind !== "connected") return;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || conn.kind !== "connected") return;
            if (!confirm("Import this file and replace all current mouse gestures?")) return;

            setBusy(true);
            setError(null);
            try {
                const text = await file.text();
                const parsed = JSON.parse(text) as Partial<MouseGestureExport>;
                const gestures = normalizeImportedGestures(parsed);

                const current = await conn.client.listGestures();
                for (const g of current) {
                    await conn.client.deleteGesture(g.id);
                }

                if (parsed.settings) {
                    await conn.client.setSettings(normalizeImportedSettings(parsed.settings));
                }

                for (const g of gestures) {
                    await conn.client.addGesture({ ...g, id: 0 });
                }

                await reload();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        };
        input.click();
    }, [conn, reload]);

    const fetchLog = useCallback(async () => {
        if (conn.kind !== "connected") return;
        setBusy(true);
        setError(null);
        try {
            const entries = await conn.client.getLog();
            setLogEntries(entries);
            setLogVisible(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [conn]);

    return (
        <div className="app">
            <header className="header">
                <span className="icon">🖱</span>
                <div style={{ flex: 1 }}>
                    <h1>Mouse Gesture Studio</h1>
                    <p>Runtime configuration for kot149/zmk-mouse-gesture via cormoran Studio RPC</p>
                </div>
                <ConnectionPill conn={conn} onConnect={connect} onDisconnect={disconnect} />
            </header>

            {conn.kind === "error" && (
                <div className="warning">Connection error: {conn.message}</div>
            )}

            {error && <div className="warning">{error}</div>}

            {conn.kind !== "connected" ? (
                <IntroSection onConnect={connect} connecting={conn.kind === "connecting"} />
            ) : (
                <>
                    <section className="card">
                        <div className="card-head">
                            <h2 style={{ margin: 0 }}>Gestures</h2>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button className="btn" onClick={() => void reload()} disabled={busy}>
                                    ↻ Reload
                                </button>
                                <button className="btn" onClick={exportConfig} disabled={busy}>
                                    Export
                                </button>
                                <button className="btn" onClick={importConfig} disabled={busy}>
                                    Import
                                </button>
                                <button className="btn btn-danger" onClick={() => void onReset()} disabled={busy}>
                                    Reset
                                </button>
                                <button className="btn btn-primary" onClick={() => setAdding(blankGesture())} disabled={busy}>
                                    + Add
                                </button>
                            </div>
                        </div>
                        <p className="muted" style={{ marginTop: 0 }}>
                            Each row is a gesture key ID (<code>&amp;mg_set N</code>). Each column is the direction stroked while holding that gesture key.
                        </p>
                        <TrackballGestureIllustration />
                        <GestureGrid
                            gestures={data.gestures}
                            busy={busy}
                            onCellClick={(setId, dir) => {
                                const existing = findGestureInCell(data.gestures, setId, dir);
                                if (existing) setEditing(existing);
                                else setAdding(blankGesture(setId, dir));
                            }}
                        />

                        {data.gestures.length === 0 && (
                            <div className="empty-state">{busy ? "Loading…" : "No gestures configured."}</div>
                        )}

                        {nonGridGestures.length > 0 && (
                            <div className="gesture-list">
                                <h3 className="subhead">Other gestures</h3>
                                <p className="muted">
                                    These gestures do not fit the 3 keys × 4 single-direction grid, so they are shown separately.
                                </p>
                                {nonGridGestures.map((g) => (
                                    <div className="gesture-row" key={g.id}>
                                        <div>
                                            <div className="gesture-name">{g.name || `#${g.id}`}</div>
                                            <div className="gesture-id">
                                                id {g.id} · gesture key {g.setId}
                                                {!g.enabled ? " · disabled" : ""}
                                            </div>
                                        </div>
                                        <div className="pattern-display">
                                            {patternToArrows(g.pattern.directions)}
                                        </div>
                                        <div className="binding-display">
                                            <BindingLabel
                                                behavior={g.binding.behavior}
                                                param1={g.binding.param1}
                                                param2={g.binding.param2}
                                            />
                                        </div>
                                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                            <button className="btn" onClick={() => setEditing(g)} disabled={busy}>
                                                Edit
                                            </button>
                                            <button
                                                className="btn btn-danger"
                                                onClick={() => void onDelete(g.id)}
                                                disabled={busy}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {data.settings && (
                        <SettingsCard settings={data.settings} onSave={onSetSettings} disabled={busy} />
                    )}

                    <section className="card">
                        <div className="card-head">
                            <h2 style={{ margin: 0 }}>Diagnostics</h2>
                            <button className="btn" onClick={() => void fetchLog()} disabled={busy}>
                                Fetch firmware log
                            </button>
                        </div>
                        {logVisible ? (
                            <LogTable entries={logEntries} />
                        ) : (
                            <p className="muted">
                                Fetches the firmware breadcrumb ring (last 32 events: boot, RPC dispatch,
                                sync_to_kot149). Useful when you hit a freeze.
                            </p>
                        )}
                    </section>
                </>
            )}

            {adding && (
                <GestureEditorModal
                    initial={adding}
                    title={`Add gesture (Key ${adding.setId} · ${patternToArrows(adding.pattern.directions)})`}
                    onCancel={() => setAdding(null)}
                    onSave={onAdd}
                    disabled={busy}
                />
            )}

            {editing && (
                <GestureEditorModal
                    initial={editing}
                    title={`Edit gesture #${editing.id}`}
                    onCancel={() => setEditing(null)}
                    onSave={onUpdate}
                    disabled={busy}
                />
            )}
        </div>
    );
}

interface MouseGestureExport {
    format?: string;
    version?: number;
    exportedAt?: string;
    gestures?: unknown;
    settings?: unknown;
}

function normalizeImportedGestures(input: Partial<MouseGestureExport>): Gesture[] {
    if (!Array.isArray(input.gestures)) {
        throw new Error("Import file does not contain a gestures array.");
    }

    return input.gestures.map((raw, i) => {
        const g = raw as Partial<Gesture>;
        if (!g || typeof g !== "object") throw new Error(`Gesture ${i} is invalid.`);
        if (!g.pattern || !Array.isArray(g.pattern.directions)) {
            throw new Error(`Gesture ${i} has no pattern.directions array.`);
        }
        if (!g.binding || typeof g.binding.behavior !== "string") {
            throw new Error(`Gesture ${i} has no binding.behavior.`);
        }

        return {
            id: 0,
            name: typeof g.name === "string" ? g.name : "",
            pattern: {
                directions: g.pattern.directions.map((d) => Number(d) as Direction),
            },
            binding: {
                behavior: g.binding.behavior,
                param1: Number(g.binding.param1 ?? 0),
                param2: Number(g.binding.param2 ?? 0),
            },
            enabled: Boolean(g.enabled ?? true),
            setId: Number(g.setId ?? 0),
        };
    });
}

function normalizeImportedSettings(input: unknown): Settings {
    const s = input as Partial<Settings>;
    return {
        strokeSize: Number(s.strokeSize ?? 0),
        idleTimeoutMs: Number(s.idleTimeoutMs ?? 0),
        gestureCooldownMs: Number(s.gestureCooldownMs ?? 0),
        movementThreshold: Number(s.movementThreshold ?? 0),
        enableEagerMode: Boolean(s.enableEagerMode ?? false),
        alwaysActive: Boolean(s.alwaysActive ?? false),
    };
}

const NUM_GESTURE_KEYS = 3;
const GRID_DIRECTIONS = [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT] as const;

function blankGesture(setId = 0, dir: Direction = Direction.UP): Gesture {
    return {
        id: 0,
        name: "",
        pattern: { directions: [dir] },
        binding: { behavior: "key_press", param1: 0, param2: 0 },
        enabled: true,
        setId,
    };
}

function findGestureInCell(gestures: Gesture[], setId: number, dir: Direction): Gesture | null {
    return gestures.find((g) =>
        g.setId === setId &&
        g.pattern.directions.length === 1 &&
        g.pattern.directions[0] === dir,
    ) ?? null;
}

function isGridGesture(g: Gesture): boolean {
    return g.setId >= 0 &&
        g.setId < NUM_GESTURE_KEYS &&
        g.pattern.directions.length === 1 &&
        GRID_DIRECTIONS.includes(g.pattern.directions[0] as typeof GRID_DIRECTIONS[number]);
}

// === Subcomponents =====================================================

function TrackballGestureIllustration() {
    return (
        <div className="trackball-gesture-hero" aria-label="Trackball gesture directions">
            <div className="trackball-copy">
                <div className="trackball-title">Gesture button + ball movement</div>
                <div className="trackball-subtitle">
                    Hold <code>Mouse Gesture Key 0/1/2</code>, then roll the ball toward one direction.
                </div>
            </div>
            <div className="trackball-art-wrap">
                <div className="gesture-label gesture-label-up">↑ Up</div>
                <div className="gesture-label gesture-label-right">Right →</div>
                <div className="gesture-label gesture-label-down">↓ Down</div>
                <div className="gesture-label gesture-label-left">← Left</div>
                <svg className="trackball-art" viewBox="0 0 220 180" role="img" aria-label="Trackball illustration">
                    <defs>
                        <radialGradient id="ballGradient" cx="42%" cy="32%" r="68%">
                            <stop offset="0%" stopColor="#8b9497" />
                            <stop offset="62%" stopColor="#555b5e" />
                            <stop offset="100%" stopColor="#363b3e" />
                        </radialGradient>
                        <linearGradient id="bodyGradient" x1="0" x2="1" y1="0" y2="1">
                            <stop offset="0%" stopColor="#4b5053" />
                            <stop offset="100%" stopColor="#2a2e31" />
                        </linearGradient>
                    </defs>
                    <path
                        className="trackball-shadow"
                        d="M72 154 C88 170 134 172 153 154 C169 139 156 118 159 91 C162 57 143 31 114 26 C86 22 63 42 59 72 C56 92 43 104 45 126 C46 139 57 148 72 154 Z"
                    />
                    <path
                        className="trackball-body"
                        d="M70 146 C86 163 132 166 151 148 C166 134 153 115 157 89 C161 58 142 34 115 29 C88 25 66 44 62 72 C59 91 46 101 48 123 C49 136 57 142 70 146 Z"
                    />
                    <circle className="trackball-ball" cx="111" cy="78" r="30" />
                    <circle className="trackball-highlight" cx="101" cy="67" r="8" />
                    <circle className="trackball-button" cx="112" cy="78" r="6" />
                    <path className="trackball-seam" d="M82 104 C96 114 122 117 143 104" />
                    <g className="trackball-arrows">
                        <path d="M110 7 L110 35" />
                        <path d="M110 7 L101 17" />
                        <path d="M110 7 L119 17" />
                        <path d="M110 173 L110 145" />
                        <path d="M110 173 L101 163" />
                        <path d="M110 173 L119 163" />
                        <path d="M14 90 L42 90" />
                        <path d="M14 90 L24 81" />
                        <path d="M14 90 L24 99" />
                        <path d="M206 90 L178 90" />
                        <path d="M206 90 L196 81" />
                        <path d="M206 90 L196 99" />
                    </g>
                </svg>
            </div>
        </div>
    );
}

function GestureGrid({
    gestures,
    busy,
    onCellClick,
}: {
    gestures: Gesture[];
    busy: boolean;
    onCellClick: (setId: number, dir: Direction) => void;
}) {
    return (
        <div className="gesture-grid-wrap">
            <table className="gesture-grid-table">
                <thead>
                    <tr>
                        <th>Gesture key</th>
                        {GRID_DIRECTIONS.map((d) => (
                            <th key={d}>{patternToArrows([d])}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: NUM_GESTURE_KEYS }, (_, setId) => (
                        <tr key={setId}>
                            <th>
                                <div className="set-label">Key {setId}</div>
                                <code>&amp;mg_set {setId}</code>
                            </th>
                            {GRID_DIRECTIONS.map((dir) => {
                                const g = findGestureInCell(gestures, setId, dir);
                                return (
                                    <td key={dir}>
                                        <button
                                            type="button"
                                            className={`gesture-cell ${g ? "configured" : "empty"}`}
                                            onClick={() => onCellClick(setId, dir)}
                                            disabled={busy}
                                        >
                                            {g ? (
                                                <>
                                                    <span className="cell-name">{g.name || `#${g.id}`}</span>
                                                    <span className="cell-binding">
                                                        <BindingLabel
                                                            behavior={g.binding.behavior}
                                                            param1={g.binding.param1}
                                                            param2={g.binding.param2}
                                                        />
                                                    </span>
                                                    {!g.enabled && <span className="cell-disabled">disabled</span>}
                                                </>
                                            ) : (
                                                <span className="cell-empty">+ assign</span>
                                            )}
                                        </button>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ConnectionPill({
    conn,
    onConnect,
    onDisconnect,
}: {
    conn: ConnState;
    onConnect: () => void;
    onDisconnect: () => void;
}) {
    if (conn.kind === "connected") {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="status-pill connected">
                    <span className="dot" />
                    Connected
                </span>
                <button className="btn" onClick={() => void onDisconnect()}>
                    Disconnect
                </button>
            </div>
        );
    }
    return (
        <button
            className="btn btn-primary"
            onClick={() => void onConnect()}
            disabled={conn.kind === "connecting"}
        >
            {conn.kind === "connecting" ? "Connecting…" : "Connect"}
        </button>
    );
}

function IntroSection({
    onConnect,
    connecting,
}: {
    onConnect: () => void;
    connecting: boolean;
}) {
    const hasWebSerial = typeof navigator !== "undefined" && "serial" in navigator;
    return (
        <section className="card">
            <h2>Connect to your keyboard</h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>
                Plug your keyboard in via USB, then click <strong style={{ color: "var(--color-text)" }}>Connect</strong>.
                Chrome / Edge will ask which serial port to use (should appear as <code>moNa2</code> or similar).
                Close any other app currently holding the port (DYA Studio in another tab, <code>screen</code>, <code>mg_cli.py</code>).
            </p>
            {!hasWebSerial && (
                <div className="warning" style={{ marginTop: 12 }}>
                    Your browser does not support the Web Serial API. Use Chrome or Edge.
                </div>
            )}
            <p style={{ marginTop: 18 }}>
                <button
                    className="btn btn-primary"
                    onClick={() => void onConnect()}
                    disabled={connecting || !hasWebSerial}
                >
                    {connecting ? "Connecting…" : "Connect"}
                </button>
            </p>
            <p className="muted" style={{ marginTop: 14 }}>
                Once connected you can list / add / edit / delete gestures, tune sensitivity, and inspect the firmware
                breadcrumb log. All changes are pushed to kot149 immediately and persisted to NVS.
            </p>
        </section>
    );
}

function BindingLabel({
    behavior,
    param1,
    param2,
}: {
    behavior: string;
    param1: number;
    param2: number;
}) {
    const shortcut = describeEncoded(param1);
    const raw = bindingToString(behavior, param1, param2);
    if (shortcut) {
        return (
            <span>
                <span style={{ color: "var(--color-purple)" }}>{shortcut}</span>
                <span style={{ marginLeft: 8, color: "var(--color-text-muted)" }}>{raw}</span>
            </span>
        );
    }
    return <span>{raw}</span>;
}

function SettingsCard({
    settings,
    onSave,
    disabled,
}: {
    settings: Settings;
    onSave: (s: Settings) => void;
    disabled: boolean;
}) {
    const [draft, setDraft] = useState<Settings>(settings);
    useEffect(() => setDraft(settings), [settings]);
    const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

    return (
        <section className="card">
            <div className="card-head">
                <h2 style={{ margin: 0 }}>Settings</h2>
                <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => setDraft(settings)} disabled={!dirty || disabled}>
                        Revert
                    </button>
                    <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={!dirty || disabled}>
                        Save
                    </button>
                </div>
            </div>
            <div className="settings-grid">
                <NumberField
                    label="Stroke size (px)"
                    value={draft.strokeSize}
                    onChange={(v) => setDraft({ ...draft, strokeSize: v })}
                />
                <NumberField
                    label="Idle timeout (ms)"
                    value={draft.idleTimeoutMs}
                    onChange={(v) => setDraft({ ...draft, idleTimeoutMs: v })}
                />
                <NumberField
                    label="Gesture cooldown (ms)"
                    value={draft.gestureCooldownMs}
                    onChange={(v) => setDraft({ ...draft, gestureCooldownMs: v })}
                />
                <NumberField
                    label="Movement threshold"
                    value={draft.movementThreshold}
                    onChange={(v) => setDraft({ ...draft, movementThreshold: v })}
                />
                <BoolField
                    label="Eager mode"
                    value={draft.enableEagerMode}
                    onChange={(v) => setDraft({ ...draft, enableEagerMode: v })}
                />
                <BoolField
                    label="Always active"
                    value={draft.alwaysActive}
                    onChange={(v) => setDraft({ ...draft, alwaysActive: v })}
                />
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
                Note: only <code>stroke_size</code> / <code>idle_timeout_ms</code> / <code>gesture_cooldown_ms</code> are
                currently honored by the kot149 input processor (read from DTS at boot; runtime sync is pending). The
                other flags are stored but not yet plumbed.
            </p>
        </section>
    );
}

function NumberField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
}) {
    return (
        <div className="field">
            <label>{label}</label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
            />
        </div>
    );
}

function BoolField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="field">
            <label>{label}</label>
            <label className="toggle-row">
                <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
                <span>{value ? "Enabled" : "Disabled"}</span>
            </label>
        </div>
    );
}

function GestureEditorModal({
    initial,
    title,
    onCancel,
    onSave,
    disabled,
}: {
    initial: Gesture;
    title: string;
    onCancel: () => void;
    onSave: (g: Gesture) => void;
    disabled: boolean;
}) {
    const [name, setName] = useState(initial.name);
    const [directions, setDirections] = useState<Direction[]>(
        initial.pattern.directions.length ? initial.pattern.directions : [Direction.UP],
    );
    const [behavior, setBehavior] = useState(initial.binding.behavior || "key_press");
    const [param1, setParam1] = useState<number>(initial.binding.param1);
    const [param2Str, setParam2Str] = useState(
        initial.binding.param2 ? `0x${initial.binding.param2.toString(16).toUpperCase()}` : "0",
    );
    const [enabled, setEnabled] = useState(initial.enabled);
    const [showKeyPicker, setShowKeyPicker] = useState(false);

    const param1Str = useMemo(
        () => `0x${param1.toString(16).padStart(param1 > 0xffff ? 8 : 4, "0").toUpperCase()}`,
        [param1],
    );

    const isKeyPress = behavior === "key_press" || behavior === "kp";

    const save = () => {
        const g: Gesture = {
            id: initial.id,
            name,
            pattern: { directions },
            binding: {
                behavior: behavior.trim() === "kp" ? "key_press" : behavior.trim(),
                param1,
                param2: parseIntLoose(param2Str),
            },
            enabled,
            setId: initial.setId,
        };
        onSave(g);
    };

    return (
        <div className="modal-backdrop">
            <div className="modal card">
                <h2>{title}</h2>
                <div className="field">
                    <label>Name</label>
                    <input
                        type="text"
                        value={name}
                        placeholder="e.g. cmd_w"
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>

                <div className="field">
                    <label>Pattern (sequence of directions)</label>
                    <div className="direction-picker">
                        {directions.map((d, i) => (
                            <select
                                key={i}
                                value={d}
                                onChange={(e) => {
                                    const v = parseInt(e.target.value, 10) as Direction;
                                    setDirections(directions.map((x, j) => (j === i ? v : x)));
                                }}
                            >
                                <option value={Direction.UP}>↑ UP</option>
                                <option value={Direction.RIGHT}>→ RIGHT</option>
                                <option value={Direction.DOWN}>↓ DOWN</option>
                                <option value={Direction.LEFT}>← LEFT</option>
                            </select>
                        ))}
                        <button
                            type="button"
                            className="btn"
                            onClick={() => setDirections([...directions, Direction.UP])}
                            disabled={directions.length >= 8}
                        >
                            + step
                        </button>
                        <button
                            type="button"
                            className="btn"
                            onClick={() => setDirections(directions.slice(0, -1))}
                            disabled={directions.length <= 1}
                        >
                            − step
                        </button>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                        Preview: <span style={{ fontSize: "1.2rem", letterSpacing: 4, color: "var(--color-blue)" }}>{patternToArrows(directions)}</span>
                    </div>
                </div>

                <div className="field">
                    <label>Behavior</label>
                    <input
                        type="text"
                        value={behavior}
                        onChange={(e) => setBehavior(e.target.value)}
                        placeholder="key_press"
                    />
                    {behavior.trim() === "kp" && (
                        <div className="muted" style={{ marginTop: 4, color: "var(--color-warning)" }}>
                            ⚠ "kp" is a keymap shorthand; the firmware needs the actual device label.
                            Will auto-correct to "key_press" on save.
                        </div>
                    )}
                </div>

                <div className="field">
                    <label>Key / Param 1</label>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            type="text"
                            value={param1Str}
                            onChange={(e) => setParam1(parseIntLoose(e.target.value))}
                            placeholder="0x29 (ESC), 0x0800001A (Cmd+W) …"
                            style={{ flex: 1 }}
                        />
                        {isKeyPress && (
                            <button
                                type="button"
                                className="btn"
                                onClick={() => setShowKeyPicker(true)}
                            >
                                Pick key…
                            </button>
                        )}
                    </div>
                    {isKeyPress && describeEncoded(param1) && (
                        <div className="muted" style={{ marginTop: 4 }}>
                            = <span style={{ color: "var(--color-purple)" }}>{describeEncoded(param1)}</span>
                        </div>
                    )}
                </div>

                <div className="field">
                    <label>Param 2 (optional, hex/dec)</label>
                    <input
                        type="text"
                        value={param2Str}
                        onChange={(e) => setParam2Str(e.target.value)}
                        placeholder="0"
                    />
                </div>

                <BoolField label="Enabled" value={enabled} onChange={setEnabled} />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                    <button className="btn" onClick={onCancel} disabled={disabled}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={save} disabled={disabled}>
                        Save
                    </button>
                </div>
            </div>

            {showKeyPicker && (
                <KeyPickerModal
                    initial={param1}
                    onCancel={() => setShowKeyPicker(false)}
                    onSelect={(val) => {
                        setParam1(val);
                        setShowKeyPicker(false);
                    }}
                />
            )}
        </div>
    );
}

function KeyPickerModal({
    initial,
    onCancel,
    onSelect,
}: {
    initial: number;
    onCancel: () => void;
    onSelect: (encoded: number) => void;
}) {
    const initDecoded = decodeKey(initial);
    const [keyCode, setKeyCode] = useState<number>(initDecoded.code);
    const [modMask, setModMask] = useState<number>(initDecoded.modMask);
    const [groupId, setGroupId] = useState<string>(KEY_GROUPS[0].id);
    const [search, setSearch] = useState("");

    const encoded = encodeKey(keyCode, modMask);
    const label = describeEncoded(encoded) ?? "(no key selected)";

    const activeGroup = KEY_GROUPS.find((g) => g.id === groupId) ?? KEY_GROUPS[0];
    const filteredKeys = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return activeGroup.keys;
        return activeGroup.keys.filter((k) =>
            [k.label, k.name, ...(k.aliases ?? [])]
                .some((s) => s.toLowerCase().includes(q)),
        );
    }, [activeGroup, search]);

    const toggleMod = (mask: number) => {
        setModMask((m) => ((m & mask) !== 0 ? (m & ~mask) >>> 0 : (m | mask) >>> 0));
    };

    return (
        <div className="modal-backdrop" onClick={onCancel}>
            <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
                <h2>Pick a key</h2>

                <div className="field">
                    <label>Modifiers</label>
                    <div className="mod-row">
                        {MODIFIERS.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                className={`mod-chip ${(modMask & m.mask) !== 0 ? "on" : ""}`}
                                onClick={() => toggleMod(m.mask)}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="field">
                    <label>Key</label>
                    <div className="key-group-tabs">
                        {KEY_GROUPS.map((g) => (
                            <button
                                key={g.id}
                                type="button"
                                className={`key-tab ${groupId === g.id ? "active" : ""}`}
                                onClick={() => setGroupId(g.id)}
                            >
                                {g.label}
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        className="search-input"
                        placeholder={`Filter keys in ${activeGroup.label}… (e.g. esc, return, f1)`}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="key-grid">
                        {filteredKeys.map((k) => (
                            <button
                                key={k.code}
                                type="button"
                                className={`key-btn ${k.code === keyCode ? "selected" : ""}`}
                                onClick={() => setKeyCode(k.code)}
                                title={`${k.name}  ·  HID 0x${k.code.toString(16).padStart(2, "0")}`}
                            >
                                {k.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="encoded-preview">
                    <span>{label}</span>
                    <span className="raw">
                        0x{encoded.toString(16).padStart(8, "0").toUpperCase()}
                    </span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                    <button className="btn" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={() => onSelect(encoded)}>
                        Use this key
                    </button>
                </div>
            </div>
        </div>
    );
}

function LogTable({ entries }: { entries: LogEntry[] }) {
    if (entries.length === 0) {
        return <p className="muted">(log ring is empty)</p>;
    }
    return (
        <div style={{ overflowX: "auto" }}>
            <table className="log-table">
                <thead>
                    <tr>
                        <th>ts_ms</th>
                        <th>code</th>
                        <th>mnemonic</th>
                        <th>arg1</th>
                        <th>arg2</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map((e, i) => (
                        <tr key={i}>
                            <td>{e.tsMs}</td>
                            <td>0x{e.code.toString(16).padStart(4, "0")}</td>
                            <td>{LOG_CODE_NAMES[e.code] ?? "?"}</td>
                            <td>{e.arg1}</td>
                            <td>{e.arg2}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default App;
