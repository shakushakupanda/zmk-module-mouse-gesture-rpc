# Mouse Gesture Studio (standalone web UI)

Standalone web UI for the `cormoran__mouse_gesture` custom Studio RPC
subsystem. Talks to the keyboard directly via the
[Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
— no DYA Studio fork required.

Use it to:

- List, add, edit, delete gestures
- Tune sensitivity settings (stroke size, idle timeout, cooldown, …)
- Reset to DTS defaults
- Inspect the firmware breadcrumb log (Phase 5 debug aid)

The deployed page lives at
[`https://shakushakupanda.github.io/zmk-module-mouse-gesture-rpc/`](https://shakushakupanda.github.io/zmk-module-mouse-gesture-rpc/)
and is the URL that the firmware advertises via
`ZMK_RPC_CUSTOM_SUBSYSTEM_UI_URLS`, so clicking the link from DYA Studio's
"Subsystems" page opens it automatically.

## Browser support

Requires a Web Serial-capable browser:

- ✅ Chrome ≥ 89 (desktop)
- ✅ Edge ≥ 89
- ✅ Opera ≥ 75
- ❌ Firefox, Safari

## Local development

```sh
cd web
npm install
npm run dev       # http://localhost:5173/zmk-module-mouse-gesture-rpc/
```

The Vite `base` path is `/zmk-module-mouse-gesture-rpc/` to match the
GitHub Pages deployment. When developing locally, browse to
`http://localhost:5173/zmk-module-mouse-gesture-rpc/`.

Plug your keyboard in via USB, click **Connect**, pick the serial port,
and you're in.

Tip: close any other tab / app currently holding the keyboard's serial
port (DYA Studio in another tab, an open `screen` session, `mg_cli.py`).

## Build

```sh
npm run build      # outputs to web/dist/
npm run preview    # serve the built bundle locally
```

The `.github/workflows/deploy-pages.yml` at the repo root builds and
deploys this on push to `main`.

## Architecture

```
web/src/
├── App.tsx                       Top-level React component + UI
├── App.css                       Styling (uses CSS variables)
├── index.css                     Theme tokens (--bg, --accent, …)
├── main.tsx                      Entry point
└── lib/
    ├── framing.ts                SOF/ESC/EOF byte-stuffing framer
    ├── protobuf.ts               Hand-rolled varint / tag / walkFields helpers
    ├── studioEnvelope.ts         Outer zmk.studio.Request / Response wrapping
    ├── mouseGestureProto.ts      Encoders/decoders for our zmk.mouse_gesture.*
    ├── transport.ts              Web Serial wrapper (call/response correlator)
    ├── mouseGestureClient.ts     High-level API (listGestures, addGesture, …)
    └── patternFormat.ts          UI helpers (arrow rendering, log mnemonics)
```

No code generation. The protobuf encoder/decoder is hand-rolled for
exactly the messages we need — keeps the bundle small (no protobufjs at
runtime) and avoids a build-time codegen step.

## Why standalone instead of forking DYA Studio

See [`../dya-studio-integration/README.md`](../dya-studio-integration/README.md)
for the DYA Studio fork approach. The standalone variant trades style
consistency for autonomy: you don't have to track DYA Studio's release
cadence, you can deploy from this repo's GitHub Pages, and licensing is
clean (no AGPL surface from dya-studio).

## Known limitations

- Settings RPC writes are accepted by firmware but **only a subset are
  honored at runtime** by kot149's input processor (it reads stroke
  size / idle timeout etc. from DTS at boot). Changing those today
  updates the persisted store; a future patch will make kot149 honor
  the runtime values.
- The "Behavior" field must use the ZMK device label (e.g. `key_press`,
  not the keymap shorthand `kp`). The on-device behavior lookup is
  case-sensitive.
- Web Serial is desktop-only; mobile browsers can't open a USB port.
