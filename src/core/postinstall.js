#!/usr/bin/env node
// npm install 後に実行される:
//   1. Playwright の Chromium をダウンロード（プレビュー GIF 生成に必要）
//   2. 外部ツール（FFmpeg / Chromium / Node）の状態をチェックし、不足があれば警告
// いずれの失敗もインストール全体を止めない（プレビュー生成を使わない使い方もあるため）。
import { spawnSync } from 'child_process';
import { checkEnv, formatEnvReport } from './check-env.js';

// 1. Chromium をインストール（クロスプラットフォームのためシェル経由。固定コマンドなので安全）
try {
  const result = spawnSync('npx playwright install chromium', {
    stdio: 'inherit',
    shell: true
  });
  if (result.error || result.status !== 0) {
    console.warn('⚠️  Playwright の Chromium インストールに失敗しました。');
    console.warn('   プレビュー生成を使う場合は手動で `npx playwright install chromium` を実行してください。');
  }
} catch (error) {
  console.warn(`⚠️  Playwright の Chromium インストールを実行できませんでした: ${error.message}`);
}

// 2. 環境チェック（不足しているものだけ表示）
try {
  const report = await checkEnv();
  const message = formatEnvReport(report, {
    onlyProblems: true,
    title: 'dropcaster — 環境チェック（不足分）'
  });
  if (message) {
    console.warn('\n' + message);
    console.warn('  ※ プレビュー GIF を生成しない使い方なら無視して構いません（dropcaster scan --no-previews）。');
    console.warn('  ※ 状態を再確認するには `dropcaster doctor` を実行してください。\n');
  }
} catch {
  // 環境チェックの失敗は致命的ではないので無視
}
