/**
 * Mouse Gesture Studio — standalone Web UI for the
 * zmk-module-mouse-gesture-rpc custom subsystem.
 *
 * Run with `npm run dev` and connect a keyboard with the
 * matching firmware module enabled.
 */

import { useContext, useEffect, useState } from "react";
import "./App.css";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import {
  ZMKConnection,
  ZMKAppContext,
} from "@cormoran/zmk-studio-react-hook";

import {
  MouseGestureClient,
  SUBSYSTEM_IDENTIFIER,
} from "./lib/mouseGestureClient";
import {
  bindingToString,
  patternToArrows,
} from "./lib/patternFormat";
import type { Gesture, Settings } from "./proto/zmk/mouse_gesture/custom";

function App() {
  return (
    <div className="app">
      <header className="header">
        <span className="icon">🖱️</span>
        <div>
          <h1>Mouse Gesture Studio</h1>
          <p>Runtime configuration UI for kot149/zmk-mouse-gesture</p>
        </div>
      </header>

      <ZMKConnection
        renderDisconnected={({ connect, isLoading, error }) => (
          <section className="card">
            <h2>Device Connection</h2>
            {isLoading && <p className="muted">Connecting…</p>}
            {error && <div className="warning">🚨 {error}</div>}
            {!isLoading && (
              <button
                className="btn btn-primary"
                onClick={() => connect(serial_connect)}
              >
                Connect via USB Serial
              </button>
            )}
            <p className="muted" style={{ marginTop: 12 }}>
              Make sure the central (right hand) is plugged in and the
              firmware was built with{" "}
              <code>CONFIG_ZMK_MOUSE_GESTURE_RPC=y</code>.
            </p>
          </section>
        )}
        renderConnected={({ disconnect, deviceName }) => (
          <>
            <section className="card">
              <h2>Device</h2>
              <div>
                Connected to <strong>{deviceName}</strong>
              </div>
              <button
                className="btn"
                onClick={disconnect}
                style={{ marginTop: 12 }}
              >
                Disconnect
              </button>
            </section>

            <GestureManager />
            <SettingsPanel />
          </>
        )}
      />
    </div>
  );
}

export default App;

/* === Gesture list / editor =============================================== */

function GestureManager() {
  const zmkApp = useContext(ZMKAppContext);
  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const subsystem = zmkApp?.findSubsystem(SUBSYSTEM_IDENTIFIER);

  useEffect(() => {
    if (!zmkApp?.state.connection || !subsystem) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zmkApp?.state.connection, subsystem]);

  if (!zmkApp) return null;

  if (!subsystem) {
    return (
      <section className="card">
        <h2>Gestures</h2>
        <div className="warning">
          Subsystem <code>{SUBSYSTEM_IDENTIFIER}</code> not found. Build the
          firmware with <code>CONFIG_ZMK_MOUSE_GESTURE_RPC=y</code> and the
          <code> zmk-module-mouse-gesture-rpc</code> module in your west.yml.
        </div>
      </section>
    );
  }

  const client = new MouseGestureClient(
    zmkApp.state.connection!,
    subsystem.index,
  );

  async function reload() {
    setIsLoading(true);
    setError(null);
    try {
      setGestures(await client.listGestures());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await client.deleteGesture(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Gestures</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={reload}
            disabled={isLoading}
          >
            {isLoading ? "…" : "Reload"}
          </button>
          <button className="btn btn-primary" disabled>
            + Add (Phase 3)
          </button>
        </div>
      </div>

      {error && <div className="warning" style={{ marginBottom: 12 }}>{error}</div>}

      {gestures.length === 0 ? (
        <div className="empty-state">
          {isLoading ? "Loading…" : "No gestures configured yet."}
        </div>
      ) : (
        gestures.map((g) => (
          <div className="gesture-row" key={g.id}>
            <div>
              <div style={{ fontWeight: 600 }}>{g.name || `#${g.id}`}</div>
              <div className="muted">id {g.id}</div>
            </div>
            <div className="pattern-display">
              {patternToArrows(g.pattern?.directions ?? [])}
            </div>
            <div className="binding-display">
              {bindingToString(
                g.binding?.behavior ?? "",
                g.binding?.param1 ?? 0,
                g.binding?.param2 ?? 0,
              )}
            </div>
            <div>
              <button
                className="btn btn-danger"
                onClick={() => onDelete(g.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

/* === Settings panel ===================================================== */

function SettingsPanel() {
  const zmkApp = useContext(ZMKAppContext);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subsystem = zmkApp?.findSubsystem(SUBSYSTEM_IDENTIFIER);

  useEffect(() => {
    if (!zmkApp?.state.connection || !subsystem) return;

    const client = new MouseGestureClient(
      zmkApp.state.connection,
      subsystem.index,
    );
    void client
      .getSettings()
      .then((s) => setSettings(s ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [zmkApp?.state.connection, subsystem]);

  if (!subsystem || !settings) return null;

  return (
    <section className="card">
      <h2>Settings</h2>
      {error && <div className="warning">{error}</div>}
      <div className="settings-grid">
        <Field label="Stroke size (px)" value={settings.strokeSize} />
        <Field label="Idle timeout (ms)" value={settings.idleTimeoutMs} />
        <Field
          label="Cooldown (ms)"
          value={settings.gestureCooldownMs}
        />
        <Field
          label="Movement threshold"
          value={settings.movementThreshold}
        />
        <div className="toggle-row">
          <input
            id="eager"
            type="checkbox"
            checked={settings.enableEagerMode}
            readOnly
          />
          <label htmlFor="eager">enable-eager-mode</label>
        </div>
        <div className="toggle-row">
          <input
            id="always"
            type="checkbox"
            checked={settings.alwaysActive}
            readOnly
          />
          <label htmlFor="always">always-active</label>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Editing is wired up in Phase 4 (Set Settings RPC).
      </p>
    </section>
  );
}

function Field({ label, value }: { label: string; value: number }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} readOnly />
    </div>
  );
}
