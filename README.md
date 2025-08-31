# dropcaster

> ⚠️ **Alpha Version**: This project is under active development. APIs may change.

A static PWA generator for creative coding sketches from OpenProcessing.

## Features

- 🎨 Import sketches from OpenProcessing
- 📱 Progressive Web App (PWA) support
- 🖼️ Automatic preview generation
- 👤 User information fetching
- 🚀 Static site generation
- 📦 Easy deployment

## Installation

```bash
npm install -g @dropcaster/viewer
```

## Quick Start

### 1. Create a new gallery

```bash
dropcaster init my-gallery
cd my-gallery
```

### 2. Add sketches

Place your OpenProcessing sketches in the `sketches/` directory:
```
sketches/
  sketch2257553/
    index.html
  sketch2326097/
    index.html
```

### 3. Scan and generate previews

```bash
# Scan sketches and generate metadata
npm run scan

# Generate previews and fetch user data
npm run scan:full

# Reset and regenerate all previews
npm run scan:reset
```

### 4. Development

```bash
npm run dev
```

### 5. Build for production

```bash
npm run build
```

The built files will be in the `dist/` directory, ready for deployment.

## CLI Commands

### `dropcaster init <project-name>`
Create a new gallery project.

### `dropcaster scan [options]`
Scan sketches and generate metadata.

Options:
- `--sketch <name>` - Scan specific sketch only
- `--force-preview` - Force regenerate preview images
- `--reset` - Reset and regenerate all previews
- `--fetch-userdata` - Fetch user data from OpenProcessing
- `-v, --verbose` - Show detailed output

### `dropcaster build [options]`
Build the gallery for production.

Options:
- `-o, --output <dir>` - Output directory (default: "dist")
- `-b, --base <path>` - Base URL path (default: "/")

### `dropcaster dev`
Start development server.

## Configuration

Edit `dropcaster.config.json` to customize your gallery:

```json
{
  "title": "My Gallery",
  "description": "A collection of creative coding sketches",
  "theme_color": "#000000",
  "background_color": "#000000",
  "display": "standalone",
  "orientation": "portrait",
  "categories": ["generative", "interactive", "3D", "audio"]
}
```

## Project Structure

```
my-gallery/
├── sketches/          # OpenProcessing sketches
├── public/
│   ├── sketches/      # Copied sketches
│   ├── previews/      # Generated GIF previews
│   ├── avatars/       # User avatars
│   └── sketches.json  # Metadata
├── dist/              # Built files
├── package.json
└── dropcaster.config.json
```

## Deployment

The built gallery can be deployed to any static hosting service:

- GitHub Pages
- Netlify
- Vercel
- Surge.sh
- AWS S3
- Firebase Hosting

## Requirements

- Node.js 18+
- FFmpeg (for GIF generation)

## License

MIT

## Author

Your Name

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
ブラウザベースのプロジェクションマッピングツール

# Web技術完結型のエコシステム統合
既存のクリエイティブコーディングコミュニティ（OpenProcessing等）との連携．
p5.js/WebGL/WebGPUコンテンツをiframeで隔離実行し、安全に取り込む
コンテンツ作者のコードを改変せずに、そのまま利用可能にする仕組み

# ブラウザネイティブなアーキテクチャ
PWAの特性を活かした、インストール不要な本格的マッピングツール
WebRTC DataChannelやBroadcastChannelAPIを使った低遅延な窓間通信
オフライン動作とクラウド同期のハイブリッド運用
スケッチページに対して，操作用の2つのウィンドウ（ソースウィンドウ，マッピングウィンドウ）を動的に生成し，可能な限り効率的にコンテンツを同期するためにMediaStream APIでcaptureStream()を用いる．

# 全体アーキテクチャ
- レイヤードアーキテクチャ（層分離）
- MVC（Model-View-Controller）の変形
- ドメイン駆動設計（DDD）の要素
- イベント駆動アーキテクチャ