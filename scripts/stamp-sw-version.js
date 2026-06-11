#!/usr/bin/env node
// build:web の後に apps/web/dist/sw.js の CACHE_VERSION を焼き込む（postbuild:web フック）。
//
// 正本テンプレ (src/cli/utils/sw-template.js) とコミット済みコピー
// (public/sw.js, apps/web/public/sw.js) は 'v1' のまま決定的に保ち、
// デプロイ成果物にだけ「package version + git SHA」を刻む。
// これが無いとホスト版 SW のバケット世代が永久に v1 のままになり、
// activate 時の旧バケット掃除が一度も発動せず、ハッシュ付き旧アセットが
// dropcaster-shell-v1 に蓄積し続ける。
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const swPath = join(rootDir, 'apps/web/dist/sw.js');

const pkg = JSON.parse(await fs.readFile(join(rootDir, 'package.json'), 'utf-8'));
let sha = 'local';
try {
  sha = execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim();
} catch {
  // git が無い環境 (tarball ビルド等) では 'local' のまま
}
const version = `${pkg.version}-${sha}`;

const src = await fs.readFile(swPath, 'utf-8');
const out = src.replace(
  /const CACHE_VERSION = '[^']*';/,
  `const CACHE_VERSION = ${JSON.stringify(version)};`,
);
if (out === src) {
  throw new Error(`stamp-sw-version: CACHE_VERSION not found in ${swPath}`);
}
await fs.writeFile(swPath, out, 'utf-8');
console.log(`stamp-sw-version: ${swPath} -> ${version}`);
