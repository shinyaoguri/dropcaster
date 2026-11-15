import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { build } from '../src/cli/commands/build.js';
import { preview } from '../src/cli/commands/preview.js';
import { normalizeBase } from '../src/cli/utils/base.js';

// build 以外の入口も同じ設置先 base の規則に従う (#175)。
// - build() を command 無しで呼んでも、options.base を明示すればそれが効く
// - preview は dropcaster.config.js の base で配信する (--base オプションは無い)
// - dev はルート配信なので、config に base・start_url・scope があっても manifest は '/' で作る

const cli = resolve(fileURLToPath(new URL('../src/cli/index.js', import.meta.url)));
const originalCwd = process.cwd();
/** @type {string} */
let gallery;

before(async () => {
  gallery = await mkdtemp(join(tmpdir(), 'dropcaster-entry-base-'));
  await mkdir(join(gallery, 'public'));
  await writeFile(join(gallery, 'dropcaster.config.js'), "export default { base: '/exhibit/' };\n");
  process.chdir(gallery);
});

after(async () => {
  process.chdir(originalCwd);
  await rm(gallery, { recursive: true, force: true });
});

async function readManifest(dir) {
  return JSON.parse(await readFile(join(gallery, dir, 'manifest.json'), 'utf-8'));
}

test('build() called without a commander command honors an explicit options.base', async () => {
  await build({ output: 'dist', base: '/other/' });
  const manifest = await readManifest('dist');
  assert.equal(manifest.start_url, '/other/');
  assert.equal(manifest.scope, '/other/');
});

test('preview serves the build under the base from dropcaster.config.js', async () => {
  await build({ output: 'dist' });
  const server = await preview({ port: '0', host: 'localhost', output: 'dist' });
  try {
    const address = server.httpServer.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://localhost:${address.port}`;
    const html = await (await fetch(`${origin}/exhibit/`)).text();
    const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    assert.ok(script?.startsWith('/exhibit/assets/'), `script under /exhibit/: ${script}`);
    const res = await fetch(`${origin}${script}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/, 'asset must not fall back to the SPA HTML');
  } finally {
    await server.close();
  }
});

/**
 * dev を起動して public/manifest.json が書かれるのを待つ。
 * @param {object} config dropcaster.config.js の中身
 * @returns {Promise<{ start_url: string, scope: string }>}
 */
async function devManifest(config) {
  const devGallery = await mkdtemp(join(tmpdir(), 'dropcaster-dev-base-'));
  await writeFile(join(devGallery, 'dropcaster.config.js'), `export default ${JSON.stringify(config)};\n`);
  const child = spawn(process.execPath, [cli, 'dev', '--port', '0'], { cwd: devGallery, stdio: 'ignore' });
  try {
    const manifestPath = join(devGallery, 'public', 'manifest.json');
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        return JSON.parse(await readFile(manifestPath, 'utf-8'));
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    assert.fail('dev did not write public/manifest.json in time');
  } finally {
    child.kill();
    await rm(devGallery, { recursive: true, force: true });
  }
}

test('dev writes a root-scoped manifest even when the config has a base', async () => {
  const manifest = await devManifest({ base: '/exhibit/' });
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});

test('dev pins start_url and scope to / even when the config sets them for the deployed base', async () => {
  const manifest = await devManifest({ base: '/exhibit/', start_url: '/exhibit/', scope: '/exhibit/' });
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});

test('normalizeBase boundaries match the viewer and reject relative / URL bases', () => {
  assert.equal(normalizeBase(undefined), '/');
  assert.equal(normalizeBase(''), '/');
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase('exhibit'), '/exhibit/');
  assert.equal(normalizeBase('/a/b'), '/a/b/');
  const bad = [
    './', '.', '../x/', '//cdn.example/', 'https://cdn.example/', 42,
    '/x?y=1', '/x#top', '/my gallery/', '/x\t', '\\x', '/a\\b/',
  ];
  for (const value of bad) {
    assert.throws(() => normalizeBase(value), /base/, JSON.stringify(value));
  }
});
