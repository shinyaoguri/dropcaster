# main+control 統合リファクタ計画

## 動機

プロジェクション中、メインウィンドウ（スケッチ iframe が動いている＝ rAF のホスト）が
ブラウザに hidden 判定されると captureStream がフリーズする。とくに Chrome on Windows は
fully occluded なウィンドウを hidden に落とすので、現状の「main＋control popout＋output popout」
の 3 ウィンドウ構成では control popout が main を完全に覆うと事故になる。

**解決の方向**: laptop 側のウィンドウを 1 個にまとめる（main の中に control の UI をペインとして組み込む）。
laptop に存在するウィンドウが 1 つしかなければ occlusion は構造的に起こり得ず、main の rAF が止まらない。

## 最終形

```
[Operator window（laptop、＝今までの「メインウィンドウ」）]
  ├─ 通常時: ギャラリー／スケッチページ／スライドショー（変更なし）
  └─ 投影モード時: 右側に control パネルがスライドイン（mapping list, source crop,
      quad handles, test pattern, save/load, output bounds）

[Output window（projector、popout）]
  ├─ 変更なし（warp 済み <video> N 枚）
  └─ Window Management API で外部画面に自動配置
```

postMessage は main↔output だけ残り、main↔control は in-process の関数呼び出しになる。

## 段階

### Step 1: ControlHost 抽象の導入と popout 実装の差し替え

**目的**: ControlWindow が `this.window.opener.postMessage` 等の popout 前提に直接依存している
状態を、`ControlHost` インターフェース経由に置き換える。これが「同じ UI を popout でも main でも
ホストできる」ための seam になる。

**触る箇所**:
- 新規: [`src/viewer/windows/control/ControlHost.ts`](../../src/viewer/windows/control/ControlHost.ts) — インターフェース定義
- 新規: `src/viewer/windows/control/PopoutControlHost.ts` — popout 環境向けの実装
- 既存: [`src/viewer/windows/control/ControlWindow.ts`](../../src/viewer/windows/control/ControlWindow.ts)
  - `getParentWindow()`／`postMessage` を直接呼んでいる箇所を `ControlHost` のメソッドに置換
  - `this.window.addEventListener('message', ...)` を `ControlHost` の `on*Change` 購読に置換
  - `this.window.document.getElementById(...)` を `this.host.querySelector('#...')` に置換
    （id 衝突を main 側で起こさないよう、ホスト要素にスコープした探索にする）

完了条件: popout が現状と同じ振る舞いをすること。コード上は postMessage を直接さわっていない。

### Step 2: InlineControlHost を実装、main にエディタペインを追加

**目的**: main の中に `ControlHost` のもう 1 個の実装と「ペインのシェル」を作って、popout と
**並走可能な状態**にする（A/B テスト的に両方表示できる時期を作る）。

**触る箇所**:
- 新規: `src/viewer/windows/control/InlineControlHost.ts` — main 内向け実装。
  `WindowController` の state event を直接購読し、mutation も直接呼ぶ。
- 既存: [`src/viewer/components/SketchPageView.ts`](../../src/viewer/components/SketchPageView.ts) /
  [`src/viewer/components/SlideshowView.ts`](../../src/viewer/components/SlideshowView.ts) — 投影モード中に表示する
  右ペイン (`<aside id="dc-editor">`) のマークアップを追加。
- 既存: [`src/viewer/components/SketchPageController.ts`](../../src/viewer/components/SketchPageController.ts) —
  投影モード開始時に `InlineControlHost` を作り `ControlWindow` を mount／teardown。
- 既存: [`src/viewer/components/WindowController.ts`](../../src/viewer/components/WindowController.ts) —
  「ローカルから直接呼ぶ用」のメソッド群を露出（テストパターン設定／state 差し替え等は既にあるが、
  state event の購読口（onStateChange など）を提供）。
- 既存: [`src/viewer/style.css`](../../src/viewer/style.css) — ペインのレイアウト（split / divider）。

注意:
- ControlWindow の CSS は popout 内に閉じている前提（`body` セレクタ等を使っている）ので、
  main の CSS と衝突しないよう、すべて `.dc-control-shell *` でスコープする必要がある。
- id ベースの DOM 探索（`mappings-list`, `add-mapping-btn` 等）は scope された `querySelector` に
  既に置き換わっている前提（Step 1 で済ませる）。

完了条件: 投影モードに入ると main の右側にペインが出て、popout と同じ操作ができる。
popout もまだ開いていて、両方で同じ state を編集できる。

### Step 3: popout を切り離す

**目的**: control popout を開かなくなる。`BaseWindow` / `WindowManager` の管理対象から外す。

**触る箇所**:
- 既存: [`src/viewer/components/WindowController.ts`](../../src/viewer/components/WindowController.ts) —
  `openControlWindow` / `openBothWindows` / `broadcastStateToControl` / `notifyVideoDimensions`（control 向け）/
  `notifyOutputBounds`（control 向け）/ `broadcastTestPatternState` / `broadcastWebglContextStatus` /
  `broadcastSourceVisibility` を撤去。main↔output 配線だけ残す。
- 既存: `ControlWindow.ts` から popout 用のコード（`render()` で `window.document.body` を書き換える系）を
  剥がす。`PopoutControlHost` も削除。
- 既存: [`src/viewer/managers/WindowManager.ts`](../../src/viewer/managers/WindowManager.ts) — `control_window` の
  管理を削除（残るのは `output_window` のみ）。

完了条件: laptop に出ているウィンドウは main 1 個だけ。

### Step 4: 不要になった保険を整理

**目的**: Step 3 完了時点で B/C は不要なので削除。A は出力ウィンドウだけに残す。

**触る箇所**:
- B（ソース可視性警告）の broadcast を `WindowController` から撤去。`ControlWindow` 側の
  バナー表示は残しても害はないが、発火元がないので実質 dead code → 撤去。
- C（無音 audio keepalive）と `SilentKeepAlive` クラスを撤去。
- A（Wake Lock）の `WindowController` 側を残す（main＝投影制御の窓なので妥当）。
- 関連ドキュメントも整理（README の「長時間運用のコツ」セクション）。

完了条件: コード正味でかなり減量し、振る舞いは Step 3 と同じ。

## 注意点・既知の課題

- **ControlWindow.ts の CSS scoping** — 現状 `body { ... }` のような selector が含まれる。main の
  CSS と混ぜるなら全部 `.dc-control-shell .control-container` のように prefix する必要がある（Step 1 か 2）。
- **id 衝突** — `mappings-list` 等の id は scoped `querySelector` で見るように改修する必要がある。
- **quad-handle のドラッグ座標系** — ControlWindow の `innerWidth/Height` を見ている計算箇所が
  ペイン bounding box ベースに変わる（Step 2 で対応）。
- **router との関係** — エディタペインは投影モード中だけ表示すれば良いので、route 変更で消す／出すは
  SketchPageController/SlideshowView の責務。route 切替で WindowController 自体は生き続けるか、
  毎回再生成するかの整理（既存の振る舞いに合わせる）。
- **テスト** — このリファクタは自動テストが無いので、各 Step で手動確認シナリオを残す。

## 完了後の構造

- ウィンドウ管理: main は普通のタブ、output だけが popout
- postMessage: main↔output のみ（state-update, output-needs-stream 系）
- ControlWindow: main 内のペインとしてマウントされる UI コンポーネント
- WindowController: state の owner、output へ broadcast、stream の bind を司る（main 内のペインへの
  state push は直接 event で OK）
