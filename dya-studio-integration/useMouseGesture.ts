/**
 * React hook for the mouse-gesture custom RPC subsystem,
 * matching the DYA Studio code style (compare with src/hooks/useRuntimeInputProcessor.ts).
 *
 * Drop this into dya-studio/src/hooks/useMouseGesture.ts.
 */

import { useCallback, useContext, useEffect, useState } from "react";
import {
  ZMKAppContext,
  ZMKCustomSubsystem,
} from "@cormoran/zmk-studio-react-hook";
import {
  Request,
  Response,
  Gesture,
  Settings,
} from "../proto/zmk/mouse_gesture/custom";

// Subsystem identifier; must match the firmware-side ZMK_RPC_CUSTOM_SUBSYSTEM(...) name.
const SUBSYSTEM_IDENTIFIER = "cormoran__mouse_gesture";

export interface UseMouseGestureResult {
  available: boolean;
  isLoading: boolean;
  error: string | null;
  gestures: Gesture[];
  settings: Settings | null;
  reload: () => Promise<void>;
  addGesture: (g: Gesture) => Promise<void>;
  updateGesture: (g: Gesture) => Promise<void>;
  deleteGesture: (id: number) => Promise<void>;
  setSettings: (s: Settings) => Promise<void>;
}

export function useMouseGesture(): UseMouseGestureResult {
  const zmkApp = useContext(ZMKAppContext);
  const subsystem = zmkApp?.findSubsystem(SUBSYSTEM_IDENTIFIER);
  const available = !!subsystem;

  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callRPC = useCallback(
    async (req: Request): Promise<Response> => {
      if (!zmkApp?.state.connection || !subsystem) {
        throw new Error("Subsystem unavailable");
      }
      const svc = new ZMKCustomSubsystem(
        zmkApp.state.connection,
        subsystem.index,
      );
      const payload = Request.encode(req).finish();
      const respPayload = await svc.callRPC(payload);
      if (!respPayload) throw new Error("Empty response");
      const resp = Response.decode(respPayload);
      if (resp.error) throw new Error(resp.error.message || "RPC error");
      return resp;
    },
    [zmkApp?.state.connection, subsystem],
  );

  const reload = useCallback(async () => {
    if (!available) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = await callRPC(Request.create({ listGestures: {} }));
      setGestures(list.listGestures?.gestures ?? []);
      const s = await callRPC(Request.create({ getSettings: {} }));
      setSettingsState(s.settings?.settings ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [available, callRPC]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addGesture = useCallback(
    async (g: Gesture) => {
      await callRPC(Request.create({ addGesture: { gesture: g } }));
      await reload();
    },
    [callRPC, reload],
  );

  const updateGesture = useCallback(
    async (g: Gesture) => {
      await callRPC(Request.create({ updateGesture: { gesture: g } }));
      await reload();
    },
    [callRPC, reload],
  );

  const deleteGesture = useCallback(
    async (id: number) => {
      await callRPC(Request.create({ deleteGesture: { id } }));
      await reload();
    },
    [callRPC, reload],
  );

  const setSettings = useCallback(
    async (s: Settings) => {
      await callRPC(Request.create({ setSettings: { settings: s } }));
      await reload();
    },
    [callRPC, reload],
  );

  return {
    available,
    isLoading,
    error,
    gestures,
    settings,
    reload,
    addGesture,
    updateGesture,
    deleteGesture,
    setSettings,
  };
}
