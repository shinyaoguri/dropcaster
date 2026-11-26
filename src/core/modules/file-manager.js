import { readdir, stat, cp, mkdir, rm, readFile, readlink } from 'fs/promises';
import { basename, join } from 'path';
import { MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE } from './constants.js';
import { isReplacementResidue, replaceDirectory } from './directory-replacement.js';

const SKETCH_COPY_EXCLUDES = new Set([MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE]);
// 作品の入口。scan はこれのあるディレクトリを作品とみなし、カタログの path はここを指す
const SKETCH_ENTRY_FILE = 'index.html';

/**
 * 削除されたスケッチのクリーンアップ
 */
export async function cleanupRemovedSketches(currentSketchNames, publicSketchesDir, previewsDir) {
  try {
    // publicSketchesDirの既存ディレクトリをチェック
    const publicEntries = await readdir(publicSketchesDir, { withFileTypes: true });
    for (const entry of publicEntries) {
      // 差し替えの作業用ディレクトリの残骸 (旧版を消せなかったもの・異常終了で残った staging) は
      // 作品ではない。削除を試み、消せなければ警告して次回また試す
      if (isReplacementResidue(entry.name)) {
        await removeReplacementResidue(join(publicSketchesDir, entry.name), entry.name);
        continue;
      }
      if (entry.isDirectory() && !currentSketchNames.has(entry.name)) {
        const oldSketchPath = join(publicSketchesDir, entry.name);
        const oldPreviewPath = join(previewsDir, `${entry.name}.gif`);
        
        try {
          await rm(oldSketchPath, { recursive: true, force: true });
          console.error(`🗑️ Removed deleted sketch: ${entry.name}`);
        } catch (error) {
          console.warn(`Warning: Failed to remove sketch ${entry.name}:`, error.message);
        }
        
        try {
          await rm(oldPreviewPath, { force: true });
          console.error(`🗑️ Removed deleted preview: ${entry.name}.gif`);
        } catch (error) {
          // プレビューファイルが存在しない場合は無視
        }
      }
    }
  } catch (error) {
    console.warn('Warning: Failed to cleanup removed sketches:', error.message);
  }
}

/**
 * @param {string} path
 * @param {string} name
 */
async function removeReplacementResidue(path, name) {
  try {
    await rm(path, { recursive: true, force: true });
    console.error(`🗑️ Removed leftover ${name}`);
  } catch (error) {
    console.warn(`Warning: could not remove leftover ${name} (will retry on the next scan): ${error.message}`);
  }
}

/**
 * スケッチを public ディレクトリにコピーする。
 * 失敗は例外で返す (呼び出し側が作品ごとの失敗として集計する)。コピーは staging に組み立ててから
 * 差し替えるので、失敗しても前回のコピーはそのまま残り、中途半端なコピーは残らない
 * (残骸のほうが新しく見えて「最新」と誤判定されることもない)。
 * @param {string} sketchName
 * @param {string} sourcePath
 * @param {string} destinationDir
 * @param {boolean} [forceRegenerate]
 * @returns {Promise<'copied' | 'up-to-date'>}
 */
export async function copySketchToPublic(sketchName, sourcePath, destinationDir, forceRegenerate = false) {
  const destinationPath = join(destinationDir, sketchName);

  if (!forceRegenerate && await isCopyUpToDate(sourcePath, destinationPath)) {
    console.error(`✓ ${sketchName} is up to date`);
    return 'up-to-date';
  }

  const { leftover } = await replaceDirectory(destinationPath, (stagingPath) => cp(sourcePath, stagingPath, {
    recursive: true,
    filter: shouldCopySketchFile
  }));
  console.error(`📁 Copied ${sketchName} to public directory`);
  if (leftover) {
    // 新しいコピーは置けている。消せなかった旧版の場所だけ伝える (作品・build の対象外で、
    // 次の全件 scan の cleanupRemovedSketches が削除を試みる)
    console.error(`Warning: could not remove the previous copy of ${sketchName} at ${leftover.path}: ${leftover.error.message}`);
  }
  return 'copied';
}

/**
 * public 側のコピーが配信できる形か (ディレクトリで、入口の index.html がある)。
 * @param {string} copyPath public/sketches/<作品名>
 */
export async function isServableSketchCopy(copyPath) {
  try {
    if (!(await stat(copyPath)).isDirectory()) return false;
    return (await stat(join(copyPath, SKETCH_ENTRY_FILE))).isFile();
  } catch {
    return false;
  }
}

