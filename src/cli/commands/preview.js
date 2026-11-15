import { resolve } from 'path';
import { preview as vitePreview } from 'vite';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { loadConfig } from '../utils/config.js';
import { resolveBase, readBuildRecordBase } from '../utils/base.js';

/**
 * build と同じ設置先 base で dist を配信する。build が出力先に記録した base
 * (dropcaster-build.json) > dropcaster.config.js の `base` > `'/'` で決まる。記録の無い古い出力は
 * config に従う。preview に `--base` オプションは無い (プログラムから options.base を渡せばそれが最優先)。
 *
 * @param {{ port: string, host: string, output: string, base?: string }} options
 */
export async function preview(options) {
  try {
    const config = await loadConfig(process.cwd());
    const recordedBase = await readBuildRecordBase(resolve(process.cwd(), options.output));
    const base = resolveBase(options, undefined, { base: recordedBase ?? config.base });
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
