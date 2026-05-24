# DYA Studio main app への直接統合(オプション)

`zmk-module-mouse-gesture-rpc/web/` 配下のスタンドアロン UI で大体のことは
できるが、**DYA Studio の左サイドバーに専用タブとして組み込みたい場合**は、
[cormoran/dya-studio](https://github.com/cormoran/dya-studio) を fork して
以下3ファイルを追加する。

## 配置先

```
dya-studio/
├── src/
│   ├── hooks/
│   │   └── useMouseGesture.ts        ← このディレクトリの useMouseGesture.ts
│   ├── pages/
│   │   └── MouseGesturePage.tsx      ← このディレクトリの MouseGesturePage.tsx
│   └── App.tsx                       ← ナビ項目を1行追加
└── proto/zmk/mouse_gesture/
    └── custom.proto                  ← firmware側と同じファイル
```

## App.tsx へのナビ追加

```tsx
import { MouseGesturePage } from "./pages/MouseGesturePage";

// ナビゲーション配列に追加(例: BatteryPage の下)
{
  id: "mouse-gesture",
  label: "Mouse Gesture",
  icon: <IconArrowsRandom size={18} />,
  content: <MouseGesturePage />,
},
```

## proto の生成

ts-proto を使って TypeScript 型を生成する:

```bash
cd dya-studio
mkdir -p src/proto/mouse_gesture
protoc \
  --plugin=./node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out=src/proto/mouse_gesture \
  --ts_proto_opt=esModuleInterop=true,forceLong=number \
  --proto_path=proto \
  proto/zmk/mouse_gesture/custom.proto
```

dya-studio 既存の proto 生成スクリプトがあればそれに乗せると楽。

## 注意

DYA Studio 本体は **MIT + AGPL**(複合)で配布されてるので、fork して内部
追加する場合はライセンスを確認。**多くの場合はスタンドアロン Web UI に
留めて、DYA Studio の "Subsystems" ページのリンク経由で開いてもらう
形がトラブルが少ない。**

スタンドアロンで困らないユースケース:
- 自分専用のキーボードでの使用
- 他人に配布するときに DYA Studio の更新を追わなくて済ませたい

DYA Studio に統合した方がよいユースケース:
- 既存ユーザーが追加 URL なしで使えるようにしたい
- DYA Studio 本体に PR を投げて upstream する想定
