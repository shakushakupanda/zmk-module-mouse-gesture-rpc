# moNa2 dya-studio ブランチへの統合手順

このモジュールを既存の
[`shakushakupanda/zmk-config-moNa2-v2:dya-studio`](https://github.com/shakushakupanda/zmk-config-moNa2-v2/tree/dya-studio)
に組み込むための具体的な変更手順です。

## 前提

1. 本リポジトリ `zmk-module-mouse-gesture-rpc` を GitHub に push 済み
   (`shakushakupanda/zmk-module-mouse-gesture-rpc` を想定。別の場所でも可)
2. ファーム側で `cormoran/zmk:v0.3-branch+dya` を使用中(現状の moNa2 dya-studio ブランチで採用済み)

## 変更が必要な3ファイル

### 1. `config/west.yml`

**追加する remote**:

```yaml
remotes:
  ...
  - name: kot149                       # ← gesture engine 提供元
    url-base: https://github.com/kot149
  # shakushakupanda は既に shakushakupanda fork を使うなら remote 追加不要。
  # 別 owner の fork を使う場合は追加してください。
```

**追加する projects**:

```yaml
projects:
  ...
  # ── Mouse Gesture ──
  - name: zmk-mouse-gesture
    remote: kot149
    revision: v1
  - name: zmk-module-mouse-gesture-rpc
    remote: shakushakupanda           # ← 自分のアカウントに置いた場合
    revision: main
```

### 2. `config/mona2_r.conf`

```diff
 # Runtime Sensor Rotate (エンコーダ用)
 CONFIG_ZMK_RUNTIME_SENSOR_ROTATE=y
 CONFIG_ZMK_RUNTIME_SENSOR_ROTATE_STUDIO_RPC=y

+# Mouse gesture RPC (DYA Studio から動的設定)
+CONFIG_ZMK_MOUSE_GESTURE_RPC=y
```

### 3. `config/mona2.keymap`(任意)

`kot149/zmk-mouse-gesture` のジェスチャパターンを DTS にも最低限定義しておくと、
ファーム単体で動かしたときの初期挙動が決まる。**Phase 3 完成後は DYA Studio
から動的に追加・編集可能になるので、初期セットは最小限で OK。**

```dts
#include <mouse-gesture.dtsi>
#include <zephyr/dt-bindings/input/input-event-codes.h>

&zip_mouse_gesture {
    stroke-size = <300>;
    enable-eager-mode;

    history_back  { pattern = <GESTURE_RIGHT>;                 bindings = <&kp LA(LEFT)>; };
    history_fwd   { pattern = <GESTURE_LEFT>;                  bindings = <&kp LA(RIGHT)>; };
    close_tab     { pattern = <GESTURE_DOWN GESTURE_RIGHT>;    bindings = <&kp LC(W)>; };
    new_tab       { pattern = <GESTURE_DOWN GESTURE_LEFT>;     bindings = <&kp LC(T)>; };
};
```

そしてトラックボールの入力チェーンに `&zip_mouse_gesture` を挟む。
ただし**今の `mona2_r.overlay` は DYA Studio runtime input processor のチェーン構成済みなので、追加位置は注意**:

```dts
&trackball_central_listener {
    status = "okay";
    device = <&trackball_central>;
    /* mouse → scroll(変換) → mouse-gesture の順 */
    input-processors = <&mouse_runtime_input_processor
                        &scroll_runtime_input_processor
                        &zip_mouse_gesture>;
};
```

ジェスチャを活性化するキーを keymap のどこかに置く:

```dts
/* 例: ble_win レイヤーの空きキーに */
ble_win {
    bindings = <
        ...
        &mouse_gesture_toggle  // ← ここで gesture モードを ON/OFF
        ...
    >;
};
```

## ビルド & 動作確認

1. 上記3ファイルをコミット → push
2. GitHub Actions が回ってビルド完了
3. `mona2_r-*.uf2` を中央側に書き込む
4. DYA Studio (https://studio.dya.cormoran.works/) に USB 接続 → `&studio_unlock` で解錠
5. 左サイドバーの **Subsystems** ページを開く

**期待される表示**:

```
Custom Subsystems
  cormoran__mouse_gesture                           [external link]
    └─ http://localhost:5173       (or your published Web UI URL)
```

リンクをクリックすると、別タブで Mouse Gesture Studio (本リポジトリの `web/`) が
開く。Phase 1 では空の一覧と read-only な settings が表示されるはず。

## Web UI を GitHub Pages に公開する場合

本リポジトリの Actions タブから "Test and Build Web UI" workflow を実行すると、
`https://<account>.github.io/zmk-module-mouse-gesture-rpc/` に web UI がデプロイされる。

その後、ファーム側 `src/studio/mouse_gesture_handler.c` 内の

```c
ZMK_RPC_CUSTOM_SUBSYSTEM_UI_URLS("http://localhost:5173"),
```

を実際の URL に書き換えれば、DYA Studio の Subsystems ページから直接そっちが
開かれるようになる。

## トラブルシュート

| 症状 | 原因と対処 |
|------|-----------|
| DYA Studio の Subsystems ページに `cormoran__mouse_gesture` が出ない | `CONFIG_ZMK_MOUSE_GESTURE_RPC=y` がセットされてない、または west.yml の module 追加忘れ |
| ビルドが nanopb で落ちる | `proto/zmk/mouse_gesture/custom.options` のフィールド名が proto と一致してるか確認 |
| `compiler.h` not found 系の nanopb エラー | Zephyr モジュールパスに `${ZEPHYR_BASE}/modules/nanopb` が入っていない。`CMakeLists.txt` の `list(APPEND CMAKE_MODULE_PATH …)` を再チェック |
| DYA Studio で "subsystem not found" 警告 | 識別子のミスマッチ。firmware の `ZMK_RPC_CUSTOM_SUBSYSTEM(cormoran__mouse_gesture, …)` と Web UI の `SUBSYSTEM_IDENTIFIER` の文字列を完全一致させる |
