import { promises as fs } from 'fs';
import { join, relative } from 'path';
import { isReplacementResidue } from '../../core/modules/directory-replacement.js';

export async function copyPublicFiles(sourceDir, targetDir) {
  try {
    await fs.access(sourceDir);
  } catch {
    // Public directory doesn't exist
    return;
  }
  
  await copyRecursive(sourceDir, targetDir);
}

async function copyRecursive(source, target) {
  const stats = await fs.stat(source);
  
  if (stats.isDirectory()) {
    // Create target directory
    await fs.mkdir(target, { recursive: true });
    
    // Read directory contents
    const entries = await fs.readdir(source, { withFileTypes: true });
    
    // Copy each entry
    for (const entry of entries) {
      // Skip sw.js as it will be generated
      if (entry.name === 'sw.js') {
        continue;
      }
      // scan の差し替えで消せなかった作業用ディレクトリ (旧版の残骸など) は配信しない
      if (isReplacementResidue(entry.name)) {
        continue;
      }
      
      const sourcePath = join(source, entry.name);
      const targetPath = join(target, entry.name);
      
      if (entry.isDirectory()) {
        await copyRecursive(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  } else {
    // Copy file
    await fs.copyFile(source, target);
  }
}

export async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}