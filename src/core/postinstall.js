#!/usr/bin/env node
// npm install 後に実行される:
//   1. Playwright の Chromium をダウンロード（プレビュー GIF 生成に必要）
//   2. 外部ツール（FFmpeg / Chromium / Node）の状態をチェックし、不足があれば警告
// いずれの失敗もインストール全体を止めない（プレビュー生成を使わない使い方もあるため）。
import { spawnSync } from 'child_process';
import { checkEnv, formatEnvReport } from './check-env.js';
import { t } from '../cli/i18n/index.js';

// 1. Chromium をインストール（クロスプラットフォームのためシェル経由。固定コマンドなので安全）
try {
  const result = spawnSync('npx playwright install chromium', {
    stdio: 'inherit',
    shell: true
  });
  if (result.error || result.status !== 0) {
    console.warn(t('postinstall.chromiumFailed'));
    console.warn(t('postinstall.chromiumManual'));
  }
} catch (error) {
  console.warn(t('postinstall.chromiumException', { error: error.message }));
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
