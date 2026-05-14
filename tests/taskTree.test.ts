import { describe, expect, it } from 'vitest';
import { buildTaskTree, canReorderTasks, flattenTaskTree, getEffectiveCollapsedTaskIds } from '../src/lib/taskTree';
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
  dueAt: '2026-05-14T09:00:00.000Z',
  deadlineAt: null,
  reminderAt: null,
  scheduledStart: null,
  durationMinutes: null,
  priority: 2,
  energy: 'normal',
  recurrence: null,
  orderIndex: 1,
  createdAt: '2026-05-14T08:00:00.000Z',
  updatedAt: '2026-05-14T08:00:00.000Z',
  tags: [],
  subtasks: [],
  comments: []
};

function task(patch: Partial<Task>): Task {
  return { ...baseTask, ...patch };
}

describe('task tree helpers', () => {
  it('renders subtasks only under their parent', () => {
    const parent = task({ id: 'parent', title: 'والد' });
    const child = task({ id: 'child', title: 'زیرتسک', parentId: 'parent', orderIndex: 2 });
    const nodes = buildTaskTree([parent, child], () => true, (a, b) => a.orderIndex - b.orderIndex);
    const rows = flattenTaskTree(nodes, new Set());

    expect(nodes).toHaveLength(1);
    expect(rows.map((row) => row.task.id)).toEqual(['parent', 'child']);
    expect(rows[1].depth).toBe(1);
  });

  it('uses parent context when only a child matches', () => {
    const parent = task({ id: 'parent', title: 'والد' });
    const child = task({ id: 'child', title: 'زیرتسک', parentId: 'parent', orderIndex: 2 });
    const nodes = buildTaskTree([parent, child], (item) => item.id === 'child', (a, b) => a.orderIndex - b.orderIndex);

    expect(nodes[0].contextOnly).toBe(true);
    expect(nodes[0].children.map((item) => item.id)).toEqual(['child']);
  });

  it('rejects smart drag across buckets and different parents', () => {
    const parent = task({ id: 'parent' });
    const first = task({ id: 'first', parentId: 'parent', dueAt: '2026-05-14T09:00:00.000Z', priority: 1 });
    const second = task({ id: 'second', parentId: 'parent', dueAt: '2026-05-14T10:00:00.000Z', priority: 1 });
    const otherParent = task({ id: 'other-parent' });
    const otherChild = task({ id: 'other-child', parentId: 'other-parent', dueAt: first.dueAt, priority: 1 });

    expect(canReorderTasks(first, second, 'smart')).toBe(false);
    expect(canReorderTasks(first, otherChild, 'manual')).toBe(false);
  });

  it('temporarily collapses a dragged parent with subtasks', () => {
    const parent = task({ id: 'parent' });
    const child = task({ id: 'child', parentId: 'parent' });
    const collapsed = new Set(['other']);

    const effective = getEffectiveCollapsedTaskIds(collapsed, 'parent', [parent, child]);

    expect(effective.has('parent')).toBe(true);
    expect(collapsed.has('parent')).toBe(false);
    expect(getEffectiveCollapsedTaskIds(collapsed, 'child', [parent, child])).toBe(collapsed);
  });
});
