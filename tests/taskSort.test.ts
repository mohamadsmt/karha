import { describe, expect, it } from 'vitest';
import { compareTasks, groupTasksByPersianDay, isTaskInToday, isTaskInUpcoming } from '../src/lib/taskSort';
import type { Task } from '../src/types';

const baseTask: Task = {
  id: 'task',
  title: 'تسک',
  notes: '',
  completedAt: null,
  archivedAt: null,
  projectId: null,
  section: null,
  parentId: null,
  dueAt: null,
  deadlineAt: null,
  reminderAt: null,
  scheduledStart: null,
  durationMinutes: null,
  priority: 4,
  energy: 'normal',
  recurrence: null,
  orderIndex: 1,
  createdAt: '2026-05-13T08:00:00.000Z',
  updatedAt: '2026-05-13T08:00:00.000Z',
  tags: [],
  subtasks: [],
  comments: []
};

function task(patch: Partial<Task>): Task {
  return { ...baseTask, ...patch };
}

describe('Todoist-style task sorting', () => {
  it('includes overdue tasks in Today and keeps future tasks in Upcoming', () => {
    const baseDate = new Date('2026-05-14T12:00:00.000Z');

    expect(isTaskInToday(task({ dueAt: '2026-05-13T09:00:00.000Z' }), baseDate)).toBe(true);
    expect(isTaskInToday(task({ dueAt: '2026-05-14T17:00:00.000Z' }), baseDate)).toBe(true);
    expect(isTaskInUpcoming(task({ dueAt: '2026-05-15T09:00:00.000Z' }), baseDate)).toBe(true);
  });

  it('sorts date and time before priority, manual order, and created time', () => {
    const sorted = [
      task({ id: 'low-priority-now', dueAt: '2026-05-14T10:00:00.000Z', priority: 4, orderIndex: 2 }),
      task({ id: 'high-priority-later', dueAt: '2026-05-14T12:00:00.000Z', priority: 1, orderIndex: 1 }),
      task({ id: 'high-priority-now', dueAt: '2026-05-14T10:00:00.000Z', priority: 1, orderIndex: 3 })
    ].sort((a, b) => compareTasks(a, b, 'today'));

    expect(sorted.map((item) => item.id)).toEqual(['high-priority-now', 'low-priority-now', 'high-priority-later']);
  });

  it('groups upcoming tasks by Persian day', () => {
    const groups = groupTasksByPersianDay([
      task({ id: 'one', dueAt: '2026-05-15T09:00:00.000Z' }),
      task({ id: 'two', dueAt: '2026-05-16T09:00:00.000Z' })
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].label).toContain('اردیبهشت');
  });
});
