# Sketch Preview Generation

このプロジェクトでは、スケッチのアニメーションプレビューGIFを自動生成する機能を提供しています。

## 技術仕様

- **キャプチャサイズ**: 1000x1000px
- **出力サイズ**: 幅400px
- **録画時間**: 3秒間
- **キャプチャフレームレート**: 30fps
- **生成方法**: Playwright + FFmpeg

## 使用方法

### ローカル環境での実行

1. 依存関係のインストール:
```bash
npm install
```

2. PlaywrightブラウザとFFmpegのインストール:
```bash
# Playwright
npx playwright install chromium

# FFmpeg (macOS)
brew install ffmpeg

# FFmpeg (Ubuntu/Debian)
sudo apt-get install ffmpeg
```

3. プレビュー生成付きでスケッチをスキャン:
```bash
node scripts/scan-sketches.js --generate-previews
```

### GitHub Actions での自動実行

`sketches/` ディレクトリに変更があった場合、自動的にアニメーションプレビューGIFが生成されます。

## 設定オプション

`scripts/modules/config.js` の `PREVIEW_OPTIONS` で設定可能:

```javascript
const PREVIEW_OPTIONS = {
  width: 1000,       // キャプチャの幅 (px) - Canvas全体をキャプチャ
  height: 1000,      // キャプチャの高さ (px)
  duration: 3000,    // 録画時間 (ms)
  fps: 30,          // キャプチャフレームレート
  quality: 80       // GIF品質 (1-100)
};
```

## 生成プロセス

1. **フレーム取得**: Playwrightで1000x1000のスケッチを3秒間連続撮影
2. **一時保存**: フレームを一時ディレクトリにPNG形式で保存
3. **パレット生成**: FFmpegで最適カラーパレット生成
4. **GIF合成**: パレットを使用して高品質なアニメーションGIF作成
5. **クリーンアップ**: 一時ファイルの自動削除

## 出力ファイル

- プレビューGIF: `public/previews/{sketchName}.gif`
- メタデータ: スキャン結果JSONに `previewGif` フィールドが追加

## フォールバック機能

FFmpegが利用できない環境では、自動的に静止画プレビューにフォールバックします。

## システム要件

### ローカル環境
- Node.js 18+
- FFmpeg
- Chromiumブラウザ（Playwright経由）

### GitHub Actions
- ubuntu-latest runner
- FFmpegとPlaywright Chromiumを自動インストール

## トラブルシューティング

### FFmpegエラー
```bash
# FFmpegの確認
ffmpeg -version

# macOSでの再インストール
brew reinstall ffmpeg

# Ubuntuでの再インストール
sudo apt-get update && sudo apt-get install --reinstall ffmpeg
```

### メモリ不足エラー
大量のスケッチがある場合、Node.jsのヒープサイズを増加:
```bash
node --max-old-space-size=4096 scripts/scan-sketches.js --generate-previews
```

### 権限エラー（GitHub Actions）
ワークフローファイルに `--no-sandbox` フラグが設定済みです。
