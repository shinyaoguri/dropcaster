import type { SketchSnapshot } from './sketchSnapshot';

// 固定した作品のコード (#197)。hash をキーにし、同じ版を複数のプロジェクトで共有する。
// プロジェクトの DB (dropcaster.projects) の版を上げると、それより前の viewer はその DB を開けなくなり
// (VersionError)、固定を含まないプロジェクトまで読めなくなる。別の DB にして、プロジェクトの DB は変えない。
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('dropcaster.sketch-snapshots', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { blocked = true; database = undefined; reject(new Error('Snapshot database blocked')); };
  });
}
export async function readSnapshot(hash: string): Promise<SketchSnapshot | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('snapshots').objectStore('snapshots').get(hash);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
/** 同じ hash がすでにあれば、先に固定した記録 (取得日時) を残して書き換えない。返すのは保存されている方。 */
export async function storeSnapshot(snapshot: SketchSnapshot): Promise<SketchSnapshot> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite'), store = transaction.objectStore('snapshots');
    let stored = snapshot;
    const existing = store.get(snapshot.hash);
    existing.onsuccess = () => {
      if (existing.result) stored = existing.result;
      else store.put(snapshot, snapshot.hash);
    };
    transaction.oncomplete = () => resolve(stored);
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Snapshot storage failed'));
  });
}
