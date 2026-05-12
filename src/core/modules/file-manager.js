import { readdir, stat, cp, mkdir, rm } from 'fs/promises';
import { basename, join } from 'path';
import { MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE } from './config.js';

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
 * スケッチをpublicディレクトリにコピー
 */
export async function copySketchToPublic(sketchName, sourcePath, destinationDir, forceRegenerate = false) {
  try {
    const destinationPath = join(destinationDir, sketchName);
    
    // ディレクトリが存在するか確認
    try {
      await stat(destinationPath);
      // 既に存在する場合は、更新日時を比較
      const sourceMtime = await getLatestMtime(sourcePath);
      const destMtime = await getLatestMtime(destinationPath);
      
      if (!forceRegenerate && sourceMtime <= destMtime) {
        console.error(`✓ ${sketchName} is up to date`);
        return;
      }
    } catch (error) {
      // ディレクトリが存在しない場合は新規作成
    }
    
    // コピーを実行
    await rm(destinationPath, { recursive: true, force: true });
    await cp(sourcePath, destinationPath, {
      recursive: true,
      filter: shouldCopySketchFile
    });
    console.error(`📁 Copied ${sketchName} to public directory`);
  } catch (error) {
    console.warn(`Warning: Failed to copy ${sketchName}:`, error.message);
  }
}

function shouldCopySketchFile(source) {
  return !SKETCH_COPY_EXCLUDES.has(basename(source));
}

async function getLatestMtime(path) {
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
