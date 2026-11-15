import { preview as vitePreview } from 'vite';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { loadConfig } from '../utils/config.js';
import { resolveBase } from '../utils/base.js';

/**
 * build と同じ設置先 base で dist を配信する。preview に `--base` オプションは無いので、
 * dropcaster.config.js の `base` > `'/'` で決まる (プログラムから options.base を渡せばそれが優先)。
 *
 * @param {{ port: string, host: string, output: string, base?: string }} options
 */
export async function preview(options) {
  try {
    const config = await loadConfig(process.cwd());
    const base = resolveBase(options, undefined, config);
    const server = await vitePreview({
      root: process.cwd(),
      base,
      build: {
        outDir: options.output
      },
      preview: {
        port: parseInt(options.port, 10),
        host: options.host === 'localhost' ? 'localhost' : true
      }
    });

    const url = `http://${options.host}:${options.port}${base}`;

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