/**
 * public 側のコピーが最新か。配信できる形で、元からコピーするはずのファイルが過不足なく揃い、
 * 元より新しいときだけ最新とみなす。それ以外 (コピーが無い・ファイルになっている・入口や
 * 一部のファイルが欠けている・余分なファイルがある・どちらかが読めない) はコピーし直す。
 * ファイルの揃いを見るのは、修正前の rm → cp が途中で失敗して残した、新しく見える部分的な
 * コピーを「最新」と誤判定しないため。
 * @param {string} sourcePath
 * @param {string} destinationPath
 */
async function isCopyUpToDate(sourcePath, destinationPath) {
  try {
    if (!(await isServableSketchCopy(destinationPath))) return false;
    const source = await readTree(sourcePath, shouldCopySketchFile);
    const dest = await readTree(destinationPath);
    return haveSameEntries(source.files, dest.files) && source.latestMtime <= dest.latestMtime;
  } catch {
    return false;
  }
}

/**
 * ツリーの最新 mtime (getLatestMtime と同じく全エントリが対象) と、ファイルの相対パスの集合を返す。
 * include が false を返したエントリ (とその配下) は集合に入れない (コピーしないファイル)。
 * @param {string} root
 * @param {(path: string) => boolean} [include]
 * @returns {Promise<{ latestMtime: Date, files: Set<string> }>}
 */
async function readTree(root, include = () => true) {
  /** @type {Set<string>} */
  const files = new Set();

  /**
   * @param {string} path
   * @param {string} relativePath
   * @param {boolean} listed
   * @returns {Promise<Date>}
   */
  async function walk(path, relativePath, listed) {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      if (listed) files.add(relativePath);
      return stats.mtime;
    }
    const entries = await readdir(path, { withFileTypes: true });
    const mtimes = await Promise.all(entries.map((entry) => {
      const childPath = join(path, entry.name);
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      return walk(childPath, childRelative, listed && include(childPath));
    }));
    return mtimes.reduce((latest, current) => (current > latest ? current : latest), stats.mtime);
  }

  const latestMtime = await walk(root, '', true);
  return { latestMtime, files };
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
function haveSameEntries(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function shouldCopySketchFile(source) {
  return !SKETCH_COPY_EXCLUDES.has(basename(source));
}

/**
 * 与えられたパス配下（ファイル単体 or ディレクトリ再帰）の最新 mtime を返す。
 * スケッチディレクトリの更新判定（src と public の新旧比較、プレビュー再生成判定）で
 * 共有する。
 */
export async function getLatestMtime(path) {
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    return stats.mtime;
  }

  const entries = await readdir(path, { withFileTypes: true });
  const mtimes = await Promise.all(entries.map(async (entry) => {
    return getLatestMtime(join(path, entry.name));
  }));

  return mtimes.reduce((latest, current) => {
    return current > latest ? current : latest;
  }, stats.mtime);
}

/**
 * あってもなくてもよいファイルをテキストで読む。無いとき (ENOENT で、リンク先の無い symlink でもない) だけ null。
 * それ以外 (読めない・ディレクトリ・リンク先の無い symlink) は例外を投げる。「無い」と「読めない」を
 * 区別し、読めない入力を「無い」として黙って扱わないため (#275)。
 * @param {string} path
 * @returns {Promise<string | null>}
 */
export async function readOptionalTextFile(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const brokenLink = await brokenSymlinkError(path);
    if (brokenLink) throw brokenLink;
    return null;
  }
}

/**
 * stat が ENOENT だったパスが、リンク先の無い symlink か確かめる。そうならその旨の Error を返し、
 * 本当に無い (symlink でもない) ときは null を返す。
 * @param {string} path
 * @returns {Promise<Error | null>}
 */
export async function brokenSymlinkError(path) {
  let target;
  try {
    target = await readlink(path);
  } catch {
    // 無い (ENOENT)・symlink でない (EINVAL): リンク切れではない
    return null;
  }
  return new Error(`${basename(path)} is a broken symbolic link (target not found: ${target})`);
}

/** stat ベースの存在チェック（fs.access より readable）。 */
export async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/**
 * ディレクトリの作成（存在確認付き）
 */
export async function ensureDirectoryExists(dirPath, description = 'directory') {
  try {
    // mkdir(recursive) は新規作成した最上位ディレクトリのパスを返す（既存なら undefined）
    const created = await mkdir(dirPath, { recursive: true });
    if (created) {
      console.error(`✓ Created ${description}`);
    }
  } catch (error) {
    // 作成に失敗した場合（権限など）は呼び出し側の後続処理でエラーになるためここでは無視
  }
}
