# dropcaster

> ⚠️ **Alpha Version**: This project is under active development. APIs may change.

OpenProcessing の作品をブラウザベースの投影マッピング用ビューアとして使うためのツール。**ホスト版 ([dropcaster.soui.dev](https://dropcaster.soui.dev)) で作品 ID を入れればすぐ動かせる**ほか、**ローカル CLI で自分専用のキュレーションギャラリーを作って公開する**こともできる。

> 🔒 **信頼モデル（重要）**
>
> dropcaster は **自分で内容を確認したスケッチを置いて使うツール** です。スケッチは `<iframe>` で読み込まれますが、`sandbox` 属性を付けず親と同じオリジンから配信されるため、スケッチの JS は親ページ（ギャラリー本体）の DOM・`localStorage`・`window.opener`／出力ウィンドウ・他スケッチのキャプチャストリームに**自由にアクセスできます**。
>
> したがって、第三者の OpenProcessing 作品などを**無検証のまま大量に投入する用途は想定していません**。任意のスケッチを安全に展示したい場合は、別オリジン配信＋`sandbox` 属性＋協調的な `postMessage` / `captureStream` 受け渡し、といった構成が必要になります（dropcaster 本体には現状その機能はありません）。展示で使うときは取り込んだ `mySketch.js` / `index.html` に目を通すか、信頼できる作者の作品に限定してください。

## 特徴

- 🌐 ホスト版 ([dropcaster.soui.dev](https://dropcaster.soui.dev)) で OpenProcessing 作品 ID を入れて即起動
- 🎭 ブラウザベースのプロジェクションマッピング（出力ウィンドウ + `matrix3d` ワープ）
- 📥 `dropcaster fetch <id>` で OP 作品をローカルに取り込み（アセット同梱）
- 🎨 ローカル CLI でキュレーションギャラリーを生成
- 🖼️ アニメーションプレビュー GIF の自動生成
- 📱 Progressive Web App (PWA) サポート（Service Worker による多バケットキャッシュ）
- 🚀 静的サイト生成、複数ホスティング対応

## 2 つの使い方

### A. ホスト版を使う（インストール不要）

[**https://dropcaster.soui.dev**](https://dropcaster.soui.dev) を開いて、OpenProcessing の作品 ID（または URL）を入れるだけ。投影マッピング機能まで全部使える。

```
https://dropcaster.soui.dev/                   ← ID 入力 UI
https://dropcaster.soui.dev/?op=2257553        ← クエリで直接指定（ブックマーク用）
https://dropcaster.soui.dev/op/2257553         ← パスでも可
```

- 対応エンジン: 現状 **p5js mode のみ**（段階的に拡張予定）
- 外部アセット付き作品（`loadImage` 等）は同レポジトリの Cloudflare Worker が `/op-cdn/*` で CORS proxy するので、tainted せず `captureStream` でき投影マッピングが成立
- 公開作品のみ（OP の `isPrivate: 0`）

### B. ローカル CLI で自分のギャラリーを作る

複数の作品をキュレーションして自分用ギャラリーサイトに公開する用途。プレビュー GIF とスライドショー、`dropcaster.config.js` でのカスタマイズが使える。下記「インストール」以降が CLI 経路の説明。

## インストール

### GitHubから直接インストール

```bash
# グローバルインストール
npm install -g github:shinyaoguri/dropcaster

# npxで直接実行
npx github:shinyaoguri/dropcaster init my-gallery
```

### ローカル開発用

```bash
# リポジトリをクローン
git clone https://github.com/shinyaoguri/dropcaster.git
cd dropcaster

# 依存関係をインストール
npm install

# ローカルでリンク
npm link
```

## クイックスタート

### 1. 新しいギャラリーを作成

```bash
# GitHubから直接実行
npx github:shinyaoguri/dropcaster init my-gallery
cd my-gallery

# ローカル開発中のリポジトリから実行
npx /path/to/dropcaster init my-gallery
cd my-gallery

# またはローカルインストール後
dropcaster init my-gallery
cd my-gallery
```

### 2. スケッチを追加

#### 方法 1: `dropcaster fetch` で OpenProcessing から自動取り込み（推奨）

```bash
dropcaster fetch 2257553
# → sketches/sketch2257553/ にコード + アセット + _op-meta.json を書き出す
# → loadImage('https://deckard...') は自動で 'assets/.../' に書き換わるので
#   オフラインでも動く完全自己完結な sketch ディレクトリになる

dropcaster fetch 2862331 -v              # 詳細ログ
dropcaster fetch 2257553 --overwrite     # 既存ディレクトリを置き換え
dropcaster fetch 2257553 --no-assets     # アセット同梱をスキップ（OP CDN 依存のまま）
```

#### 方法 2: 手動で配置

OpenProcessing から書き出した HTML / JS を `sketches/` に手動配置:
```
sketches/
  sketch2257553/
    index.html
    mySketch.js
  sketch2326097/
    index.html
```

> **プロジェクションマッピングで使うスケッチの推奨設定**
>
> 投影出力の解像度は **canvas のバッキングストア解像度（`canvas.width × canvas.height`）** だけで決まります。`captureStream` がこの解像度のフレームを運び、それを各マッピングがワープしてプロジェクタへ出すため、表示ウィンドウや作業ディスプレイの解像度・ピクセル比には左右されません（2K のディスプレイで作業して 4K のコンテンツを 4K プロジェクタに出す、も問題なくできます）。なので **固定の高解像度で canvas を作る**のが要点です。p5.js なら:
>
> ```js
> function setup() {
>   pixelDensity(1);            // Retina 環境で意図せず 2倍解像度になるのを防ぐ
>   createCanvas(3840, 2160);   // プロジェクタ以上の固定解像度。キーストン補正で四隅を
>                               // 伸ばす分の余裕を見て少し大きめにしてもよい
>   // ※ windowWidth / windowHeight 任せにすると、出力解像度がメインウィンドウのサイズに
>   //   引っ張られてしまう（FHD のウィンドウ → 低解像度のまま 4K に拡大されてボケる）
> }
> ```
>
> 解像度を上げるほど毎フレームの GPU 負荷（fill rate / VRAM）も増えるので、ライブなマッピングを複数重ねる場合は用途に合わせて解像度を決めてください。

### 3. スケッチをスキャンしてプレビュー生成

```bash
# スケッチをスキャンし、プレビューを生成、ユーザーデータ取得用に既定ブラウザを開く
npm run scan

# すべてのプレビューをリセットして再生成
npm run scan:reset

# 変更を監視して自動更新（メタデータのみ）
npm run scan:watch
```

`npm run scan` は OpenProcessing Public API (`/api/sketch/{id}`, `/api/user/{id}`) から、スケッチタイトル・ユーザー名・ユーザーURLなどを取得します。API token が必要な環境では、OpenProcessing のアカウント設定で token を作成してから `OPENPROCESSING_API_TOKEN` に設定してください。

```bash
OPENPROCESSING_API_TOKEN=your_token npm run scan
```

```json
{
  "title": "Sketch title",
  "description": "Short description",
  "sketchUrl": "https://openprocessing.org/sketch/2326097",
  "tags": ["p5.js", "generative"],
  "interactiveElements": ["マウス"],
  "userData": {
    "userId": "12345",
    "userName": "Author name",
    "userUrl": "https://openprocessing.org/user/12345"
  }
}
```

### 4. 開発サーバー起動

```bash
npm run dev
```

### 5. プロダクションビルド

```bash
npm run build
```

ビルドされたファイルは `dist/` ディレクトリに出力されます。

## CLIコマンド

### `dropcaster init <project-name>`
新しいギャラリープロジェクトを作成。

### `dropcaster fetch <id> [options]`
OpenProcessing の作品 ID 1 個を `sketches/sketch<id>/` に取り込む。既存のローカル sketch と同じ形式（`index.html` + 各タブの `.js` + `assets/`）で書き出すので、`npm run scan` がそのまま処理できる。

オプション:
- `--no-assets` - 外部アセットをダウンロードしない（OP CDN 直参照のまま、オフライン不可）
- `--overwrite` - 既存ディレクトリを置き換える
- `--output <dir>` - sketches ベースディレクトリ (デフォルト: "sketches")
- `-v, --verbose` - 個別ファイルの進捗を表示

### `dropcaster scan [options]`
スケッチをスキャンして `public/sketches/` にコピーし、`public/sketches.json` を生成（デフォルトでプレビュー GIF も生成）。

オプション:
- `--sketch <name>` - 特定のスケッチのみスキャン（`sketches.json` は既存にマージ）
- `--no-previews` - プレビュー GIF を生成しない（メタデータのみ、速い）
- `--force-preview` - プレビュー GIF を強制再生成
- `--reset` - `public/sketches` と `public/previews` を作り直して再生成
- `--fetch-userdata` - OpenProcessing Public API からタイトル・作者などのメタデータを取得
- `-v, --verbose` - 詳細出力を表示

### `dropcaster build [options]`
ギャラリーをプロダクション用にビルド。

オプション:
- `-o, --output <dir>` - 出力ディレクトリ (デフォルト: "dist")
- `-b, --base <path>` - ベースURLパス (デフォルト: "/")

### `dropcaster dev`
開発サーバーを起動。

### `dropcaster doctor`
プレビュー GIF 生成に必要なツール (FFmpeg / Chromium) が揃っているか確認。

## 設定

`dropcaster.config.js`（`dropcaster init` が生成）でギャラリーをカスタマイズ。
主に PWA manifest と `<head>` のメタ情報です。Service Worker はアプリシェル / ローカル sketch / OP API メタ / 外部 CDN / runtime の 5 バケットで自動的にキャッシュします。フルな例は [dropcaster.config.example.js](dropcaster.config.example.js) を参照。

```javascript
export default {
  title: 'My Gallery',                 // ブラウザタブ・PWA 名・manifest の name
  description: 'クリエイティブコーディング作品集',
  theme_color: '#000000',
  background_color: '#ffffff',
  display: 'standalone',               // 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
  start_url: '/',
  // base: '/my-gallery/',             // GitHub Pages のサブパスなど（dropcaster build --base でも可）
}
```

## プロジェクト構造（`dropcaster init` で作る user gallery）

```
my-gallery/
├── sketches/          # OpenProcessingスケッチ（`dropcaster fetch` が書き出す先でもある）
├── public/
│   ├── sketches/      # コピーされたスケッチ
│   ├── previews/      # 生成されたGIFプレビュー
│   └── sketches.json  # メタデータ
├── dist/              # ビルドファイル
├── package.json
└── dropcaster.config.js
```

## リポジトリ構造（このリポジトリ自体、開発者向け）

```
dropcaster/
├── src/
│   ├── viewer/        # viewer 本体 (TS)。user gallery / ホスト版で共有
│   │   ├── runtime/   # SketchFrame, SketchPool（iframe 管理）
│   │   ├── services/  # OpenProcessingSource, sketchService
│   │   ├── components/# UI: ギャラリー, ID 入力, エラー画面
│   │   ├── managers/  # FullscreenManager, CursorManager 等
│   │   ├── windows/   # 出力ウィンドウ・コントロール
│   │   └── pwa/       # Service Worker 登録
│   ├── core/
│   │   └── modules/   # op-api-client, op-sketch-builder, asset-downloader 等（Node/Browser 共用）
│   └── cli/           # CLI (init / dev / build / scan / fetch / doctor)
├── apps/
│   └── web/           # ホスト版 (dropcaster.soui.dev)
│       ├── src/
│       │   └── worker.ts        # Cloudflare Worker (静的配信 + /op-cdn proxy)
│       ├── public/              # 静的アセット (manifest, icon, sw.js)
│       ├── index.html           # __DROPCASTER_CONFIG__ 注入
│       ├── vite.config.ts
│       └── wrangler.toml        # [assets] + SPA fallback
├── public/            # user gallery テンプレ用の静的アセット (sw.js 等)
├── sketches/          # 開発用サンプル sketch
└── .github/workflows/
    └── deploy.yml     # main push → Cloudflare Workers にデプロイ
```

## アーキテクチャ

### Web技術完結型のエコシステム統合
- OpenProcessing等の既存クリエイティブコーディングコミュニティとの連携
- p5.js/WebGL/WebGPU コンテンツを `<iframe>` でホストし、CSS の `matrix3d` で投影マッピング
  （同一オリジンかつ `sandbox` なしの iframe なので**セキュリティ境界ではない**点に注意 — 冒頭の「信頼モデル」を参照）
- コンテンツ作者のコードを改変せずにそのまま利用可能

### ブラウザネイティブなアーキテクチャ
- PWA として配布できる。Service Worker は 5 つのキャッシュバケット (app shell / local sketches / OP API meta / 外部 CDN / runtime) に振り分けて、一度開いた作品はオフラインでも再生可能
- プロジェクションマッピングは `window.open()` + Window Management API でプロジェクタ画面にポップアウト、
  同一オリジンの `window.opener` 参照経由で窓間連携
- `canvas.captureStream()` を共有 `<video>` 群へ bind し、CSS `matrix3d` でワープ（クローンなし）

### ホスト版の構成
- Cloudflare Workers (Static Assets) **1 つ**でアプリ本体 (`apps/web/dist/`) と `/op-cdn/*` proxy を兼任
- `/op-cdn/*` は OpenProcessing CDN (`deckard.openprocessing.org`) への中継。CORS ヘッダを後付けして同一オリジン化することで、`captureStream` が tainted にならないようにしている
- OpenProcessing API (`/api/sketch/*`) は viewer から直接叩く構造。per-IP 40 req/min の制限はユーザ単位なので、利用者が増えても全体で枯れない
- レート制限 (HTTP 429) に当たった場合は countdown UI で自動再試行

## 長時間運用のコツ

プロジェクションマッピングで長時間（イベント・展示・常設）回すときの注意点。

### ブラウザ側で dropcaster が面倒を見るもの
- **Screen Wake Lock** — プロジェクション中はメイン／出力ウィンドウの両方で `navigator.wakeLock.request('screen')` を取り、ディスプレイのスリープ／スクリーンセーバ／システムアイドルを抑止します（不可視に戻ったときの自動再取得もする）。
- **canvas キャプチャの自動復活** — スケッチが内部で `<canvas>` を作り直したり、GPU プロセスがクラッシュして WebGL コンテキストが復帰しなかったりした場合、ソース iframe を自動でリロードして映像を復活させます。
- **2 ウィンドウ構成** — マッピング編集 UI はメインウィンドウ右側のペインとして表示されるので、ラップトップ側に重なるウィンドウは存在しません（Chrome on Windows の occlusion による hidden 判定でメインのスケッチ rAF が止まる事故が、構造的に起きないように設計してあります）。

### 運用者が OS 側でやっておくこと
- **ノート PC のクラムシェル（蓋を閉じて外部プロジェクタのみ）はブラウザでは防げません**。macOS なら「ふたを閉じているときもスリープしない」設定＋AC 電源接続、Windows なら電源プランで「カバーを閉じた時の動作 = 何もしない」、または `caffeinate` / Amphetamine 等で抑止してください。
- スクリーンセーバ／ディスプレイスリープを OS のエネルギー設定で無効にしておくとより確実です。
- **メインウィンドウを最小化しない**。完全に不可視になった場合 `requestAnimationFrame` はブラウザレベルで停止するので、これだけは仕様上どうしようもありません（最小化ボタンを押さない／他アプリで最大化したまま放置しないだけで OK）。
- **PWA としてインストールして起動**するとタブの discard 対象から外れやすく、安定します。

## プレビュー生成

各スケッチのアニメーション GIF プレビューを自動生成（1000×1000px / 3 秒 / 30fps、Playwright + FFmpeg）。
FFmpeg / Chromium が無い環境ではプレビュー生成だけスキップします（`dropcaster doctor` で確認可）。
詳細は [PREVIEW_GENERATION.md](PREVIEW_GENERATION.md) を参照。

## デプロイ

ビルドしたギャラリーは以下の静的ホスティングサービスにデプロイ可能:

- GitHub Pages
- Netlify
- Vercel
- Surge.sh
- AWS S3
- Firebase Hosting

## システム要件

- Node.js 20.19+
- FFmpeg (GIF生成用)
- Chromium (Playwright経由で自動インストール)

## 開発

このリポジトリ自体の開発（CLI のローカルテスト、`dropcaster dev`/`build` の仕組み、配布など）は
[DEVELOPMENT.md](DEVELOPMENT.md) を参照。

## 貢献

Pull Requestを歓迎します！問題や提案がある場合は [Issues](https://github.com/shinyaoguri/dropcaster/issues) にお願いします。

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 Shinya Oguri
