import type { RecurrenceRule } from '../types';

export function getNextDueDate(dueAt: string, recurrence: RecurrenceRule): string {
  const date = new Date(dueAt);
  const interval = Math.max(1, recurrence.interval || 1);

  if (recurrence.frequency === 'daily') {
    date.setDate(date.getDate() + interval);
  }

  if (recurrence.frequency === 'weekly') {
    date.setDate(date.getDate() + interval * 7);
  }

  if (recurrence.frequency === 'monthly') {
    const originalDay = date.getDate();
    date.setMonth(date.getMonth() + interval, 1);
    const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, maxDay));
  }

  return date.toISOString();
}
