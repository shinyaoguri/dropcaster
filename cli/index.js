#!/usr/bin/env node

import { program } from 'commander';
import { build } from './commands/build.js';
import { dev } from './commands/dev.js';
import { scan, scanReset } from './commands/scan.js';
import { init } from './commands/init.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

program
  .name('dropcaster')
  .description('A static PWA generator for creative coding sketches')
  .version(packageJson.version);

program
  .command('init [name]')
  .description('Initialize a new dropcaster project')
  .option('-t, --template <template>', 'Template to use', 'default')
  .action((name, options) => {
    // nameが引数として渡された場合、optionsに追加
    if (name) {
      options.name = name;
    }
    init(options);
  });

program
  .command('dev')
  .description('Start development server')
  .option('-p, --port <port>', 'Port to use', '5173')
  .option('-h, --host <host>', 'Host to use', 'localhost')
  .action(dev);

program
  .command('build')
  .description('Build for production')
  .option('-o, --output <dir>', 'Output directory', 'dist')
  .option('--base <path>', 'Base path for deployment', '/')
  .action(build);

program
  .command('scan')
  .description('Scan sketches directory and generate metadata')
  .option('--sketch <name>', 'Scan specific sketch only')
  .option('--force-preview', 'Force regenerate preview images')
  .option('--reset', 'Reset and regenerate all previews')
  .option('--fetch-userdata', 'Fetch user data from OpenProcessing')
  .option('-v, --verbose', 'Show detailed output')
  .action(scan);

program
  .command('scan:reset')
  .description('Reset and regenerate all preview images')
  .option('--fetch-userdata', 'Also fetch user data from OpenProcessing')
  .action(scanReset);

program.parse();