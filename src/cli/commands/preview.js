import { preview as vitePreview } from 'vite';
import chalk from 'chalk';
import { t } from '../i18n/index.js';

export async function preview(options) {
  try {
    const server = await vitePreview({
      root: process.cwd(),
      build: {
        outDir: options.output
      },
      preview: {
        port: parseInt(options.port, 10),
        host: options.host === 'localhost' ? 'localhost' : true
      }
    });

    const url = `http://${options.host}:${options.port}`;

    console.log();
    console.log(chalk.green(t('preview.starting')));
    console.log();
    console.log(`${chalk.bold(t('dev.local') + ':')}   ${chalk.cyan(url)}`);
    console.log();
    console.log(chalk.gray(t('preview.pressCtrlC')));
    console.log();

    return server;
  } catch (error) {
    console.error(chalk.red(t('preview.failed')));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
