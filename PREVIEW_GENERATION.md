# プレビュー GIF の生成

各スケッチのアニメーションプレビュー GIF を自動生成する仕組みです。

## 技術仕様

- **キャプチャ**: 1000×1000px / 3 秒 / 30fps
- **生成方法**: Playwright (Chromium) でフレーム撮影 → FFmpeg でパレット最適化 GIF 合成
- **出力**: `public/previews/{sketchName}.gif`（`public/sketches.json` の各エントリに `previewGif` フィールドが追加される）

設定は `src/core/modules/config.js` の `PREVIEW_OPTIONS`（`width` / `height` / `duration` / `fps` /
`quality` / `maxColors` / `scaleFilter`）で変更できます。

## 必要なツール

```bash
npx playwright install chromium   # Chromium（`dropcaster doctor --install` でも可。`npm install` では自動 DL されない）
brew install ffmpeg               # macOS
sudo apt-get install -y ffmpeg    # Ubuntu/Debian
```

`dropcaster doctor` で FFmpeg / Chromium / Node の有無をまとめて確認できます。
プレビュー生成に必要なツールが無い場合は、スキャン自体は続行し、プレビュー生成だけスキップします。
（FFmpeg が無い等で GIF 化できないときは静止画プレビューにフォールバックします。）

## 実行

```bash
# ギャラリープロジェクト側:
dropcaster scan                 # スキャン＋プレビュー生成（デフォルト）
dropcaster scan --no-previews   # メタデータのみ（速い）
dropcaster scan --force-preview # 最新でも GIF を作り直す
dropcaster scan:reset           # public/sketches と public/previews を作り直す

# このリポジトリ自体での確認:
node src/core/scan-sketches.js --generate-previews --write-file
```

> 注: このリポジトリには CI でのプレビュー自動生成ワークフローは置いていません
> （生成物はギャラリー作者が手元で生成してコミットする方針）。

## 生成プロセス

1. Playwright でスケッチを開き、1000×1000 のフレームを連続撮影
2. フレームを一時ディレクトリへ PNG で保存
3. FFmpeg で最適カラーパレットを生成
4. パレットを使って GIF を合成
5. 一時ファイルを削除

## トラブルシューティング

- **FFmpeg エラー**: `ffmpeg -version` で確認。macOS は `brew reinstall ffmpeg`、Ubuntu は
  `sudo apt-get install --reinstall ffmpeg`。
- **メモリ不足**: スケッチが大量にある場合は `node --max-old-space-size=4096 src/core/scan-sketches.js --generate-previews --write-file`。
- **Chromium / sandbox 関連**: Playwright の起動引数（`--no-sandbox` 等）は `src/core/modules/webgpu-detector.js`
  の `getBrowserArgs()` で設定しています。
