#!/usr/bin/env node
// npm install 後に実行される:
//   1. DROPCASTER_INSTALL_BROWSER=1 のときだけ Playwright の Chromium をダウンロード
//      （プレビュー GIF 生成に必要。デフォルトでは行わない —
//        依存に入れた利用者全員の npm install / CI で ~150MB のダウンロードが
//        走るのを避けるため。後から `dropcaster doctor --install` で導入できる）
//   2. 外部ツール（FFmpeg / Chromium / Node）の状態をチェックし、不足があれば警告
// いずれの失敗もインストール全体を止めない（プレビュー生成を使わない使い方もあるため）。
import { installChromium } from './install-chromium.js';
import { checkEnv, formatEnvReport } from './check-env.js';
import { t } from '../cli/i18n/index.js';

// 1. Chromium のインストール（オプトイン）
const optIn = ['1', 'true', 'yes'].includes(
  String(process.env.DROPCASTER_INSTALL_BROWSER ?? '').toLowerCase()
);
if (optIn) {
  installChromium();
}

// 2. 環境チェック（不足しているものだけ表示）
try {
  const report = await checkEnv();
  const message = formatEnvReport(report, {
    onlyProblems: true,
    title: t('postinstall.envCheckTitle')
  });
  if (message) {
    console.warn('\n' + message);
    console.warn(t('postinstall.skipPreviewNote'));
    console.warn(t('postinstall.doctorNote'));
  }
} catch {
  // 環境チェックの失敗は致命的ではないので無視
}
