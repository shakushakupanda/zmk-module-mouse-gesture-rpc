# zmk-module-mouse-gesture-rpc

A ZMK module that adds a **custom Studio RPC subsystem** for runtime-configurable
mouse gestures, wrapping [kot149/zmk-mouse-gesture](https://github.com/kot149/zmk-mouse-gesture).

It exposes itself to [DYA Studio](https://github.com/cormoran/dya-studio) (and other
custom-RPC-aware Studio clients) under the subsystem identifier `cormoran__mouse_gesture`.

> ⚠️ **Status: Phase 1 skeleton.** The subsystem registers and DYA Studio's
> Subsystems page can see it. RPC handlers return placeholders.
> NVS persistence, gesture editing, and integration with the kot149 input
> processor are upcoming phases (see [parent plan](../mouse-gesture-subsystem-plan.md)).

## Requirements

- ZMK fork with custom Studio RPC support: `cormoran/zmk:v0.3-branch+dya` or `main+custom-studio-protocol`
- [`kot149/zmk-mouse-gesture`](https://github.com/kot149/zmk-mouse-gesture) (the underlying gesture engine)
- Zephyr nanopb module (bundled with Zephyr)

## Install — add to your `config/west.yml`

```yaml
manifest:
  remotes:
    - name: cormoran
      url-base: https://github.com/cormoran
    - name: kot149
      url-base: https://github.com/kot149
    - name: shakushakupanda
      url-base: https://github.com/shakushakupanda

  projects:
    # patched ZMK with custom Studio RPC support
    - name: zmk
      remote: cormoran
      revision: v0.3-branch+dya
      import:
        file: app/west.yml

    # gesture engine
    - name: zmk-mouse-gesture
      remote: kot149
      revision: v1

    # this module
    - name: zmk-module-mouse-gesture-rpc
      remote: shakushakupanda            # or your own fork
      revision: main
```

## Enable — add to your `config/<shield>.conf`

```kconfig
CONFIG_ZMK_STUDIO=y
CONFIG_ZMK_MOUSE_GESTURE_RPC=y
```

## Use — connect from DYA Studio

1. Build and flash the central side.
2. Open [DYA Studio](https://studio.dya.cormoran.works/) (or any Studio client).
3. Connect via USB and unlock with `&studio_unlock`.
4. Open the **Subsystems** page on the left sidebar — you should see
   `cormoran__mouse_gesture` listed with its Web UI URL.
5. Click the link to launch the dedicated mouse-gesture Web UI.

To run the bundled Web UI locally during development:

```bash
cd web
npm install
npm run dev
```

…then open <http://localhost:5173>.

## Layout

```
.
├── Kconfig                                       module flags
├── CMakeLists.txt                                build rules (RPC + nanopb)
├── zephyr/module.yml                             zephyr module metadata
├── proto/zmk/mouse_gesture/
│   ├── custom.proto                              RPC message schema
│   └── custom.options                            nanopb size limits
├── src/studio/
│   └── mouse_gesture_handler.c                   subsystem registration + dispatcher
└── web/                                          standalone React + Vite UI
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── App.css
        ├── index.css
        └── lib/
            ├── mouseGestureClient.ts             typed wrapper over ZMKCustomSubsystem
            └── patternFormat.ts                  arrow rendering, binding stringification
```

## RPC surface

Defined in `proto/zmk/mouse_gesture/custom.proto`:

| Method                | Status (Phase 1) |
|-----------------------|------------------|
| `ListGesturesRequest` | ✅ returns empty list |
| `GetGestureRequest`   | ⏳ stub |
| `AddGestureRequest`   | ⏳ stub |
| `UpdateGestureRequest`| ⏳ stub |
| `DeleteGestureRequest`| ⏳ stub |
| `ResetToDefaultsRequest` | ⏳ stub |
| `GetSettingsRequest`  | ✅ returns library defaults |
| `SetSettingsRequest`  | ⏳ stub |

## Roadmap

| Phase | Scope |
|-------|-------|
| **1** *(this commit)* | Subsystem registration + dispatcher + Web UI shell |
| 2     | Read-only list of DTS-defined gestures |
| 3     | Add / Update / Delete + NVS persistence |
| 4     | Settings editor (stroke size, idle timeout, cooldown, …) |
| 5     | Polish: empty states, validation, demo mode handler, docs |

See [`mouse-gesture-subsystem-plan.md`](../mouse-gesture-subsystem-plan.md)
for the full design.

## Why a separate module instead of patching `kot149/zmk-mouse-gesture`?

Keeps the upstream gesture engine pure devicetree-configured (its current
design). This module sits next to it, talks to its data structures through
a future small public API, and provides the runtime configurability needed
by DYA Studio. Easier to maintain in lock-step with cormoran's Studio
protocol patches, easier to revert if needed.
