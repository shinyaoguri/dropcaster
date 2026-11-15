import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceDirectory } from '../src/core/modules/directory-replacement.js';

/** @param {(root: string) => Promise<void>} fn */
async function withTempDir(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-replace-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('replaces an existing directory with the built contents and leaves no staging or previous copy', async () => {
  await withTempDir(async (root) => {
    const target = join(root, 'work');
    await mkdir(target);
    await writeFile(join(target, 'old.txt'), 'old');

    const value = await replaceDirectory(target, async (staging) => {
      await writeFile(join(staging, 'new.txt'), 'new');
      return 'built';
    });

    assert.equal(value, 'built');
    assert.deepEqual(await readdir(target), ['new.txt']);
    assert.deepEqual(await readdir(root), ['work']);
  });
});

test('creates the destination when it does not exist yet', async () => {
  await withTempDir(async (root) => {
    const target = join(root, 'work');
    await replaceDirectory(target, (staging) => writeFile(join(staging, 'a.txt'), 'a'));
    assert.equal(await readFile(join(target, 'a.txt'), 'utf-8'), 'a');
    assert.deepEqual(await readdir(root), ['work']);
  });
});

test('a failing build keeps the previous directory intact and removes the staging directory', async () => {
  await withTempDir(async (root) => {
    const target = join(root, 'work');
    await mkdir(target);
    await writeFile(join(target, 'old.txt'), 'old');

    await assert.rejects(
      replaceDirectory(target, async (staging) => {
        await writeFile(join(staging, 'half.txt'), 'half');
        throw new Error('boom');
      }),
      /boom/,
    );

    assert.deepEqual(await readdir(target), ['old.txt']);
    assert.equal(await readFile(join(target, 'old.txt'), 'utf-8'), 'old');
    assert.deepEqual(await readdir(root), ['work']);
  });
});

test('a failing build for a new destination leaves nothing behind', async () => {
  await withTempDir(async (root) => {
    await assert.rejects(replaceDirectory(join(root, 'work'), async () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(await readdir(root), []);
  });
});

test('fails with the cause when the parent cannot hold directories', async () => {
  await withTempDir(async (root) => {
    await writeFile(join(root, 'file'), 'not a directory');
    let built = false;
    await assert.rejects(
      replaceDirectory(join(root, 'file', 'work'), async () => { built = true; }),
      { code: 'ENOTDIR' },
    );
    assert.equal(built, false);
  });
});
