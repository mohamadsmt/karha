import { describe, expect, it } from 'vitest';
import type { Task } from '../src/types';
import { filterTasks, getEisenhowerQuadrant } from '../src/lib/filters';

const baseTask: Task = {
  id: '1',
  title: 'نوشتن گزارش',
  notes: '',
  completedAt: null,
  archivedAt: null,
  projectId: null,
  section: null,
  parentId: null,
  dueAt: '2026-05-13T09:00:00.000Z',
  deadlineAt: null,
  reminderAt: null,
  scheduledStart: null,
  durationMinutes: null,
  priority: 1,
  energy: 'normal',
  recurrence: null,
  orderIndex: 1,
  createdAt: '2026-05-13T08:00:00.000Z',
  updatedAt: '2026-05-13T08:00:00.000Z',
  tags: [{ id: 'tag-1', name: 'نوشتن', color: '#0f766e' }],
  comments: []
};

describe('task filters', () => {
  it('filters today and text criteria', () => {
    const result = filterTasks([baseTask], { view: 'today', text: 'گزارش' }, new Date('2026-05-13T12:00:00.000Z'));
    expect(result).toHaveLength(1);
  });

  it('filters by tag and priority', () => {
    const result = filterTasks([baseTask], { tagIds: ['tag-1'], priorities: [1] });
    expect(result[0]?.title).toBe('نوشتن گزارش');
  });

  it('classifies urgent important tasks', () => {
    expect(getEisenhowerQuadrant(baseTask, new Date('2026-05-13T12:00:00.000Z'))).toBe('urgent-important');
  });
});
