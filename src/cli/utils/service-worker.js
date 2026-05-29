import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// dropcaster の Service Worker 生成。
// 多バケットキャッシュ SW の本体は ./sw-template.js (正本)。public/sw.js と
// apps/web/public/sw.js は scripts/sync-sw.js でテンプレと同期される。
// build / dev 経由でも、ここで同じテンプレを読んで CACHE_VERSION を差し替えて出力する。

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, 'sw-template.js');
const PACKAGE_JSON_PATH = join(__dirname, '..', '..', '..', 'package.json');

async function readDefaultCacheVersion() {
  try {
    const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON_PATH, 'utf-8'));
    return pkg.version || 'v1';
  } catch {
    return 'v1';
  }
}

export async function generateServiceWorker(outputDir, options = {}) {
  const cacheVersion = options.cacheVersion ?? await readDefaultCacheVersion();
  const template = await fs.readFile(TEMPLATE_PATH, 'utf-8');
  const source = template.replace(
    /const CACHE_VERSION = '[^']*';/,
    `const CACHE_VERSION = ${JSON.stringify(cacheVersion)};`,
  );
  const swPath = join(outputDir, 'sw.js');
  await fs.writeFile(swPath, source, 'utf-8');
  return swPath;
}
