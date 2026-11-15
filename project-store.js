let database;

function openProjects() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('zpg-armor-viewer', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'name' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function transact(mode, operation) {
  const db = await openProjects();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', mode);
    const request = operation(transaction.objectStore('projects'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function listProjects() {
  return transact('readonly', store => store.getAllKeys());
}

export function loadProject(name) {
  return transact('readonly', store => store.get(name));
}

export function saveProject(project) {
  return transact('readwrite', store => store.put(project));
}
