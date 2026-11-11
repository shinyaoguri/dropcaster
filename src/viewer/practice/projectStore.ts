import type { Project } from './project';

// One store for the #117 Project envelope, including embedded venue assets.
// Layout compatibility continues to use WindowController's existing v2 storage.
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('dropcaster.projects', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('Project database blocked')); };
  });
}
export async function readProject(key = 'draft'): Promise<Project | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
let writes: Promise<void> = Promise.resolve();
export function writeProject(project: Project, key = 'draft'): Promise<void> {
  const snapshot = structuredClone(project);
  const write = writes.catch(() => {}).then(async () => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite');
      transaction.objectStore('projects').put(snapshot, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Project storage failed'));
    });
  });
  writes = write;
  return write;
}
export async function listProjects(): Promise<{ id: string; name: string }[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const items: { id: string; name: string }[] = [];
    const request = db.transaction('projects').objectStore('projects').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(items); return; }
      if (cursor.key !== 'draft') items.push({ id: String(cursor.key), name: String(cursor.value.name) });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
