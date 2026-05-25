/**
 * Mouse-gesture custom RPC client — Phase 1 placeholder.
 *
 * The real client (typed wrapper around ZMKCustomSubsystem.callRPC + nanopb
 * encode/decode) ships in Phase 2 once we publish the matching Studio React
 * hook. For now this file just holds the subsystem identifier so the rest of
 * the project can reference it.
 *
 * See ../../dya-studio-integration/useMouseGesture.ts for the version that
 * runs inside DYA Studio.
 */

export const SUBSYSTEM_IDENTIFIER = "cormoran__mouse_gesture";
