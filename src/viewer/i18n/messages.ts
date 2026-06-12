// viewer (ブラウザ) の翻訳辞書。
// 新キーを追加するときは ja / en の両方に揃えること（fallback は en）。

const en = {
  // 言語切替
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.ja': '日本語',
  'lang.toggle.title': 'Switch language',

  // OP ID 入力 (Hero / Inline)
  'op.hero.subtitle': 'Load an <a href="https://openprocessing.org/" target="_blank" rel="noopener noreferrer" class="op-hero-link">OpenProcessing</a> sketch for projection mapping.',
  'op.label': 'Sketch ID or URL',
  'op.placeholder.hero': 'e.g. 2257553 / https://openprocessing.org/@username/2257553',
  'op.placeholder.inline': 'OpenProcessing sketch ID / URL',
  'op.submit.hero': 'Load',
  'op.submit.inline': 'Open',
  'op.error.invalid': 'Enter a valid sketch ID or an OpenProcessing URL.',
  // assetProxyBaseUrl 設定済み（ホスト版など）: アセットは proxy 経由で読めるのでその旨を伝える
  'op.hero.footer': 'p5js sketches are supported, including ones that use assets (images, sounds) uploaded to OpenProcessing.',
  // assetProxyBaseUrl 未設定: アセット付き作品は読み込めない可能性があることを伝える
  'op.hero.footer.noProxy': 'p5js sketches are supported. Sketches that use uploaded assets (images, sounds) may fail to load because no asset proxy is configured.',
  'op.hero.help.label': 'About sketches that cannot be loaded',
  // ツールチップは <p> 内に入るのでインライン要素 (<strong>/<br>) のみ使う
  'op.hero.help.cases':
    '<strong>Sketches that may not load or run correctly:</strong><br>' +
    '・Non-p5js engine modes (Processing(Java), applets, etc.)<br>' +
    '・Sketches loading assets directly from sites outside OpenProcessing (unless that site allows CORS)<br>' +
    '・Sketches that build asset URLs dynamically in code<br>' +
    '・Private or deleted sketches',
  'op.hero.help.cases.noProxy':
    '<strong>Sketches that may not load or run correctly:</strong><br>' +
    '・Sketches using uploaded assets in general (no asset proxy configured)<br>' +
    '・Non-p5js engine modes (Processing(Java), applets, etc.)<br>' +
    '・Sketches loading assets directly from sites outside OpenProcessing (unless that site allows CORS)<br>' +
    '・Private or deleted sketches',

  // ギャラリー
  'gallery.title': 'Sketch Gallery',
  'gallery.slideshow': 'Slideshow',
  'gallery.card.view': 'View →',
  'gallery.card.by': 'by',
  'gallery.card.viewOriginal': 'View original on OpenProcessing',
  'gallery.card.unknownUser': 'Unknown User',

  // 404
  'error404.title': '404',
  'error404.message': 'Sketch not found',
  'error404.backLink': 'Back to gallery',

  // スケッチエラー
  'sketchError.rateLimit.title': 'Rate limit reached',
  'sketchError.rateLimit.message':
    'You have hit the OpenProcessing API rate limit (40 requests/min for anonymous use).',
  'sketchError.rateLimit.countdown': 'Retrying automatically in {sec} seconds',
  'sketchError.rateLimit.retryNow': 'Retry now',
  'sketchError.unsupported.title': 'Unsupported engine',
  'sketchError.unsupported.message':
    'dropcaster does not yet support this sketch engine{modeNote}. Only <strong>p5js</strong> sketches can be displayed.',
  'sketchError.unsupported.modeNote': ' (detected: <code>{mode}</code>)',
  'sketchError.unsupported.openOnOp': 'Open on OpenProcessing',
  'sketchError.notFound.title': 'Could not load sketch',
  'sketchError.notFound.message':
    'Failed to fetch the sketch from OpenProcessing. The ID may be wrong, or the sketch may have been deleted or made private.',
  'sketchError.notFound.tryOnOp': 'Try opening on OpenProcessing',
  'sketchError.home': 'Back to home',

  // スライドショー
  'slideshow.unit.sec': 's',
  'slideshow.prev': 'Previous',
  'slideshow.next': 'Next',
  'slideshow.pause': 'Pause',
  'slideshow.play': 'Play',
  'slideshow.fullscreen': 'Fullscreen',
  'slideshow.mapping': 'Projection mapping',
  'slideshow.empty.title': 'No sketches available',
  'slideshow.empty.message': 'No sketches were found to display.',
  'slideshow.empty.back': 'Back to gallery',
  'slideshow.author.by': 'by',
  'slideshow.author.anonymous': 'Anonymous',

  // スケッチページ
  'sketchPage.fullscreen': 'Fullscreen',
  'sketchPage.openWindows': 'Open windows',
  'sketchPage.fullscreenFailed': 'Failed to enter fullscreen',

  // ウィンドウ管理
  'window.createFailed': 'WindowManager: failed to create "{title}" (popup may be blocked)',
  'window.projectionOutput': 'Projection output',
  'window.controlPanel': 'Control panel',

  // 出力ウィンドウ
  'output.fullscreen': 'Fullscreen (F / F11)',
  'output.hint': 'Double-click or F for fullscreen / Esc to exit',

  // コントロールパネル: 共通バナー
  'control.banner.webglLost':
    'WebGL context lost (e.g. GPU process crash).<br>The source will reload automatically if it does not recover within 2 seconds.',

  // コントロールパネル: カラムヘッダ
  'control.column.tool': 'Tools',
  'control.column.source': 'Source selection',
  'control.tab.mapping': 'Mapping',
  'control.tab.layout': 'Output layout',
  'control.tabstrip.label': 'Mapping column view switcher',

  // ツール: 出力ウィンドウセクション
  'control.outputs.title': 'Output windows',
  'control.outputs.add': '+ Add output',

  // ツール: マッピング
  'control.mappings.title': 'Mappings',
  'control.mappings.add': '+ Add mapping',
  'control.mappings.addMask': '+ Add mask',
  'control.mappings.reorderHint': 'Drag a row to change order (top = front-most)',

  // ツール: 出力設定
  'control.outputSettings.title': 'Output settings',
  'control.outputSettings.hint': 'Edit the position and size of the active output (virtual canvas px)',
  'control.outputSettings.target': 'Target:',
  'control.label.x': 'X:',
  'control.label.y': 'Y:',
  'control.label.w': 'W:',
  'control.label.h': 'H:',

  // ツール: ソース設定
  'control.sourceSettings.title': 'Source settings',
  'control.sourceSettings.hint':
    'Click a corner to select → use arrow keys to nudge (Shift+arrow for 10px)',
  'control.sourceSettings.selection': 'Selection',
  'control.reset': 'Reset',

  // ツール: テストパターン
  'control.testPattern.title': 'Test pattern',
  'control.testPattern.hint': 'Temporarily replace the source video for projector calibration',
  'control.testPattern.off': 'Off',
  'control.testPattern.white': 'White',
  'control.testPattern.grid': 'Grid',
  'control.testPattern.smpte': 'Color bars',

  // ツール: 開発モード
  'control.devMode.title': 'Dev mode',
  'control.devMode.hint':
    'Overlay each mapping outline and a mouse-tracking crosshair (laser leveler style) on the output window',
  'control.devMode.on': 'ON',
  'control.devMode.off': 'OFF',

  // ツール: マッピング設定
  'control.mappingSettings.title': 'Mapping settings',
  'control.mappingSettings.hint':
    'Click a corner handle to select → use arrow keys to nudge (Shift+arrow for 10px)',
  'control.mappingSettings.corners': '4 corners (% / homography)',

  // ツール: 設定 IO
  'control.io.title': 'Save / Load settings',
  'control.io.hint':
    'Export or import all settings (output layout, mapping, source selection) as a JSON file. Loading overwrites the current settings.',
  'control.io.export': 'Save',
  'control.io.import': 'Load',

  // コントロール: リサイザ
  'control.resizer.tool': 'Drag to change the tool column width',
  'control.resizer.source': 'Drag to change the source / mapping column ratio',

  // コントロール: ソース video placeholder
  'control.source.loading': 'Loading MediaStream…',

  // MappingsListPanel
  'mappingsList.name.title': 'Output name (click to select / double-click to edit)',
  'mappingsList.open': 'Open',
  'mappingsList.close': 'Close',
  'mappingsList.open.title': 'Pop out this output',
  'mappingsList.close.title': 'Close this output window',
  'mappingsList.remove': 'Remove',
  'mappingsList.remove.output.title': 'Remove this output',
  'mappingsList.remove.output.disabled': 'Cannot remove the last remaining output',
  'mappingsList.enabled.title': 'Outputting (click to stop)',
  'mappingsList.disabled.title': 'Stopped (click to output)',
  'mappingsList.import.invalid': 'Failed to load (invalid format)',
  'mappingsList.import.parseError': 'Failed to load (JSON parse error)',
  'mappingsList.maskKind': 'mask',
  'mappingsList.drag.title': 'Drag to reorder (top = front-most)',
  'mappingsList.locked.title': 'Locked while drawing the active mask (press Enter to finish, Esc to cancel)',

  // OutputVizPanel
  'outputViz.size.unstartedTitle': 'Expected resolution (output window not started)',
  'outputViz.mode.unstarted': 'Not started',
  'outputViz.mode.fullscreen': 'Fullscreen',
  'outputViz.mode.windowed': 'Windowed',
  'outputViz.display.internalSuffix': ' (built-in)',
  'outputViz.display.internalLabel': '(built-in display)',
  'outputViz.display.externalLabel': '(external display)',
  'outputViz.display.sizeOnly': 'Display size {size}',

  // LayoutPanel
  'layout.hint':
    'Drag to place output windows / resize from the bottom-right corner. The virtual canvas auto-expands to the smallest rect containing all outputs.',

  // MappingAreaPanel
  'mappingArea.scale.title': 'Uniformly scale (keep shape)',
  'mappingArea.rotate.title': 'Rotate (keep shape)',

  // MaskEditPanel
  'maskEdit.vertex.title': 'Drag to move vertex / Alt+click or right-click to remove',
  'maskEdit.edge.title': 'Click to insert a vertex on this edge',
  'maskEdit.translate.title': 'Drag to move the whole mask',
  'maskEdit.pen.hint': 'Click to plot vertices · Click the first vertex or press Enter to close · Backspace removes the last · Esc cancels',

  // フッタ (共通)
  'footer.copyright': '© {year} Shinya Oguri',
  'footer.license': 'MIT License',
  'footer.github': 'GitHub',

  // PWA / wakeLock 等の暗黙メッセージ
  'wakeLock.notSupported': 'Screen Wake Lock is not supported',
  'wakeLock.acquireFailed': 'Failed to acquire Wake Lock',
} as const;

