/**
 * HID keyboard usage IDs (HID Usage Page 0x07).
 * Subset of ZMK's <dt-bindings/zmk/keys.h> mapped to friendly names.
 *
 * Modifier bits live in the upper byte (bits 24-31) of the encoded uint32:
 *   LC = 0x01 << 24,  LS = 0x02 << 24,  LA = 0x04 << 24,  LG = 0x08 << 24
 *   RC = 0x10 << 24,  RS = 0x20 << 24,  RA = 0x40 << 24,  RG = 0x80 << 24
 */

export interface KeyDef {
    /** Short label shown on the button (e.g. "A", "F12", "Ret"). */
    label: string;
    /** Full display name (e.g. "Return"). */
    name: string;
    /** HID usage ID. */
    code: number;
    /** Searchable aliases. */
    aliases?: string[];
}

export interface KeyGroup {
    id: string;
    label: string;
    keys: KeyDef[];
}

export const MODIFIERS = [
    { id: "lctl", label: "L-Ctrl", mask: 0x01000000 },
    { id: "lshft", label: "L-Shift", mask: 0x02000000 },
    { id: "lalt", label: "L-Alt", mask: 0x04000000 },
    { id: "lgui", label: "L-Gui (Cmd)", mask: 0x08000000 },
    { id: "rctl", label: "R-Ctrl", mask: 0x10000000 },
    { id: "rshft", label: "R-Shift", mask: 0x20000000 },
    { id: "ralt", label: "R-Alt", mask: 0x40000000 },
    { id: "rgui", label: "R-Gui", mask: 0x80000000 },
] as const;

export const MOD_MASK = 0xff000000;
export const KEY_MASK = 0x00ffffff;

const LETTERS: KeyDef[] = [];
for (let i = 0; i < 26; i++) {
    LETTERS.push({
        label: String.fromCharCode(65 + i),
        name: String.fromCharCode(65 + i),
        code: 0x04 + i,
    });
}

const NUMBERS: KeyDef[] = [
    { label: "1", name: "1", code: 0x1e },
    { label: "2", name: "2", code: 0x1f },
    { label: "3", name: "3", code: 0x20 },
    { label: "4", name: "4", code: 0x21 },
    { label: "5", name: "5", code: 0x22 },
    { label: "6", name: "6", code: 0x23 },
    { label: "7", name: "7", code: 0x24 },
    { label: "8", name: "8", code: 0x25 },
    { label: "9", name: "9", code: 0x26 },
    { label: "0", name: "0", code: 0x27 },
];

const SPECIAL: KeyDef[] = [
    { label: "Ret", name: "Return", code: 0x28, aliases: ["enter"] },
    { label: "Esc", name: "Escape", code: 0x29, aliases: ["escape"] },
    { label: "BkSp", name: "Backspace", code: 0x2a, aliases: ["bksp"] },
    { label: "Tab", name: "Tab", code: 0x2b },
    { label: "Spc", name: "Space", code: 0x2c, aliases: ["spc"] },
    { label: "-", name: "Minus -", code: 0x2d, aliases: ["minus", "dash"] },
    { label: "=", name: "Equal =", code: 0x2e, aliases: ["equal"] },
    { label: "[", name: "Left bracket [", code: 0x2f, aliases: ["bracket"] },
    { label: "]", name: "Right bracket ]", code: 0x30, aliases: ["bracket"] },
    { label: "\\", name: "Backslash \\", code: 0x31, aliases: ["backslash"] },
    { label: "#", name: "Non-US hash #", code: 0x32 },
    { label: ";", name: "Semicolon ;", code: 0x33 },
    { label: "'", name: "Quote '", code: 0x34, aliases: ["quote", "apostrophe"] },
    { label: "`", name: "Grave `", code: 0x35, aliases: ["grave", "backtick"] },
    { label: ",", name: "Comma ,", code: 0x36 },
    { label: ".", name: "Period .", code: 0x37, aliases: ["dot"] },
    { label: "/", name: "Slash /", code: 0x38, aliases: ["slash"] },
    { label: "Caps", name: "Caps Lock", code: 0x39, aliases: ["capslock"] },
];

const FUNCTION: KeyDef[] = [];
for (let i = 0; i < 12; i++) {
    FUNCTION.push({
        label: `F${i + 1}`,
        name: `F${i + 1}`,
        code: 0x3a + i,
    });
}
for (let i = 0; i < 12; i++) {
    FUNCTION.push({
        label: `F${i + 13}`,
        name: `F${i + 13}`,
        code: 0x68 + i,
    });
}

