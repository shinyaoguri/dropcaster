import { createServer } from 'vite';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { resolveBuildInfo } from '../../core/build-info.js';
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
    
    // Generate manifest.json + multi-bucket service worker in public directory.
    // ※ viewer (src/viewer/pwa/register.ts) は localhost でも SW を登録する（--host で LAN IP の http から
    //   開いたときは secure context でないので登録しない）。dev は毎回新しい cacheVersion で出すので、
    //   dev を再起動すると開いたままのタブには「新しい版があります」が出る（実測、#164）。新しい版は
    //   タブを閉じるか通知から適用したときに有効になり、activate で古い版の shell だけを捨てる。
    //   中身のバケット (runtime など) は版をまたいで残るので、dev では Vite のモジュールも runtime に
    //   残り続ける。dev で SW を登録するかどうかを含め #180 の判断事項。
    // dev はルート配信 (下の BASE_URL も '/') なので、config に設置先 base・start_url・scope が
    // あっても manifest は '/' で作る。config のまま渡すと start_url '/'・scope '/exhibit/' のように
    // 食い違う (#175)。build で明示された start_url・scope を尊重するのは build 側だけ。
    const devConfig = { ...config, base: '/', start_url: '/', scope: '/' };
    await generateManifest(devConfig, publicDir);
    await generateServiceWorker(publicDir, { cacheVersion: `dev-${Date.now()}` });
    
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
        'import.meta.env.DROPCASTER_CONFIG': JSON.stringify(devConfig),
        'import.meta.env.DROPCASTER_BUILD': JSON.stringify(resolveBuildInfo(rootDir)),
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
