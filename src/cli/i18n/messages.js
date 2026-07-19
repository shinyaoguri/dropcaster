// CLI / core 側の翻訳辞書。

const en = {
  // doctor
  'doctor.title': 'dropcaster — environment check',
  'doctor.allGood': 'All dependencies are in place.',
  'doctor.nodeRequired': 'Node.js v{required} or later is required (currently {current}).',
  'doctor.missingPreviewTools': 'Without FFmpeg / Chromium, preview GIFs cannot be generated (equivalent to `dropcaster scan --no-previews`).',
  'doctor.installingChromium': 'Installing Playwright Chromium (needed for preview generation)...',
  'doctor.chromiumAlreadyInstalled': 'Playwright Chromium is already installed.',

  // check-env
  'env.title': 'Environment check',
  'env.titleInit': 'Environment check (required for preview generation)',
  'env.installHint': 'How to install',
  'env.previewNeeded': 'Required for preview GIF generation',
  'env.playwrightMissing': 'playwright not found ({error})',
  'env.playwrightHint': 'Run `npm install`, then `npx playwright install chromium`',
  'env.ffmpegHint.darwin': 'brew install ffmpeg',
  'env.ffmpegHint.win': 'winget install Gyan.FFmpeg  or https://ffmpeg.org/download.html',
  'env.ffmpegHint.linux': 'sudo apt-get install ffmpeg  (Debian/Ubuntu) / sudo dnf install ffmpeg (Fedora) etc.',

  // init
  'init.starting': '🚀 Initializing new dropcaster project...',
  'init.creating': 'Creating project: {name}',
  'init.creatingStructure': 'Creating project structure...',
  'init.created': 'Project created successfully!',
  'init.ready': '✨ Your dropcaster project is ready!',
  'init.nextSteps': 'Next steps:',
  'init.failed': 'Failed to create project',
  'init.missingToolsNote': '  ※ The missing items are only needed for preview GIF generation. You can install them later (re-check with `dropcaster doctor`).',
  'init.prompt.projectName': 'Project name:',
  'init.prompt.galleryTitle': 'Gallery title:',
  'init.prompt.galleryDescription': 'Gallery description:',
  'init.prompt.themeColor': 'Theme color:',

  // dev
  'dev.starting': '🚀 Starting development server...',
  'dev.started': '✨ Development server started',
  'dev.local': '  Local',
  'dev.network': '  Network',
  'dev.failed': 'Failed to start development server',

  // preview
  'preview.starting': '✨ Preview server started',
  'preview.pressCtrlC': 'Press Ctrl+C to stop',
  'preview.failed': 'Failed to start preview server',

  // build
  'build.starting': '🚀 Building for production...',
  'build.completed': '✨ Build completed',
  'build.output': '  Output: {dir}',
  'build.failed': 'Build failed',

  // scan
  'scan.sketchesNotFound': '❌ sketches directory not found: {dir}',
  'scan.hintRunInProjectRoot': '💡 Hint: run this from your dropcaster project root',
  'scan.scanned': '✅ Scanned {count} sketch(es)',
  'scan.previewsGenerated': '   Previews generated: {ok}/{total}',
  'scan.savedTo': '   Saved to: {path}',
  'scan.completed': '✅ Scan completed',
  'scan.failed': '❌ Scan failed (exit code: {code})',
  'scan.startFailed': '❌ Failed to start scan process:',

  // scan-sketches (core)
  'scan.missingPreviewTools': '\n⚠️  Preview GIF generation tools missing; skipping preview generation:',
  'scan.missingPreviewToolsInstall': '     Install: {hint}',
  'scan.continueWithoutPreviews': '   (Metadata scan and sketch copy will continue. Check status with `dropcaster doctor`)\n',
  'scan.resetting': '🧹 --reset: removing and recreating public/sketches and public/previews',
  'scan.newSketchDetected': '🆕 New sketch detected: {name}',
  'scan.previewFailed': 'Warning: failed to generate preview for {name}: {error}',
  'scan.fetchingMetadata': '🔍 Fetching metadata from OpenProcessing Public API... ({count} items)',
  'scan.metadataResult': '   Metadata integration: success {ok} / failure {ng} / total {total}',
  'scan.metadataFetchFailed': '❌ Failed to fetch metadata: {error}',
  'scan.newCount': '📝 {count} new sketch(es): {names}',
  'scan.scannedCount': '📋 Scanned {count} sketch(es) ({withMeta} with metadata)',
  'scan.wroteJson': '💾 Wrote {path}',
  'scan.writeJsonFailed': '❌ Failed to write public/sketches.json: {error}',
  'scan.manualTemplateCreated': '📝 OpenProcessing fetch failed ({reason}). Manual metadata template created: {path}',
  'scan.manualTemplateRename': '   Rename to {file} and fill in values; it will be applied on the next scan',

  // sketch-analyzer
  'sketchAnalyzer.manualMetadataLoaded': '📝 Manual metadata loaded: {path}',

  // postinstall
  'postinstall.chromiumFailed': '⚠️  Failed to install Playwright Chromium.',
  'postinstall.chromiumManual': '   Run `npx playwright install chromium` manually if you need preview generation.',
  'postinstall.chromiumException': '⚠️  Could not run Playwright Chromium install: {error}',
  'postinstall.skipPreviewNote': '  ※ Safe to ignore if you do not generate preview GIFs (use `dropcaster scan --no-previews`).',
  'postinstall.doctorNote': '  ※ Re-check status with `dropcaster doctor`.\n',
  'postinstall.envCheckTitle': 'dropcaster — environment check (missing items)',

  // fetch
  'fetch.invalidId': 'Invalid sketch ID: {id}',
  'fetch.directoryExists': 'Directory already exists: {dir}',
  'fetch.useOverwrite': 'Use --overwrite to replace',
  'fetch.modeNotSupported': 'Mode "{mode}" is not supported (only p5js / html)',
  'fetch.noIndexTab': 'This html-mode sketch has no index.html tab',
  'fetch.tabRenamed': 'Tab "{from}" was written as "{to}" (unsafe or conflicting filename); references in code were updated',
  'fetch.completed': '✅ Fetched: {dir}',
  'fetch.nextSteps': 'Next steps:',
  'fetch.scanHint': '  npm run scan        # update sketches.json (also regenerates preview GIFs)',
  'fetch.devHint': '  npm run dev         # open the gallery in your browser',

  // op-api-client / op-sketch-builder
  'op.rateLimit': 'OpenProcessing API rate limit (Retry-After: {seconds}s)',
};

