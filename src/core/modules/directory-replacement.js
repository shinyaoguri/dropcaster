// ディレクトリを「消してから作る」と、作る途中で失敗したときに旧版が失われ、中途半端な新版が残る。
// 新しい中身を兄弟の staging ディレクトリに組み立て、完成してから rename で差し替えることで、
// 失敗しても旧版を残し、残骸を置かない。利用者は scan の public へのコピー (#174) と
// fetch による sketches/ への書き出し (#167)。

import { randomBytes } from 'crypto';
import { mkdir, rename, rm } from 'fs/promises';
import { dirname, join } from 'path';

// 作業用ディレクトリの名前。対象の名前を含めない (長い名前で ENAMETOOLONG を起こさないため)。
// 異常終了や旧版の削除失敗で残ったものは、作品の検出・掃除・build のコピーから外す。
const RESIDUE_NAME_PATTERN = /^\.dc-(?:staging|previous)-[0-9a-f]{16}$/;

/**
 * replaceDirectory が作る作業用ディレクトリ (staging / 退避した旧版) の名前か。
 * 利用者のドットディレクトリ (`.well-known` など) は含まない。
 * @param {string} name パスではなくディレクトリ名
 */
export function isReplacementResidue(name) {
  return RESIDUE_NAME_PATTERN.test(name);
}

/**
 * staging を所定の名前へ移せず、退避した旧版を元の場所へ戻すのにも失敗したときに投げる。
 * 旧版は previousPath に残っている (destinationPath には何も無い)。cause は最初の失敗。
 */
export class PreviousNotRestoredError extends Error {
  /**
   * @param {string} destinationPath
   * @param {string} previousPath
   * @param {Error} cause staging を所定の名前へ移せなかった原因
   * @param {Error} restoreError 旧版を戻せなかった原因
   */
  constructor(destinationPath, previousPath, cause, restoreError) {
    super(`${cause?.message ?? cause}; the previous version could not be moved back to ${destinationPath} `
      + `and remains at ${previousPath} (${restoreError?.message ?? restoreError})`, { cause });
    this.name = 'PreviousNotRestoredError';
    this.destinationPath = destinationPath;
    this.previousPath = previousPath;
    this.restoreError = restoreError;
  }
}

/**
 * @template T
 * @typedef {object} ReplaceResult
 * @property {T} value build の戻り値
 * @property {{ path: string, error: Error } | null} leftover 差し替え後に消せなかった旧版。差し替え自体は済んでいる
 */

/**
 * destinationPath を、build が staging に組み立てた中身で差し替える。
 *
 * - build が失敗したら staging を消して例外をそのまま投げる。destinationPath には触れない。
 * - staging は destinationPath と同じ親に置く (rename は同じファイルシステム内でしか
 *   成り立たないため)。親ディレクトリは呼び出し側が用意する。
 * - 差し替えは「旧版を退避 → staging を所定の名前へ → 退避した旧版を消す」の順。
 *   staging を所定の名前へ移せなかったときは旧版を戻して例外を投げる。旧版を戻すのにも
 *   失敗したときは、旧版の場所を持つ PreviousNotRestoredError を投げる。
 * - 最後の旧版の削除だけが失敗したときは、差し替えは成功として扱い、残骸を leftover で返す。
 *
 * @template T
 * @param {string} destinationPath 差し替える対象 (無くてもよい。ディレクトリでなくてもよい)
 * @param {(stagingPath: string) => Promise<T>} build 作成済みの空ディレクトリ stagingPath に中身を組み立てる
 * @returns {Promise<ReplaceResult<T>>}
 */
export async function replaceDirectory(destinationPath, build) {
  const parent = dirname(destinationPath);
  const stagingPath = join(parent, `.dc-staging-${randomBytes(8).toString('hex')}`);
  const previousPath = join(parent, `.dc-previous-${randomBytes(8).toString('hex')}`);

  let value;
  try {
    await mkdir(stagingPath);
    value = await build(stagingPath);
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
    let restoreError = null;
    if (movedPrevious) await rename(previousPath, destinationPath).catch((e) => { restoreError = e; });
    await discard(stagingPath);
    if (restoreError) throw new PreviousNotRestoredError(destinationPath, previousPath, error, restoreError);
    throw error;
  }

  let leftover = null;
  if (movedPrevious) {
    try {
      await rm(previousPath, { recursive: true, force: true });
    } catch (error) {
      leftover = { path: previousPath, error };
    }
  }
  return { value, leftover };
}

/** @param {string} path */
async function discard(path) {
  await rm(path, { recursive: true, force: true }).catch(() => {});
}
