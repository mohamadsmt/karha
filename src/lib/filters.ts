import type { SavedFilterCriteria, Task } from '../types';
import { isPastDay, isToday } from './persianDates';
import { isTaskInToday, isTaskInUpcoming } from './taskSort';

export function filterTasks(tasks: Task[], criteria: SavedFilterCriteria, baseDate = new Date()): Task[] {
  return tasks.filter((task) => {
    if (criteria.view === 'inbox' && task.projectId) return false;
    if (criteria.view === 'today' && !isTaskInToday(task, baseDate)) return false;
    if (criteria.view === 'upcoming' && !isTaskInUpcoming(task, baseDate)) return false;
    if (criteria.view === 'completed' && !task.completedAt) return false;
    if (criteria.view !== 'completed' && task.completedAt) return false;
    if (task.archivedAt) return false;

    if (criteria.text) {
      const needle = criteria.text.trim().toLowerCase();
      const haystack = `${task.title} ${task.notes}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    if (criteria.projectId && task.projectId !== criteria.projectId) return false;

    if (criteria.tagIds?.length) {
      const taskTagIds = new Set(task.tags.map((tag) => tag.id));
      if (!criteria.tagIds.every((tagId) => taskTagIds.has(tagId))) return false;
    }

    if (criteria.priorities?.length && !criteria.priorities.includes(task.priority)) return false;

    if (criteria.dueBefore && (!task.dueAt || task.dueAt > criteria.dueBefore)) return false;
    if (criteria.dueAfter && (!task.dueAt || task.dueAt < criteria.dueAfter)) return false;

    if (criteria.quadrant && getEisenhowerQuadrant(task, baseDate) !== criteria.quadrant) return false;

    return true;
  });
}

export function getEisenhowerQuadrant(
  task: Pick<Task, 'dueAt' | 'priority'>,
  baseDate = new Date()
): NonNullable<SavedFilterCriteria['quadrant']> {
  const urgent = isPastDay(task.dueAt, baseDate) || isToday(task.dueAt, baseDate);
  const important = task.priority <= 2;

  if (urgent && important) return 'urgent-important';
  if (!urgent && important) return 'not-urgent-important';
  if (urgent && !important) return 'urgent-not-important';
  return 'not-urgent-not-important';
}
