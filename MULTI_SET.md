# Multi-Set Gestures (Approach D)

Five independent gesture sets, each addressable by `&mg_set N` (0..4).
Hold the activation key, stroke a single direction (↑/→/↓/←), release —
the binding configured for that (set, direction) cell fires.

All 5×4=20 binding cells are dynamically editable via the Web UI; no
firmware rebuild required to change them.

## Concepts

- **Set**: an independent gesture set, identified by `set_id` (0..NUM_SETS-1).
- **Active set**: the set currently pushed to kot149's runtime trie.
  Exactly one set is active at any time. Pressing `&mg_set N` switches
  the active set to N.
- **Cell**: a (set, direction) pair. Each cell holds 0 or 1 gesture.
  In the firmware, a "single-stroke" gesture has `pattern_len == 1` and
  one direction.
- **Activation refcount**: pressing `&mg_set N` increments a global
  counter. When >= 1, kot149's matcher is ON. When all keys are
  released, matcher fires the matched gesture (if any) and goes OFF.
  This lets you transition between sets while staying in gesture mode
  (Logicool-style).

## Firmware changes

```
src/behaviors/behavior_mg_set.c       NEW   the &mg_set behavior
dts/bindings/behaviors/
   zmk,behavior-mg-set.yaml           NEW   DT binding
dts/behaviors/mg-set.dtsi             NEW   behavior instance
dts/mouse-gesture-rpc.dtsi            NEW   top-level include for users
src/storage/gesture_store.{h,c}              add set_id, activate_set
src/studio/mouse_gesture_handler.c            set_id passthrough
proto/zmk/mouse_gesture/custom.proto         add Gesture.set_id = 6
Kconfig                                       add NUM_SETS option
```

## moNa2 (or any keyboard) integration

### 1. Include the module's top-level dtsi in your keymap

```dts
// At the top of mona2.keymap, after the other behavior includes:
#include <mouse-gesture-rpc.dtsi>
```

This makes the `&mg_set` behavior available.

### 2. Remove `always-active;` from the mg input-processor

In `mona2_r.overlay`:

```dts
mg: mouse_gesture {
    compatible = "zmk,input-processor-mouse-gesture";
    #input-processor-cells = <0>;
    /* always-active; ← remove this */
    stroke-size = <200>;
    idle-timeout-ms = <150>;
    gesture-cooldown-ms = <500>;
};
```

Without `always-active`, the matcher only fires while `&mg_set N` is held.

### 3. Bind `&mg_set N` to 5 keys of your choice

Example: replace 5 thumb keys on the mac_layer. Any keys you like — they
just need to be reachable with the left hand while the right hand drives
the trackball.

```dts
mac_layer {
    bindings = <
        ... /* upper rows unchanged */
        &mg_set 0    &mg_set 1    &mg_set 2    &lt 3 GRAVE   &lt 5 SPACE   &lt 7 MINUS    &kp ENTER   &kp BACKSPACE                                                  &mg_set 3
        /* row 4 — left thumb cluster gets sets 0/1/2/3, right shift becomes set 4 example */
    >;
};
```

(Exact placement is your call. Each `&mg_set N` is a single binding
cell, just like `&kp ESC`.)

### 4. Build, flash, and configure via the Web UI

1. Push the new branch with the DTS + keymap changes.
2. Wait for GitHub Actions to build new uf2 files (mona2_l, mona2_r).
3. Flash both halves.
4. Open the Mouse Gesture Studio Web UI:
   <https://shakushakupanda.github.io/zmk-module-mouse-gesture-rpc/>
5. Click Connect → pick the serial port.
6. The 5×4 grid view shows all 20 cells. Click any cell to assign a
   binding (Key Picker supports HID keys + modifier toggles).

### 5. Use it

- Hold `&mg_set 0` → stroke ↑ → fires the binding you set in cell (0, ↑)
- Hold `&mg_set 1` → stroke → → fires the binding in cell (1, →)
- And so on.

Switching mid-gesture works: if you hold key A then key B without
releasing A, set B becomes active. When you release B, set A's matcher
remains on (refcount stays positive).

## Edge cases

- **Empty cell**: if you stroke a direction with no binding in the active
  set, nothing fires.
- **Set out of range**: `&mg_set 99` silently returns -EINVAL; the
  matcher doesn't engage. (You'd never hit this if you stick to 0..NUM_SETS-1.)
- **No `&mg_set` held**: matcher is OFF; trackball just moves the cursor
  normally.
- **Concurrent edits while a set is active**: editing a gesture in a
  non-active set doesn't disrupt anything. Editing the active set
  triggers an immediate re-sync.

## Tuning NUM_SETS

`CONFIG_ZMK_MOUSE_GESTURE_RPC_NUM_SETS` (default 5, range 1..16). To use
more or fewer sets, adjust in your conf and recompile. The Web UI grid
always shows the first NUM_SETS rows.

## When you want to revert to single-set (no `&mg_set`)

Re-add `always-active;` to the mg node in your overlay and unbind
`&mg_set` from your keymap. All gestures with set_id==0 continue to
work; gestures in other sets won't fire (since the active set is fixed
at 0).
