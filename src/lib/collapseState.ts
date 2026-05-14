const collapsedSubtasksKey = 'karha.collapsedSubtasks';
const collapsedCompletedSectionsKey = 'karha.collapsedCompletedSections';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readCollapsedTaskIds(storage: StorageLike | undefined = getLocalStorage()): Set<string> {
  return readStringSet(collapsedSubtasksKey, storage);
}

export function writeCollapsedTaskIds(ids: Set<string>, storage: StorageLike | undefined = getLocalStorage()): void {
  if (!storage) return;
  storage.setItem(collapsedSubtasksKey, JSON.stringify([...ids]));
}

export function toggleCollapsedTaskId(ids: Set<string>, taskId: string): Set<string> {
  const next = new Set(ids);
  if (next.has(taskId)) next.delete(taskId);
  else next.add(taskId);
  return next;
}

export function readCollapsedCompletedSectionKeys(storage: StorageLike | undefined = getLocalStorage()): Set<string> {
  return readStringSet(collapsedCompletedSectionsKey, storage);
}

export function writeCollapsedCompletedSectionKeys(keys: Set<string>, storage: StorageLike | undefined = getLocalStorage()): void {
  if (!storage) return;
  storage.setItem(collapsedCompletedSectionsKey, JSON.stringify([...keys]));
}

export function toggleCollapsedCompletedSectionKey(keys: Set<string>, sectionKey: string): Set<string> {
  const next = new Set(keys);
  if (next.has(sectionKey)) next.delete(sectionKey);
  else next.add(sectionKey);
  return next;
}

function getLocalStorage(): StorageLike | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function readStringSet(key: string, storage: StorageLike | undefined): Set<string> {
  if (!storage) return new Set();

  try {
    const raw = storage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}
