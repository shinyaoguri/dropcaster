const labels = {
  ready: ['Venue ready for alignment', '会場の位置合わせを始められます'], loaded: ['Venue loaded', '会場を読み込みました'], updated: ['Venue updated. Align the projected outline with the real surfaces.', '会場を更新しました。投影した輪郭を実物の辺に合わせてください。'],
  title: ['Venue setup', '会場を作る・調整する'], open: ['Venue setup ↗', '会場の作成・調整 ↗'], home: ['Home', 'ホーム'],
  intro: ['Project the model outline onto the real venue. Match dimensions and projector settings, then export the venue for mapping.', 'モデルの輪郭を実際の会場へ投影し、寸法とプロジェクタ設定を合わせます。完成した会場を書き出し、マッピングで読み込みます。'],
  objects: ['Solids', '立体'], projector: ['Projector', 'プロジェクタ'], files: ['Save & load', '保存・読込'], model: ['3D venue', '3D会場'], projection: ['Projected image', '投影される像'],
  pattern: ['Alignment image', '調整用の像'], outline: ['Model outline', 'モデルの輪郭'], grid: ['Grid & crosshair', 'グリッド・十字'], white: ['White', '白'], black: ['Blackout', '黒（ブラックアウト）'],
  resolution: ['Output pixels', '出力解像度'], resolutionHint: ['Match the projector’s native resolution and optical aspect ratio. Window size does not change output pixels.', '実機の解像度と投影アスペクト比を合わせてください。別窓の大きさで出力解像度は変わりません。'],
  openOutput: ['Open projector output', 'プロジェクタ出力を開く'], closeOutput: ['Close output', '出力を閉じる'], outputTitle: ['Venue alignment output', '会場の位置合わせ出力'],
  outputHint: ['Move the output window to the projector display, then use fullscreen. Align the projected edges with the real surfaces. Tune the projector pose and lens settings before fine-tuning the solids.', '出力ウィンドウをプロジェクタ側の画面に移して全画面にし、投影した輪郭を実物の辺に合わせます。まず実機に合わせて投影位置・角度・レンズ条件を調整し、その後で立体を微調整します。'],
  blocked: ['Could not open output. Allow popups and try again.', '出力を開けませんでした。ポップアップを許可して再度お試しください。'],
  saved: ['Venue draft saved in this browser', '会場用の下書きをこのブラウザに保存済み'],
  isolated: ['Venue setup has its own draft. It does not change your sketches or running mappings. To use it, export the venue and load that file in the 3D preview.', '会場用の下書きとして保存します。作品や再生中のマッピングは変更しません。利用時は会場を書き出し、3Dプレビューでそのファイルを読み込んでください。'],
  copyMapping: ['Copy venue from mapping', 'マッピングの会場をコピー'], noMapping: ['No saved mapping venue was found.', '保存されたマッピングの会場がありません。'],
  venueName: ['Venue name', '会場の名前'], load: ['Load venue / project', '会場・プロジェクトを読み込む'],
  previewHint: ['Load a venue to preview your content. Create or align the venue in the separate Venue setup screen.', '会場を読み込んで作品の投影を確認できます。会場の作成・位置合わせは、別画面の「会場の作成・調整」で行います。'],
  previewSettings: ['Preview settings', 'プレビュー設定'], loadPreview: ['Load venue file', '会場ファイルを読み込む'],
  graphicsError: ['3D graphics stopped. Your saved venue is kept; reload this screen to resume. Output has been closed.', '3D描画が停止しました。保存済みの会場は保持しています。この画面を再読み込みして再開してください。出力は閉じました。'],
  reload: ['Reload', '再読み込み'],
} as const;
type Dictionary = { [K in keyof typeof labels as `calibration.${K}`]: string };
export const calibrationEn = Object.fromEntries(Object.entries(labels).map(([key, values]) => [`calibration.${key}`, values[0]])) as Dictionary;
export const calibrationJa = Object.fromEntries(Object.entries(labels).map(([key, values]) => [`calibration.${key}`, values[1]])) as Dictionary;