const NAVIGATION: KeyDef[] = [
    { label: "PrtSc", name: "Print Screen", code: 0x46, aliases: ["printscreen"] },
    { label: "ScrLk", name: "Scroll Lock", code: 0x47 },
    { label: "Pause", name: "Pause", code: 0x48 },
    { label: "Ins", name: "Insert", code: 0x49, aliases: ["insert"] },
    { label: "Home", name: "Home", code: 0x4a },
    { label: "PgUp", name: "Page Up", code: 0x4b, aliases: ["pageup"] },
    { label: "Del", name: "Delete", code: 0x4c, aliases: ["delete"] },
    { label: "End", name: "End", code: 0x4d },
    { label: "PgDn", name: "Page Down", code: 0x4e, aliases: ["pagedown"] },
    { label: "→", name: "Right Arrow", code: 0x4f, aliases: ["right"] },
    { label: "←", name: "Left Arrow", code: 0x50, aliases: ["left"] },
    { label: "↓", name: "Down Arrow", code: 0x51, aliases: ["down"] },
    { label: "↑", name: "Up Arrow", code: 0x52, aliases: ["up"] },
];

const NUMPAD: KeyDef[] = [
    { label: "Num", name: "NumLock", code: 0x53 },
    { label: "Kp/", name: "Keypad /", code: 0x54 },
    { label: "Kp*", name: "Keypad *", code: 0x55 },
    { label: "Kp-", name: "Keypad -", code: 0x56 },
    { label: "Kp+", name: "Keypad +", code: 0x57 },
    { label: "KpRet", name: "Keypad Enter", code: 0x58 },
    { label: "Kp1", name: "Keypad 1", code: 0x59 },
    { label: "Kp2", name: "Keypad 2", code: 0x5a },
    { label: "Kp3", name: "Keypad 3", code: 0x5b },
    { label: "Kp4", name: "Keypad 4", code: 0x5c },
    { label: "Kp5", name: "Keypad 5", code: 0x5d },
    { label: "Kp6", name: "Keypad 6", code: 0x5e },
    { label: "Kp7", name: "Keypad 7", code: 0x5f },
    { label: "Kp8", name: "Keypad 8", code: 0x60 },
    { label: "Kp9", name: "Keypad 9", code: 0x61 },
    { label: "Kp0", name: "Keypad 0", code: 0x62 },
    { label: "Kp.", name: "Keypad .", code: 0x63 },
];

export const KEY_GROUPS: KeyGroup[] = [
    { id: "letters", label: "Letters", keys: LETTERS },
    { id: "numbers", label: "Numbers", keys: NUMBERS },
    { id: "special", label: "Special", keys: SPECIAL },
    { id: "function", label: "Function", keys: FUNCTION },
    { id: "navigation", label: "Nav / Edit", keys: NAVIGATION },
    { id: "numpad", label: "Numpad", keys: NUMPAD },
];

/** Build a single uint32 from base keycode + modifier mask bits. */
export function encodeKey(code: number, modMask: number): number {
    // force unsigned 32-bit
    return (modMask | (code & KEY_MASK)) >>> 0;
}

/** Inverse of encodeKey: separate modifier bits and key code. */
export function decodeKey(value: number): { code: number; modMask: number } {
    return {
        modMask: (value & MOD_MASK) >>> 0,
        code: value & KEY_MASK,
    };
}

/** Try to render an encoded key as "Cmd+Ctrl+W" style. Returns null if no key found. */
export function describeEncoded(value: number): string | null {
    const { code, modMask } = decodeKey(value);
    const mods: string[] = [];
    for (const m of MODIFIERS) {
        if ((modMask & m.mask) !== 0) {
            // strip "L-" / "R-" for compactness
            mods.push(m.label.replace(/^[LR]-/, ""));
        }
    }
    let keyName: string | null = null;
    for (const g of KEY_GROUPS) {
        for (const k of g.keys) {
            if (k.code === code) {
                keyName = k.name;
                break;
            }
        }
        if (keyName) break;
    }
    if (!keyName && code === 0) return mods.length ? mods.join("+") : null;
    if (!keyName) return null;
    return [...mods, keyName].join("+");
}
