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
                                <button className="btn btn-danger" onClick={() => void onReset()} disabled={busy}>
                                    Reset
                                </button>
                            </div>
                        </div>
                        <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
                            Each cell = one (set × direction) gesture. Hold <code>&amp;mg_set N</code> on your keyboard,
                            then stroke the corresponding direction to fire the binding. Click any cell to edit.
                        </p>
                        <GestureGrid
                            gestures={data.gestures}
                            onCellClick={(setId, dir) => {
                                const existing = findGestureInCell(data.gestures, setId, dir);
                                if (existing) setEditing(existing);
                                else setAdding(blankGesture(setId, dir));
                            }}
                            onCellDelete={(g) => void onDelete(g.id)}
                            busy={busy}
                        />
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
                    title={`Add gesture (Set ${adding.setId} · ${["↑","→","↓","←"][adding.pattern.directions[0] ?? 0]})`}
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

/** Number of gesture sets exposed by the firmware. Must match
 * CONFIG_ZMK_MOUSE_GESTURE_RPC_NUM_SETS. */
const NUM_SETS = 5;

/** Single-stroke directions, in the order shown in the grid. */
const GRID_DIRECTIONS: Direction[] = [
    Direction.UP,
    Direction.RIGHT,
    Direction.DOWN,
    Direction.LEFT,
];

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

/** Find a gesture in the list that exactly matches (set_id, direction).
 * Returns null if no match. */
function findGestureInCell(
    gestures: Gesture[],
    setId: number,
    dir: Direction,
): Gesture | null {
    for (const g of gestures) {
        if (g.setId !== setId) continue;
        if (g.pattern.directions.length !== 1) continue;
        if (g.pattern.directions[0] !== dir) continue;
        return g;
    }
    return null;
}

// === Subcomponents =====================================================

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
            setId: initial.setId,   /* preserve set association */
        };
        onSave(g);
    };

    return (
        <div className="modal-backdrop">
            <div className="modal card">
                <h2>{title}</h2>

                <div className="field">
                    <label>Set</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code>&amp;mg_set {initial.setId}</code>
                        <span className="muted">(hold this key to activate this set)</span>
                    </div>
                </div>

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

function GestureGrid({
    gestures,
    onCellClick,
    onCellDelete,
    busy,
}: {
    gestures: Gesture[];
    onCellClick: (setId: number, dir: Direction) => void;
    onCellDelete: (g: Gesture) => void;
    busy: boolean;
}) {
    const arrowFor = (d: Direction) => ["↑", "→", "↓", "←"][d];
    return (
        <div className="gesture-grid-wrap">
            <table className="gesture-grid">
                <thead>
                    <tr>
                        <th></th>
                        {GRID_DIRECTIONS.map((d) => (
                            <th key={d} className="grid-dir-th">{arrowFor(d)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: NUM_SETS }, (_, setId) => (
                        <tr key={setId}>
                            <th className="grid-set-th">
                                <div className="set-label">Set&nbsp;{setId}</div>
                                <div className="set-binding">
                                    <code>&amp;mg_set&nbsp;{setId}</code>
                                </div>
                            </th>
                            {GRID_DIRECTIONS.map((d) => {
                                const g = findGestureInCell(gestures, setId, d);
                                return (
                                    <td key={d} className="grid-cell">
                                        <button
                                            className={`cell-btn ${g ? "filled" : "empty"}`}
                                            onClick={() => onCellClick(setId, d)}
                                            disabled={busy}
                                        >
                                            {g ? (
                                                <CellContent
                                                    g={g}
                                                    onDelete={(e) => {
                                                        e.stopPropagation();
                                                        onCellDelete(g);
                                                    }}
                                                />
                                            ) : (
                                                <span className="cell-empty">＋</span>
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

function CellContent({
    g,
    onDelete,
}: {
    g: Gesture;
    onDelete: (e: { stopPropagation: () => void }) => void;
}) {
    const shortcut = describeEncoded(g.binding.param1);
    return (
        <div className="cell-inner">
            {g.name && <div className="cell-name">{g.name}</div>}
            <div className="cell-binding">
                {shortcut ?? bindingToString(g.binding.behavior, g.binding.param1, g.binding.param2)}
            </div>
            <span
                role="button"
                className="cell-delete"
                onClick={onDelete}
                aria-label={`Delete gesture ${g.id}`}
                title="Delete"
            >
                ×
            </span>
        </div>
    );
}

export default App;
