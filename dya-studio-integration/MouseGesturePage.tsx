/**
 * MouseGesturePage — drop into dya-studio/src/pages/MouseGesturePage.tsx.
 *
 * Mirrors the visual style of TrackballPage.tsx / BLEConnectionsPage.tsx:
 * uses the glass-card / btn-* / color CSS variables already in the
 * DYA Studio Tailwind setup.
 */

import {
  IconArrowsRandom,
  IconAlertTriangleFilled,
  IconReload,
} from "@tabler/icons-react";

import { useMouseGesture } from "../hooks/useMouseGesture";
import type {
  Direction,
  Gesture,
} from "../proto/zmk/mouse_gesture/custom";

const DIRECTION_ARROWS: Record<Direction, string> = {
  // Direction.DIRECTION_UP === 0 etc. but we keep numeric indices for safety.
  0: "↑",
  1: "→",
  2: "↓",
  3: "←",
} as unknown as Record<Direction, string>;

function patternToArrows(directions: readonly Direction[]): string {
  if (!directions.length) return "—";
  return directions.map((d) => DIRECTION_ARROWS[d] ?? "?").join(" ");
}

function bindingToString(g: Gesture): string {
  const b = g.binding;
  if (!b || !b.behavior) return "—";
  if (!b.param2) return `${b.behavior} 0x${b.param1.toString(16)}`;
  return `${b.behavior} 0x${b.param1.toString(16)} 0x${b.param2.toString(16)}`;
}

export function MouseGesturePage() {
  const {
    available,
    isLoading,
    error,
    gestures,
    settings,
    reload,
    deleteGesture,
  } = useMouseGesture();

  if (!available) {
    return (
      <div className="p-6 h-full overflow-auto">
        <div className="max-w-4xl mx-auto">
          <Header />
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <IconAlertTriangleFilled size={20} className="text-red-500" />
              </div>
              <p className="text-sm text-[var(--color-text)]">
                Mouse gesture subsystem is not available for your keyboard.
              </p>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Make sure your firmware was built with{" "}
              <code className="text-[var(--color-electric)]">
                CONFIG_ZMK_MOUSE_GESTURE_RPC=y
              </code>{" "}
              and the{" "}
              <a
                href="https://github.com/shakushakupanda/zmk-module-mouse-gesture-rpc"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-electric)] underline"
              >
                zmk-module-mouse-gesture-rpc
              </a>{" "}
              module enabled.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="max-w-4xl mx-auto">
        <Header />

        {error && (
          <div className="glass-card p-4 mb-4 border border-red-500/30">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="glass-card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-medium text-[var(--color-text)]">
              Gestures
            </h2>
            <div className="flex gap-2">
              <button
                className="btn-ghost text-sm flex items-center gap-1"
                onClick={() => void reload()}
                disabled={isLoading}
              >
                <IconReload size={14} />
                Reload
              </button>
              <button className="btn-primary text-sm" disabled>
                + Add (Phase 3)
              </button>
            </div>
          </div>

          {gestures.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">
              {isLoading ? "Loading…" : "No gestures configured yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {gestures.map((g) => (
                <div
                  key={g.id}
                  className="grid grid-cols-[1fr_2fr_2fr_auto] items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-electric)]/40"
                >
                  <div>
                    <div className="text-sm text-[var(--color-text)] font-medium">
                      {g.name || `#${g.id}`}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      id {g.id}
                    </div>
                  </div>
                  <div className="font-mono text-lg tracking-widest text-[var(--color-electric)]">
                    {patternToArrows(g.pattern?.directions ?? [])}
                  </div>
                  <div className="font-mono text-xs text-[var(--color-cyber)]">
                    {bindingToString(g)}
                  </div>
                  <button
                    className="btn-ghost text-xs text-red-400 hover:text-red-300"
                    onClick={() => void deleteGesture(g.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {settings && (
          <div className="glass-card p-5">
            <h2 className="text-base font-medium text-[var(--color-text)] mb-4">
              Settings
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stroke size (px)" value={settings.strokeSize} />
              <Field
                label="Idle timeout (ms)"
                value={settings.idleTimeoutMs}
              />
              <Field
                label="Cooldown (ms)"
                value={settings.gestureCooldownMs}
              />
              <Field
                label="Movement threshold"
                value={settings.movementThreshold}
              />
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-3">
              Editing wires up in Phase 4 (SetSettings RPC).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="p-2 rounded-lg bg-[var(--color-electric)]/10 border border-[var(--color-electric)]/20">
        <IconArrowsRandom size={24} className="text-[var(--color-electric)]" />
      </div>
      <div>
        <h1 className="text-xl font-medium text-[var(--color-text)]">
          Mouse Gesture
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Runtime-configurable trackball gestures
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <label className="block text-xs text-[var(--color-text-muted)] mb-1">
        {label}
      </label>
      <input
        className="w-full px-3 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-electric)]"
        value={value}
        readOnly
      />
    </div>
  );
}
