import type { FocusSession, Habit, StatsSummary, Task, TaskPriority } from '../types';
import { isPastDay, isToday } from './persianDates';

export function calculateStats(
  tasks: Task[],
  habits: Habit[],
  focusSessions: FocusSession[],
  projectNames = new Map<string, string>(),
  baseDate = new Date()
): StatsSummary {
  const openTasks = tasks.filter((task) => !task.completedAt && !task.archivedAt).length;
  const completedToday = tasks.filter((task) => isToday(task.completedAt, baseDate)).length;
  const overdueTasks = tasks.filter((task) => !task.completedAt && isPastDay(task.dueAt, baseDate)).length;
  const focusMinutesToday = focusSessions
    .filter((session) => isToday(session.startedAt, baseDate) && session.status === 'completed')
    .reduce((sum, session) => sum + session.actualMinutes, 0);

  const habitCompletionToday = habits.length
    ? Math.round(
        (habits.filter((habit) => habit.logs.some((log) => isToday(`${log.loggedOn}T12:00:00`, baseDate))).length /
          habits.length) *
          100
      )
    : 0;

  const byPriority = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<TaskPriority, number>;
  const byProjectCounts = new Map<string | null, number>();

  for (const task of tasks) {
    if (task.completedAt || task.archivedAt) continue;
    byPriority[task.priority] += 1;
    byProjectCounts.set(task.projectId, (byProjectCounts.get(task.projectId) ?? 0) + 1);
  }

  return {
    openTasks,
    completedToday,
    overdueTasks,
    focusMinutesToday,
    habitCompletionToday,
    byPriority,
    byProject: Array.from(byProjectCounts.entries()).map(([projectId, count]) => ({
      projectId,
      name: projectId ? projectNames.get(projectId) ?? 'پروژه' : 'Inbox',
      count
    }))
  };
}