const ja = {
  'doctor.title': 'dropcaster — 環境チェック',
  'doctor.allGood': 'すべて揃っています。',
  'doctor.nodeRequired': 'Node.js v{required} 以上が必要です（現在 {current}）。',
  'doctor.missingPreviewTools': 'FFmpeg / Chromium が無い場合、プレビュー GIF は生成されません（`dropcaster scan --no-previews` 相当の動作）。',
  'doctor.installingChromium': 'Playwright の Chromium をインストールします（プレビュー生成に必要）...',
  'doctor.chromiumAlreadyInstalled': 'Playwright の Chromium はインストール済みです。',

  'env.title': '環境チェック',
  'env.titleInit': '環境チェック（プレビュー生成に必要）',
  'env.installHint': 'インストール方法',
  'env.previewNeeded': 'プレビュー GIF の生成に必要',
  'env.playwrightMissing': 'playwright が見つかりません ({error})',
  'env.playwrightHint': 'npm install を実行後 npx playwright install chromium',
  'env.ffmpegHint.darwin': 'brew install ffmpeg',
  'env.ffmpegHint.win': 'winget install Gyan.FFmpeg  または https://ffmpeg.org/download.html',
  'env.ffmpegHint.linux': 'sudo apt-get install ffmpeg  (Debian/Ubuntu) / sudo dnf install ffmpeg (Fedora) など',

  'init.starting': '🚀 新規 dropcaster プロジェクトを作成中...',
  'init.creating': 'プロジェクト作成: {name}',
  'init.creatingStructure': 'プロジェクト構造を作成中...',
  'init.created': 'プロジェクトを作成しました!',
  'init.ready': '✨ dropcaster プロジェクトの準備が整いました!',
  'init.nextSteps': '次の手順:',
  'init.failed': 'プロジェクトの作成に失敗しました',
  'init.missingToolsNote': '  ※ 不足分はプレビュー GIF 生成にのみ必要です。後から入れてもOK（`dropcaster doctor` で再確認）。',
  'init.prompt.projectName': 'プロジェクト名:',
  'init.prompt.galleryTitle': 'ギャラリーのタイトル:',
  'init.prompt.galleryDescription': 'ギャラリーの説明:',
  'init.prompt.themeColor': 'テーマカラー:',

  'dev.starting': '🚀 開発サーバーを起動中...',
  'dev.started': '✨ 開発サーバーが起動しました',
  'dev.local': '  Local',
  'dev.network': '  Network',
  'dev.failed': '開発サーバーの起動に失敗しました',

  'preview.starting': '✨ プレビューサーバーが起動しました',
  'preview.pressCtrlC': 'Ctrl+C で停止',
  'preview.failed': 'プレビューサーバーの起動に失敗しました',

  'build.starting': '🚀 本番ビルドを実行中...',
  'build.completed': '✨ ビルドが完了しました',
  'build.output': '  出力先: {dir}',
  'build.failed': 'ビルドに失敗しました',

  'scan.sketchesNotFound': '❌ sketchesディレクトリが見つかりません: {dir}',
  'scan.hintRunInProjectRoot': '💡 ヒント: dropcasterプロジェクトのルートディレクトリで実行してください',
  'scan.scanned': '✅ {count}個のスケッチをスキャンしました',
  'scan.previewsGenerated': '   プレビュー生成済み: {ok}/{total}',
  'scan.savedTo': '   保存先: {path}',
  'scan.completed': '✅ スキャンが完了しました',
  'scan.failed': '❌ スキャンに失敗しました (exit code: {code})',
  'scan.startFailed': '❌ スキャンプロセスの起動に失敗しました:',

  'scan.missingPreviewTools': '\n⚠️  プレビュー GIF の生成に必要なツールが見つからないため、プレビュー生成をスキップします:',
  'scan.missingPreviewToolsInstall': '     インストール方法: {hint}',
  'scan.continueWithoutPreviews': '   （メタデータのスキャンとスケッチのコピーは続行します。状態は `dropcaster doctor` で確認できます）\n',
  'scan.resetting': '🧹 --reset: public/sketches と public/previews を削除して作り直します',
  'scan.newSketchDetected': '🆕 新しいスケッチを検出: {name}',
  'scan.previewFailed': 'Warning: {name} のプレビュー生成に失敗: {error}',
  'scan.fetchingMetadata': '🔍 OpenProcessing Public API からメタデータを取得中... ({count}件)',
  'scan.metadataResult': '   メタデータ統合: 成功 {ok} / 失敗 {ng} / 合計 {total}',
  'scan.metadataFetchFailed': '❌ メタデータの取得に失敗しました: {error}',
  'scan.newCount': '📝 新規スケッチ {count} 件: {names}',
  'scan.scannedCount': '📋 {count} 個のスケッチをスキャン（うち {withMeta} 件にメタデータ）',
  'scan.wroteJson': '💾 {path} を生成',
  'scan.writeJsonFailed': '❌ public/sketches.json の書き込みに失敗: {error}',
  'scan.manualTemplateCreated': '📝 OpenProcessing 取得失敗（{reason}）。手動メタデータ雛形を作成: {path}',
  'scan.manualTemplateRename': '   {file} にリネームして値を埋めると次回 scan で反映されます',

  'sketchAnalyzer.manualMetadataLoaded': '📝 手動メタデータを読み込み: {path}',

  'postinstall.chromiumFailed': '⚠️  Playwright の Chromium インストールに失敗しました。',
  'postinstall.chromiumManual': '   プレビュー生成を使う場合は手動で `npx playwright install chromium` を実行してください。',
  'postinstall.chromiumException': '⚠️  Playwright の Chromium インストールを実行できませんでした: {error}',
  'postinstall.skipPreviewNote': '  ※ プレビュー GIF を生成しない使い方なら無視して構いません（dropcaster scan --no-previews）。',
  'postinstall.doctorNote': '  ※ 状態を再確認するには `dropcaster doctor` を実行してください。\n',
  'postinstall.envCheckTitle': 'dropcaster — 環境チェック（不足分）',

  'fetch.invalidId': '不正なスケッチ ID: {id}',
  'fetch.directoryExists': 'ディレクトリが既に存在します: {dir}',
  'fetch.useOverwrite': '--overwrite で上書きできます',
  'fetch.modeNotSupported': 'モード "{mode}" は未対応です (p5js / html のみ)',
  'fetch.noIndexTab': 'この html モード作品には index.html タブがありません',
  'fetch.tabRenamed': 'タブ "{from}" は "{to}" として書き出しました (ファイル名として不正または重複のため)。コード中の参照も更新済みです',
  'fetch.completed': '✅ 取得しました: {dir}',
  'fetch.nextSteps': '次の手順:',
  'fetch.scanHint': '  npm run scan        # sketches.json を更新 (プレビュー GIF も生成)',
  'fetch.devHint': '  npm run dev         # ブラウザでギャラリーを開いて確認',

  'op.rateLimit': 'OpenProcessing API のレート制限 (Retry-After: {seconds}秒)',
};

export const messages = { en, ja };
