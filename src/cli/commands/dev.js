import { createServer } from 'vite';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { generateManifest } from '../utils/manifest.js';
import { generateServiceWorker } from '../utils/service-worker.js';
import { promises as fs } from 'fs';
import { t } from '../i18n/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../../..'); // package root (src/cli/commands → repo root)

export async function dev(options) {
  try {
    console.log(chalk.blue(t('dev.starting')));
    
    // Load user config
    const config = await loadConfig(process.cwd());
    const publicDir = join(process.cwd(), 'public');
    
    // Ensure public directory exists
    await fs.mkdir(publicDir, { recursive: true });
    
    // Generate manifest.json + (minimal) service worker in public directory.
    // ※ dev は localhost なので main.ts は SW を登録しない（--host で LAN IP 経由のときだけ登録される）。
    //   そのためのファイルとして置いておくだけ。
    await generateManifest(config, publicDir);
    await generateServiceWorker(publicDir);
    
    // Create Vite server
    const server = await createServer({
      root: rootDir,
      mode: 'development',
      server: {
        port: parseInt(options.port),
        host: options.host === 'localhost' ? 'localhost' : true,
        fs: {
          allow: [rootDir, process.cwd()]
        }
      },
      define: {
        'import.meta.env.DROPCASTER_CONFIG': JSON.stringify(config),
        'import.meta.env.BASE_URL': JSON.stringify('/')
      },
      publicDir: publicDir
    });
    
    await server.listen();
    
    const url = `http://${options.host}:${options.port}`;
    
    console.log();
    console.log(chalk.green(t('dev.started')));
    console.log();
    console.log(`${chalk.bold(t('dev.local') + ':')}   ${chalk.cyan(url)}`);
    if (options.host !== 'localhost') {
      const networkUrl = `http://${getNetworkAddress()}:${options.port}`;
      console.log(`${chalk.bold(t('dev.network') + ':')} ${chalk.cyan(networkUrl)}`);
    }
    console.log();
    console.log(chalk.gray(t('preview.pressCtrlC')));
    console.log();

  } catch (error) {
    console.error(chalk.red(t('dev.failed')));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

function getNetworkAddress() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'localhost';
}