const ja: Record<keyof typeof en, string> = {
  'lang.label': '言語',
  'lang.en': 'English',
  'lang.ja': '日本語',
  'lang.toggle.title': '言語を切り替える',

  'op.hero.subtitle': '<a href="https://openprocessing.org/" target="_blank" rel="noopener noreferrer" class="op-hero-link">OpenProcessing</a> の作品を投影マッピング用に読み込みます。',
  'op.label': '作品 ID または URL',
  'op.placeholder.hero': '例: 2257553 / https://openprocessing.org/@username/2257553',
  'op.placeholder.inline': 'OpenProcessing 作品 ID / URL',
  'op.submit.hero': '読み込み',
  'op.submit.inline': '開く',
  'op.error.invalid': '有効な作品 ID または OpenProcessing の URL を入力してください。',
  'op.hero.footer': 'p5js モードの作品に対応しています。OpenProcessing にアップロードされたアセット（画像・音声など）を使う作品もそのまま読み込めます。',
  'op.hero.footer.noProxy': 'p5js モードの作品に対応しています。アセット（画像・音声など）を使う作品は、asset proxy が未設定のため読み込めない場合があります。',
  'op.hero.help.label': '読み込めない作品について',
  'op.hero.help.cases':
    '<strong>読み込めない・正しく動かない場合:</strong><br>' +
    '・p5js 以外のモードの作品（Processing(Java) など）<br>' +
    '・OpenProcessing 外のサイトから直接アセットを読む作品（読み込み先が CORS を許可していない場合）<br>' +
    '・コード内で URL を動的に組み立ててアセットを読む作品<br>' +
    '・非公開・削除済みの作品',
  'op.hero.help.cases.noProxy':
    '<strong>読み込めない・正しく動かない場合:</strong><br>' +
    '・アップロードされたアセットを使う作品全般（asset proxy 未設定のため）<br>' +
    '・p5js 以外のモードの作品（Processing(Java) など）<br>' +
    '・OpenProcessing 外のサイトから直接アセットを読む作品（読み込み先が CORS を許可していない場合）<br>' +
    '・非公開・削除済みの作品',

  'gallery.title': 'スケッチギャラリー',
  'gallery.slideshow': 'スライドショー',
  'gallery.card.view': '表示 →',
  'gallery.card.by': 'by',
  'gallery.card.viewOriginal': 'OpenProcessing で原作を見る',
  'gallery.card.unknownUser': 'Unknown User',

  'error404.title': '404',
  'error404.message': 'スケッチが見つかりませんでした',
  'error404.backLink': 'ギャラリーに戻る',

  'sketchError.rateLimit.title': 'レート制限',
  'sketchError.rateLimit.message':
    'OpenProcessing API の 1 分あたりリクエスト上限 (匿名利用で 40 req/min) に当たりました。',
  'sketchError.rateLimit.countdown': '{sec} 秒後に自動で再試行します',
  'sketchError.rateLimit.retryNow': '今すぐ再試行',
  'sketchError.unsupported.title': '未対応のエンジン',
  'sketchError.unsupported.message':
    'この作品のエンジンには dropcaster がまだ対応していません{modeNote}。現在は <strong>p5js</strong> モードの作品のみ表示できます。',
  'sketchError.unsupported.modeNote': '（検出: <code>{mode}</code>）',
  'sketchError.unsupported.openOnOp': 'OpenProcessing で開く',
  'sketchError.notFound.title': 'スケッチが読み込めませんでした',
  'sketchError.notFound.message':
    'OpenProcessing から作品を取得できませんでした。ID が間違っているか、作品が削除・非公開になっている可能性があります。',
  'sketchError.notFound.tryOnOp': 'OpenProcessing で開いてみる',
  'sketchError.home': 'ホームに戻る',

  'slideshow.unit.sec': '秒',
  'slideshow.prev': '前へ',
  'slideshow.next': '次へ',
  'slideshow.pause': '一時停止',
  'slideshow.play': '再生',
  'slideshow.fullscreen': 'フルスクリーン',
  'slideshow.mapping': 'プロジェクションマッピング',
  'slideshow.empty.title': 'スケッチがありません',
  'slideshow.empty.message': '表示できるスケッチが見つかりませんでした',
  'slideshow.empty.back': 'ギャラリーに戻る',
  'slideshow.author.by': 'by',
  'slideshow.author.anonymous': 'Anonymous',

  'sketchPage.fullscreen': 'フルスクリーン',
  'sketchPage.openWindows': 'ウィンドウを開く',
  'sketchPage.fullscreenFailed': 'フルスクリーン化に失敗しました',

  'window.createFailed': 'WindowManager: "{title}" の作成に失敗（ポップアップがブロックされた可能性があります）',
  'window.projectionOutput': 'プロジェクション出力',
  'window.controlPanel': '統合操作ウィンドウ',

  'output.fullscreen': '全画面 (F / F11 でも可)',
  'output.hint': 'ダブルクリックまたは F で全画面 / Esc で解除',

  'control.banner.webglLost':
    'WebGL コンテキストが失われました（GPU プロセスのクラッシュ等）。<br>2 秒以内に復帰しなければソースを自動リロードします。',

  'control.column.tool': 'ツール',
  'control.column.source': 'ソース選択',
  'control.tab.mapping': 'マッピング',
  'control.tab.layout': '出力レイアウト',
  'control.tabstrip.label': 'マッピングカラムのビュー切替',

  'control.outputs.title': '出力ウィンドウ',
  'control.outputs.add': '＋ 出力を追加',

  'control.mappings.title': 'マッピング',
  'control.mappings.add': '＋ マッピングを追加',
  'control.mappings.addMask': '＋ マスクを追加',
  'control.mappings.reorderHint': '行をドラッグで並び順を変更（一番上 = 最前面）',

  'control.outputSettings.title': '出力設定',
  'control.outputSettings.hint': 'アクティブな出力の位置とサイズを数値で編集（仮想キャンバス px）',
  'control.outputSettings.target': '対象:',
  'control.label.x': 'X:',
  'control.label.y': 'Y:',
  'control.label.w': '幅:',
  'control.label.h': '高さ:',

  'control.sourceSettings.title': 'ソース設定',
  'control.sourceSettings.hint': '枠をクリックで選択 → 矢印キーで微調整（Shift+矢印で10px）',
  'control.sourceSettings.selection': '選択領域',
  'control.reset': 'リセット',

  'control.testPattern.title': 'テストパターン',
  'control.testPattern.hint': 'プロジェクションの校正用にソース映像を一時的に差し替えます',
  'control.testPattern.off': '通常',
  'control.testPattern.white': '白',
  'control.testPattern.grid': 'グリッド',
  'control.testPattern.smpte': 'カラーバー',

  'control.devMode.title': '開発モード',
  'control.devMode.hint':
    '出力ウィンドウに各 mapping の枠線とマウス追従クロスヘア（レーザー墨出し器風）を重ねます',
  'control.devMode.on': 'ON',
  'control.devMode.off': 'OFF',

  'control.mappingSettings.title': 'マッピング設定',
  'control.mappingSettings.hint': '隅のハンドルをクリックで選択 → 矢印キーで微調整（Shift+矢印で10px）',
  'control.mappingSettings.corners': '4隅 (% / ホモグラフィー)',

  'control.io.title': '設定の保存と読み込み',
  'control.io.hint':
    '出力レイアウト・マッピング・ソース選択を含む全設定を JSON ファイルで書き出し／読み込みできます。読み込むと現在の設定は上書きされます。',
  'control.io.export': '保存',
  'control.io.import': '読み込み',

  'control.resizer.tool': 'ドラッグでツールカラムの幅を変更',
  'control.resizer.source': 'ドラッグでソース／マッピング欄の比率を変更',

  'control.source.loading': 'MediaStreamの読み込み中...',

  'mappingsList.name.title': '出力名（クリックで選択 / ダブルクリックで編集）',
  'mappingsList.open': '開く',
  'mappingsList.close': '閉じる',
  'mappingsList.open.title': 'この出力をポップアウトで開く',
  'mappingsList.close.title': 'この出力ウィンドウを閉じる',
  'mappingsList.remove': '削除',
  'mappingsList.remove.output.title': 'この出力を削除',
  'mappingsList.remove.output.disabled': '最後の出力は削除できません',
  'mappingsList.enabled.title': '出力中（クリックで停止）',
  'mappingsList.disabled.title': '停止中（クリックで出力）',
  'mappingsList.import.invalid': '読み込みに失敗しました（フォーマット不正）',
  'mappingsList.import.parseError': '読み込みに失敗しました（JSON 解析失敗）',
  'mappingsList.maskKind': 'マスク',
  'mappingsList.drag.title': 'ドラッグで並び替え（一番上 = 最前面）',
  'mappingsList.locked.title': 'マスク描画中はロック中（Enter で確定 / Esc で取消）',

  'outputViz.size.unstartedTitle': '想定解像度（出力ウィンドウ未起動）',
  'outputViz.mode.unstarted': '未起動',
  'outputViz.mode.fullscreen': 'フルスクリーン',
  'outputViz.mode.windowed': 'ウィンドウ',
  'outputViz.display.internalSuffix': '（内蔵）',
  'outputViz.display.internalLabel': '（内蔵ディスプレイ）',
  'outputViz.display.externalLabel': '（外部ディスプレイ）',
  'outputViz.display.sizeOnly': 'ディスプレイサイズ {size}',

  'layout.hint':
    '出力ウィンドウをドラッグで配置／右下角でリサイズ。仮想キャンバスのサイズは全出力を包含する最小矩形に自動拡張されます。',

  'mappingArea.scale.title': '全体を拡大縮小（形は維持）',
  'mappingArea.rotate.title': '全体を回転（形は維持）',

  'maskEdit.vertex.title': '頂点をドラッグで移動 / Alt+クリック or 右クリックで削除',
  'maskEdit.edge.title': 'クリックでこの辺に頂点を追加',
  'maskEdit.translate.title': 'ドラッグでマスク全体を移動',
  'maskEdit.pen.hint': 'クリックで頂点を追加 ・ 最初の頂点をクリック or Enter で閉じる ・ Backspace で 1 つ戻る ・ Esc でキャンセル',

  'footer.copyright': '© {year} Shinya Oguri',
  'footer.license': 'MIT License',
  'footer.github': 'GitHub',

  'wakeLock.notSupported': 'Screen Wake Lock がサポートされていません',
  'wakeLock.acquireFailed': 'Wake Lock の取得に失敗しました',
};

export type MessageKey = keyof typeof en;
export const messages = { en, ja } as const;
