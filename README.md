# dropcaster

> ⚠️ **Alpha Version**: This project is under active development. APIs may change.

OpenProcessingのクリエイティブコーディングスケッチを静的PWAギャラリーとして生成するツール。ブラウザベースのプロジェクションマッピング機能も実装。

## 特徴

- 🎨 OpenProcessingからスケッチをインポート
- 📱 Progressive Web App (PWA) サポート
- 🖼️ アニメーションプレビューの自動生成
- 🎭 ブラウザベースのプロジェクションマッピング
- 🚀 静的サイト生成
- 📦 簡単なデプロイ

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

OpenProcessingのスケッチを `sketches/` ディレクトリに配置:
```
sketches/
  sketch2257553/
    index.html
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

## 設定

`dropcaster.config.js`（`dropcaster init` が生成）でギャラリーをカスタマイズ。
主に PWA manifest と `<head>` のメタ情報です（凝ったオフライン/キャッシュ設定は廃止 — Service Worker は
「インストール可能にするだけ」の最小構成）。フルな例は [dropcaster.config.example.js](dropcaster.config.example.js) を参照。

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

## プロジェクト構造

```
my-gallery/
├── sketches/          # OpenProcessingスケッチ
├── public/
│   ├── sketches/      # コピーされたスケッチ
│   ├── previews/      # 生成されたGIFプレビュー
│   └── sketches.json  # メタデータ
├── dist/              # ビルドファイル
├── package.json
└── dropcaster.config.js
```

## アーキテクチャ

### Web技術完結型のエコシステム統合
- OpenProcessing等の既存クリエイティブコーディングコミュニティとの連携
- p5.js/WebGL/WebGPUコンテンツをiframeで隔離実行
- コンテンツ作者のコードを改変せずにそのまま利用可能

### ブラウザネイティブなアーキテクチャ
- PWA（インストール可能な最小 manifest）として配布できる
- プロジェクションマッピングは `window.open()` + Window Management API でプロジェクタ画面にポップアウト、
  同一オリジンの `window.opener` 参照経由で窓間連携
- `canvas.captureStream()` を共有 `<video>` 群へ bind し、CSS `matrix3d` でワープ（クローンなし）

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
