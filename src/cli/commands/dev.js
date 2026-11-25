import { createServer } from 'vite';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { resolveBuildInfo } from '../../core/build-info.js';
import { generateManifest } from '../utils/manifest.js';
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
    
    // Generate manifest.json in public directory.
    // ※ dev では Service Worker を使わない (#180)。SW はローカル作品を StaleWhileRevalidate で返すので、
    //   登録すると作品を書き換えても 1 回目の再読み込みに古い版が出る。sw.js は生成せず、viewer
    //   (src/viewer/pwa/register.ts) も登録しない。同じオリジンに以前の版の dev や preview が残した登録は、
    //   index.html に入るスクリプトが外す。どちらも devServiceWorker() (src/cli/utils/dev-service-worker.js) が
    //   行い、このプラグインは下の createServer が root (パッケージ) から読む vite.config.ts に入っている。
    //   public/ に以前の版の dev が書いた sw.js が残っていても登録されない (消しもしない。build は出力先に
    //   生成し直す)。
    //   `--host` で LAN の http://<IP> から開いたときは secure context でないので、もともと登録されない。
    //   PWA の挙動 (オフライン起動・更新の通知) は `dropcaster build` + `dropcaster preview` で確かめる。
    // dev はルート配信 (下の BASE_URL も '/') なので、config に設置先 base・start_url・scope が
    // あっても manifest は '/' で作る。config のまま渡すと start_url '/'・scope '/exhibit/' のように
    // 食い違う (#175)。build で明示された start_url・scope を尊重するのは build 側だけ。
    const devConfig = { ...config, base: '/', start_url: '/', scope: '/' };
    await generateManifest(devConfig, publicDir);
    
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
