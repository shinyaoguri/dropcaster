import chalk from 'chalk';
import { checkEnv, formatEnvReport, REQUIRED_NODE } from '../../core/check-env.js';

export async function doctor() {
  const report = await checkEnv();
  const message = formatEnvReport(report, { title: 'dropcaster — 環境チェック' });
  console.log('\n' + message + '\n');

  const problems = [report.node, report.ffmpeg, report.chromium].filter(item => !item.ok);
  if (problems.length === 0) {
    console.log(chalk.green('すべて揃っています。'));
    return;
  }

  if (!report.node.ok) {
    console.error(chalk.red(`Node.js v${REQUIRED_NODE} 以上が必要です（現在 ${report.node.version}）。`));
    process.exitCode = 1;
  }
  if (!report.ffmpeg.ok || !report.chromium.ok) {
    console.log(chalk.yellow('FFmpeg / Chromium が無い場合、プレビュー GIF は生成されません（`dropcaster scan --no-previews` 相当の動作）。'));
  }
}
