import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isReplacementResidue, replaceDirectory } from '../src/core/modules/directory-replacement.js';

const permissionSkip = process.platform === 'win32' || process.getuid?.() === 0
  ? 'file permissions are not enforced for this user / platform'
  : false;

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

    const result = await replaceDirectory(target, async (staging) => {
      await writeFile(join(staging, 'new.txt'), 'new');
      return 'built';
    });

    assert.deepEqual(result, { value: 'built', leftover: null });
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

test('staging names do not include the destination name, so long names do not hit ENAMETOOLONG', async () => {
  await withTempDir(async (root) => {
    const longName = 'a'.repeat(240);
    let stagingName = '';
    await replaceDirectory(join(root, longName), async (staging) => {
      stagingName = staging.slice(root.length + 1);
      await writeFile(join(staging, 'a.txt'), 'a');
    });
    assert.ok(isReplacementResidue(stagingName), `unexpected staging name: ${stagingName}`);
    assert.deepEqual(await readdir(root), [longName]);
  });
});

test('isReplacementResidue matches only the helper work directories, not user dot directories', () => {
  assert.equal(isReplacementResidue('.dc-staging-0123456789abcdef'), true);
  assert.equal(isReplacementResidue('.dc-previous-0123456789abcdef'), true);
  const others = ['.well-known', '.git', 'sketch1', '.dc-staging-', '.dc-staging-xyz',
    'x.dc-previous-0123456789abcdef', '.dc-other-0123456789abcdef'];
  for (const name of others) {
    assert.equal(isReplacementResidue(name), false, name);
  }
});

test('when only removing the previous version fails, the replacement succeeds and reports the leftover', { skip: permissionSkip }, async () => {
  await withTempDir(async (root) => {
    const target = join(root, 'work');
    await mkdir(join(target, 'locked'), { recursive: true });
    await writeFile(join(target, 'locked', 'old.txt'), 'old');
    await chmod(join(target, 'locked'), 0o555);
    try {
      const result = await replaceDirectory(target, (staging) => writeFile(join(staging, 'new.txt'), 'new'));
      assert.ok(result.leftover, 'leftover must be reported');
      assert.ok(isReplacementResidue(result.leftover.path.slice(root.length + 1)), result.leftover.path);
      assert.match(result.leftover.error.message, /EACCES|EPERM/);
      assert.deepEqual(await readdir(target), ['new.txt']);
    } finally {
      for (const name of await readdir(root)) {
        await chmod(join(root, name, 'locked'), 0o755).catch(() => {});
      }
    }
  });
});
