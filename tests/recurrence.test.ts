import { describe, expect, it } from 'vitest';
import { getNextDueDate } from '../src/lib/recurrence';

describe('recurrence', () => {
  it('generates daily and weekly due dates', () => {
    expect(new Date(getNextDueDate('2026-05-13T09:00:00.000Z', { frequency: 'daily', interval: 2 })).getUTCDate()).toBe(15);
    expect(new Date(getNextDueDate('2026-05-13T09:00:00.000Z', { frequency: 'weekly', interval: 1 })).getUTCDate()).toBe(20);
  });

  it('keeps monthly recurrence on a valid end-of-month day', () => {
    const next = new Date(getNextDueDate('2025-01-31T09:00:00.000Z', { frequency: 'monthly', interval: 1 }));
    expect(next.getUTCFullYear()).toBe(2025);
    expect(next.getUTCMonth()).toBe(1);
    expect(next.getUTCDate()).toBe(28);
  });
});
