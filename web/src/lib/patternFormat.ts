/**
 * Utility to format a gesture pattern as an arrow string and to encode
 * the dropdown selections into the protobuf Direction enum.
 */

import { Direction } from "../proto/zmk/mouse_gesture/custom";

export const DIRECTION_ARROWS: Record<Direction, string> = {
  [Direction.DIRECTION_UP]: "↑",
  [Direction.DIRECTION_RIGHT]: "→",
  [Direction.DIRECTION_DOWN]: "↓",
  [Direction.DIRECTION_LEFT]: "←",
};

export const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.DIRECTION_UP]: "UP",
  [Direction.DIRECTION_RIGHT]: "RIGHT",
  [Direction.DIRECTION_DOWN]: "DOWN",
  [Direction.DIRECTION_LEFT]: "LEFT",
};

export function patternToArrows(directions: Direction[]): string {
  if (!directions.length) return "—";
  return directions.map((d) => DIRECTION_ARROWS[d] ?? "?").join(" ");
}

/**
 * Convert a Binding to a human-readable form like "kp 0x0017 0".
 * Replace with a smarter resolver later (mapping keycode numbers to names).
 */
export function bindingToString(behavior: string, param1: number, param2: number): string {
  if (!behavior) return "—";
  if (param2 === 0) return `${behavior} 0x${param1.toString(16).padStart(4, "0")}`;
  return `${behavior} 0x${param1.toString(16)} 0x${param2.toString(16)}`;
}
