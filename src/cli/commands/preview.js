import { preview as vitePreview } from 'vite';
import chalk from 'chalk';

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
    console.log(chalk.green('✨ Preview server started!'));
    console.log();
    console.log(`  ${chalk.bold('Local:')}   ${chalk.cyan(url)}`);
    console.log();
    console.log(chalk.gray('Press Ctrl+C to stop'));
    console.log();

    return server;
  } catch (error) {
    console.error(chalk.red('Failed to start preview server'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
