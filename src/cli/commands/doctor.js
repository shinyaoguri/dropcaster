import chalk from 'chalk';
import { checkEnv, checkChromium, formatEnvReport, REQUIRED_NODE } from '../../core/check-env.js';
import { installChromium } from '../../core/install-chromium.js';
import { t } from '../i18n/index.js';

export async function doctor(options = {}) {
  if (options.install) {
    const chromium = await checkChromium();
    if (chromium.ok) {
      console.log(chalk.green(t('doctor.chromiumAlreadyInstalled')));
    } else {
      console.log(t('doctor.installingChromium'));
      const ok = installChromium();
      if (!ok) process.exitCode = 1;
    }
  }

  const report = await checkEnv();
  const message = formatEnvReport(report, { title: t('doctor.title') });
  console.log('\n' + message + '\n');

  const problems = [report.node, report.ffmpeg, report.chromium].filter(item => !item.ok);
  if (problems.length === 0) {
    console.log(chalk.green(t('doctor.allGood')));
    return;
  }

  if (!report.node.ok) {
    console.error(chalk.red(t('doctor.nodeRequired', { required: REQUIRED_NODE, current: report.node.version })));
    process.exitCode = 1;
  }
  if (!report.ffmpeg.ok || !report.chromium.ok) {
    console.log(chalk.yellow(t('doctor.missingPreviewTools')));
  }
}
