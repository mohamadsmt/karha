import type { Task } from '../types';
import { isPastDay, isToday, startOfLocalDay } from './persianDates';

export type SortView = 'inbox' | 'today' | 'upcoming' | 'project' | 'filter' | 'all';

export function isTaskInToday(task: Task, baseDate = new Date()): boolean {
  return !task.completedAt && !task.archivedAt && (isPastDay(task.dueAt, baseDate) || isToday(task.dueAt, baseDate));
}

export function isTaskInUpcoming(task: Task, baseDate = new Date()): boolean {
  if (!task.dueAt || task.completedAt || task.archivedAt) return false;
  return startOfLocalDay(new Date(task.dueAt)) > startOfLocalDay(baseDate);
}

export function compareTasks(a: Task, b: Task, view: SortView = 'all'): number {
  if (view === 'today' || view === 'upcoming' || view === 'filter') {
    return compareNullableDate(a.dueAt, b.dueAt) || a.priority - b.priority || a.orderIndex - b.orderIndex || compareText(a.createdAt, b.createdAt);
  }

  return a.orderIndex - b.orderIndex || compareNullableDate(a.dueAt, b.dueAt) || a.priority - b.priority || compareText(a.createdAt, b.createdAt);
}

export function groupTasksByPersianDay(tasks: Task[]): Array<{ key: string; label: string; tasks: Task[] }> {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.dueAt ? startOfLocalDay(new Date(task.dueAt)).toISOString() : 'no-date';
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, groupedTasks]) => ({
      key,
      label:
        key === 'no-date'
          ? 'بدون تاریخ'
          : new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            }).format(new Date(key)),
      tasks: groupedTasks.sort((a, b) => compareTasks(a, b, 'upcoming'))
    }));
}

function compareNullableDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b);
}
