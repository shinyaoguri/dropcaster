// ディレクトリを「消してから作る」と、作る途中で失敗したときに旧版が失われ、中途半端な新版が残る
// (#174 の scan のコピー、#167 の fetch --overwrite)。新しい中身を兄弟の staging ディレクトリに
// 組み立て、完成してから rename で差し替えることで、失敗しても旧版を残し、残骸を置かない。

import { mkdir, rename, rm } from 'fs/promises';
import { basename, dirname, join } from 'path';

let sequence = 0;

/**
 * destinationPath を、build が staging に組み立てた中身で差し替える。
 *
 * - build が失敗したら staging を消して例外をそのまま投げる。destinationPath には触れない。
 * - staging は destinationPath と同じ親に `.名前.staging-…` として置く (rename は同じ
 *   ファイルシステム内でしか成り立たないため)。親ディレクトリは呼び出し側が用意する。
 * - 差し替えは「旧版を退避 → staging を所定の名前へ → 退避した旧版を消す」の順。
 *   staging を所定の名前へ移せなかったときは旧版を戻す。
 *
 * @template T
 * @param {string} destinationPath 差し替える対象 (無くてもよい)
 * @param {(stagingPath: string) => Promise<T>} build 作成済みの空ディレクトリ stagingPath に中身を組み立てる
 * @returns {Promise<T>} build の戻り値
 */
export async function replaceDirectory(destinationPath, build) {
  const parent = dirname(destinationPath);
  const name = basename(destinationPath);
  const suffix = `${process.pid}-${Date.now().toString(36)}-${sequence++}`;
  const stagingPath = join(parent, `.${name}.staging-${suffix}`);
  const previousPath = join(parent, `.${name}.previous-${suffix}`);

  let result;
  try {
    await mkdir(stagingPath);
    result = await build(stagingPath);
  } catch (error) {
    await discard(stagingPath);
    throw error;
  }

  let movedPrevious = false;
  try {
    await rename(destinationPath, previousPath);
    movedPrevious = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      await discard(stagingPath);
      throw error;
    }
  }

  try {
    await rename(stagingPath, destinationPath);
  } catch (error) {
    if (movedPrevious) await rename(previousPath, destinationPath).catch(() => {});
    await discard(stagingPath);
    throw error;
  }

  if (movedPrevious) {
    try {
      await rm(previousPath, { recursive: true, force: true });
    } catch (error) {
      // 差し替えは済んでいる。旧版の残骸がどこにあるかを伝えて失敗として扱う
      throw new Error(`${destinationPath} was replaced, but the previous version remains at ${previousPath}: ${error.message}`, { cause: error });
    }
  }
  return result;
}

/** @param {string} path */
async function discard(path) {
  await rm(path, { recursive: true, force: true }).catch(() => {});
}
