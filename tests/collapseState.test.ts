import { describe, expect, it } from 'vitest';
import {
  readCollapsedCompletedSectionKeys,
  readCollapsedTaskIds,
  toggleCollapsedCompletedSectionKey,
  toggleCollapsedTaskId,
  writeCollapsedCompletedSectionKeys,
  writeCollapsedTaskIds
} from '../src/lib/collapseState';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('collapse state helpers', () => {
  it('persists collapsed task ids to storage', () => {
    const storage = new MemoryStorage();
    const ids = toggleCollapsedTaskId(new Set(), 'parent-1');

    writeCollapsedTaskIds(ids, storage);

    expect(readCollapsedTaskIds(storage).has('parent-1')).toBe(true);
    expect(toggleCollapsedTaskId(ids, 'parent-1').has('parent-1')).toBe(false);
  });

  it('persists collapsed completed section keys to storage', () => {
    const storage = new MemoryStorage();
    const keys = toggleCollapsedCompletedSectionKey(new Set(), 'project:1');

    writeCollapsedCompletedSectionKeys(keys, storage);

    expect(readCollapsedCompletedSectionKeys(storage).has('project:1')).toBe(true);
    expect(toggleCollapsedCompletedSectionKey(keys, 'project:1').has('project:1')).toBe(false);
  });
});
