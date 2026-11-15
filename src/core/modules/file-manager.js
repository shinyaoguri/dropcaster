import { readdir, stat, cp, mkdir, rm } from 'fs/promises';
import { basename, join } from 'path';
import { MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE } from './constants.js';
import { replaceDirectory } from './directory-replacement.js';

const SKETCH_COPY_EXCLUDES = new Set([MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE]);

/**
 * 削除されたスケッチのクリーンアップ
 */
export async function cleanupRemovedSketches(currentSketchNames, publicSketchesDir, previewsDir) {
  try {
    // publicSketchesDirの既存ディレクトリをチェック
    const publicEntries = await readdir(publicSketchesDir, { withFileTypes: true });
    for (const entry of publicEntries) {
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

  await replaceDirectory(destinationPath, (stagingPath) => cp(sourcePath, stagingPath, {
    recursive: true,
    filter: shouldCopySketchFile
  }));
  console.error(`📁 Copied ${sketchName} to public directory`);
  return 'copied';
}

/**
 * public 側のコピーが元より新しければ最新とみなす。判定できない (コピーが無い・読めない) ときは
 * コピーし直す。
 * @param {string} sourcePath
 * @param {string} destinationPath
 */
async function isCopyUpToDate(sourcePath, destinationPath) {
  try {
    await stat(destinationPath);
    const sourceMtime = await getLatestMtime(sourcePath);
    const destMtime = await getLatestMtime(destinationPath);
    return sourceMtime <= destMtime;
  } catch {
    return false;
  }
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
