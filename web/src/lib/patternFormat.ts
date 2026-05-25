/**
 * Utility to format a gesture pattern as an arrow string and to encode
 * the dropdown selections into the Direction enum. Phase 1 ships with a
 * local Direction enum copy; Phase 2 will switch to the ts-proto–generated
 * one once we hook up the real RPC client.
 */

export enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3,
}

export const DIRECTION_ARROWS: Record<Direction, string> = {
  [Direction.UP]: "↑",
  [Direction.RIGHT]: "→",
  [Direction.DOWN]: "↓",
  [Direction.LEFT]: "←",
};

export const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.UP]: "UP",
  [Direction.RIGHT]: "RIGHT",
  [Direction.DOWN]: "DOWN",
  [Direction.LEFT]: "LEFT",
};

export function patternToArrows(directions: Direction[]): string {
  if (!directions.length) return "—";
  return directions.map((d) => DIRECTION_ARROWS[d] ?? "?").join(" ");
}

/**
 * Convert a Binding to a human-readable form like "kp 0x0017 0".
 * Replace with a smarter resolver later (mapping keycode numbers to names).
 */
export function bindingToString(
  behavior: string,
  param1: number,
  param2: number,
): string {
  if (!behavior) return "—";
  if (param2 === 0) {
    return `${behavior} 0x${param1.toString(16).padStart(4, "0")}`;
  }
  return `${behavior} 0x${param1.toString(16)} 0x${param2.toString(16)}`;
}
