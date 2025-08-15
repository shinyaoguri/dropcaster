import { readdir, stat, cp, mkdir, rm } from 'fs/promises';
import { join } from 'path';

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
      const sourceStats = await stat(sourcePath);
      const destStats = await stat(destinationPath);
      
      if (!forceRegenerate && sourceStats.mtime <= destStats.mtime) {
        console.error(`✓ ${sketchName} is up to date`);
        return;
      }
    } catch (error) {
      // ディレクトリが存在しない場合は新規作成
    }
    
    // コピーを実行
    await cp(sourcePath, destinationPath, { recursive: true });
    console.error(`📁 Copied ${sketchName} to public directory`);
  } catch (error) {
    console.warn(`Warning: Failed to copy ${sketchName}:`, error.message);
  }
}

/**
 * ディレクトリの作成（存在確認付き）
 */
export async function ensureDirectoryExists(dirPath, description = 'directory') {
  try {
    await mkdir(dirPath, { recursive: true });
    console.error(`✓ Created ${description}`);
  } catch (error) {
    // ディレクトリが既に存在する場合は無視
  }
}
