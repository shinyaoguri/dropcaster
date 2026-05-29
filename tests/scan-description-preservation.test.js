import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = join(repoRoot, 'src/core/scan-sketches.js');

// scan-sketches.js は module-level で project root から各 dir を const に束縛するため、
// テストは子プロセスで DROPCASTER_PROJECT_ROOT を渡して実行する。
async function runScan(projectRoot, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scanScript, '--write-file', ...extraArgs], {
      env: { ...process.env, DROPCASTER_PROJECT_ROOT: projectRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function setupSketch(projectRoot, { dirName = 'foo', html, manualMetadata = null } = {}) {
  const sketchDir = join(projectRoot, 'sketches', dirName);
  await mkdir(sketchDir, { recursive: true });
  await writeFile(join(sketchDir, 'index.html'), html ?? '<!doctype html><html><head><title>foo</title></head><body></body></html>', 'utf-8');
  if (manualMetadata) {
    await writeFile(join(sketchDir, 'dropcaster.meta.json'), JSON.stringify(manualMetadata), 'utf-8');
  }
}

async function writeExistingSketchesJson(projectRoot, sketches) {
  const publicDir = join(projectRoot, 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'sketches.json'), JSON.stringify(sketches, null, 2), 'utf-8');
}

async function readSketchesJson(projectRoot) {
  return JSON.parse(await readFile(join(projectRoot, 'public', 'sketches.json'), 'utf-8'));
}

async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-scan-'));
  try { return await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('scan preserves existing description when no manual metadata and no HTML meta', async () => {
  await withTempProject(async (root) => {
    await setupSketch(root);
    await writeExistingSketchesJson(root, [
      { id: 'foo', title: 'foo', description: 'preserved-desc', path: 'sketches/foo/' },
    ]);

    const { code, stderr } = await runScan(root);
    assert.equal(code, 0, `scan failed:\n${stderr}`);

    const out = await readSketchesJson(root);
    const foo = out.find(s => s.id === 'foo');
    assert.ok(foo, 'foo entry missing');
    assert.equal(foo.description, 'preserved-desc');
  });
});

test('manual metadata description takes priority over existing description', async () => {
  await withTempProject(async (root) => {
    await setupSketch(root, {
      manualMetadata: { description: 'manual-desc' },
    });
    await writeExistingSketchesJson(root, [
      { id: 'foo', title: 'foo', description: 'preserved-desc', path: 'sketches/foo/' },
    ]);

    const { code, stderr } = await runScan(root);
    assert.equal(code, 0, `scan failed:\n${stderr}`);

    const out = await readSketchesJson(root);
    const foo = out.find(s => s.id === 'foo');
    assert.ok(foo, 'foo entry missing');
    assert.equal(foo.description, 'manual-desc');
  });
});

test('default-suffix descriptions in existing sketches.json are NOT preserved (treated as placeholder)', async () => {
  await withTempProject(async (root) => {
    await setupSketch(root);
    await writeExistingSketchesJson(root, [
      // 既存が default 形式の場合は再生成扱い: 上書きされる
      { id: 'foo', title: 'foo', description: 'foo スケッチ', path: 'sketches/foo/' },
    ]);

    const { code, stderr } = await runScan(root);
    assert.equal(code, 0, `scan failed:\n${stderr}`);

    const out = await readSketchesJson(root);
    const foo = out.find(s => s.id === 'foo');
    assert.ok(foo, 'foo entry missing');
    // default-suffix の場合、既存復元のガード条件が false になり、新規 analyze の結果がそのまま入る
    assert.equal(foo.description, 'foo スケッチ');
  });
});
