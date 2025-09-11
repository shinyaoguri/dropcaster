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

# または特定のブランチから
npm install -g github:shinyaoguri/dropcaster#branch-name

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

### 3. スケッチをスキャンしてプレビュー生成

```bash
# スケッチをスキャンしてメタデータ生成
npm run scan

# プレビューとユーザーデータを生成
npm run scan:full

# すべてのプレビューをリセットして再生成
npm run scan:reset

# 変更を監視して自動更新
npm run scan:watch
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
スケッチをスキャンしてメタデータを生成。

オプション:
- `--sketch <name>` - 特定のスケッチのみスキャン
- `--force-preview` - プレビュー画像を強制再生成
- `--reset` - すべてのプレビューをリセットして再生成
- `--fetch-userdata` - OpenProcessingからユーザーデータを取得
- `-v, --verbose` - 詳細出力を表示

### `dropcaster build [options]`
ギャラリーをプロダクション用にビルド。

オプション:
- `-o, --output <dir>` - 出力ディレクトリ (デフォルト: "dist")
- `-b, --base <path>` - ベースURLパス (デフォルト: "/")

### `dropcaster dev`
開発サーバーを起動。

## 設定

`dropcaster.config.js` でギャラリーをカスタマイズ:

```javascript
export default {
  title: 'My Gallery',
  description: 'クリエイティブコーディング作品集',
  theme_color: '#000000',
  background_color: '#000000',
  display: 'standalone',
  orientation: 'portrait',
  categories: ['generative', 'interactive', '3D', 'audio']
}
```

## プロジェクト構造

```
my-gallery/
├── sketches/          # OpenProcessingスケッチ
├── public/
│   ├── sketches/      # コピーされたスケッチ
│   ├── previews/      # 生成されたGIFプレビュー
│   ├── avatars/       # ユーザーアバター
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
- PWAの特性を活かしたインストール不要なマッピングツール
- WebRTC DataChannelやBroadcastChannelAPIを使った低遅延な窓間通信
- オフライン動作とクラウド同期のハイブリッド運用
- MediaStream APIのcaptureStream()を用いた効率的なコンテンツ同期

## プレビュー生成

アニメーションGIFプレビューの自動生成:
- **サイズ**: 800x800px
- **録画時間**: 3秒間
- **フレームレート**: 10fps
- **生成方法**: Playwright + FFmpeg

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

- Node.js 18+
- FFmpeg (GIF生成用)
- Chromium (Playwright経由で自動インストール)

## 開発

### ローカルテスト

```bash
# ローカルでパッケージをリンク
npm link

# 別ディレクトリでテスト
mkdir test-project
cd test-project
npm link dropcaster
```

### GitHubからテスト

```bash
# 特定のブランチから実行
npx github:yourusername/dropcaster#feature-branch init test-gallery
```

詳細は [DEVELOPMENT.md](DEVELOPMENT.md) を参照。

## 貢献

Pull Requestを歓迎します！問題や提案がある場合は [Issues](https://github.com/yourusername/dropcaster/issues) にお願いします。