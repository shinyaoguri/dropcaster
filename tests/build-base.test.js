import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// dropcaster build の base は「CLI で明示した --base > dropcaster.config.js の base > '/'」(#175)。
// 実際に CLI から build を走らせ、HTML のアセット・manifest へのリンク・manifest の start_url / scope が
// すべて同じ base から始まることを確かめる。--base の既定値と明示した値を区別できるのは
// commander を通したときだけなので、関数単体ではなく CLI の入口で検証する。

const cli = resolve(fileURLToPath(new URL('../src/cli/index.js', import.meta.url)));

/**
 * @param {string | undefined} configBase dropcaster.config.js に書く base (undefined なら書かない)
 * @param {string[]} [args] build に渡す追加の引数
 */
async function buildGallery(configBase, args = []) {
  const gallery = await mkdtemp(join(tmpdir(), 'dropcaster-build-base-'));
  try {
    await mkdir(join(gallery, 'public'));
    const config = configBase === undefined ? {} : { base: configBase };
    await writeFile(join(gallery, 'dropcaster.config.js'), `export default ${JSON.stringify(config)};\n`);
    execFileSync(process.execPath, [cli, 'build', ...args], { cwd: gallery, stdio: 'pipe' });
    const html = await readFile(join(gallery, 'dist', 'index.html'), 'utf-8');
    const manifest = JSON.parse(await readFile(join(gallery, 'dist', 'manifest.json'), 'utf-8'));
    const local = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(m => m[1])
      .filter(url => !/^https?:/.test(url));
    return { local, manifest };
  } finally {
    await rm(gallery, { recursive: true, force: true });
  }
}

/**
 * @param {{ local: string[], manifest: { start_url: string, scope: string } }} built
 * @param {string} base
 */
function assertBase({ local, manifest }, base) {
  assert.ok(local.some(url => url.startsWith(`${base}assets/`)), `assets under ${base}: ${local}`);
  assert.ok(local.includes(`${base}manifest.json`), `manifest link under ${base}: ${local}`);
  assert.deepEqual(local.filter(url => !url.startsWith(base)), [], `every local URL starts with ${base}`);
  assert.equal(manifest.start_url, base);
  assert.equal(manifest.scope, base);
}

test('build uses base from dropcaster.config.js when --base is not given', async () => {
  assertBase(await buildGallery('/exhibit/'), '/exhibit/');
});

test('build normalizes a config base without a trailing slash', async () => {
  assertBase(await buildGallery('/exhibit'), '/exhibit/');
});

test('explicit --base wins over the config, including an explicit root', async () => {
  assertBase(await buildGallery('/exhibit/', ['--base', '/other']), '/other/');
  assertBase(await buildGallery('/exhibit/', ['--base', '/']), '/');
});

test('build falls back to / when neither config nor --base sets it', async () => {
  assertBase(await buildGallery(undefined), '/');
});
