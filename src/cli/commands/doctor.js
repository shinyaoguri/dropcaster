import chalk from 'chalk';
import { checkEnv, formatEnvReport, REQUIRED_NODE } from '../../core/check-env.js';
import { t } from '../i18n/index.js';

export async function doctor() {
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
