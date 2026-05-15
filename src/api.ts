import type {
  AppSettings,
  FocusSession,
  Habit,
  HabitLog,
  Project,
  SavedFilter,
  SavedFilterCriteria,
  StatsSummary,
  Tag,
  Task,
  TaskComment
} from './types';

const baseUrl = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  settings: () => request<AppSettings>('/api/settings'),
  tasks: (params = '') => request<Task[]>(`/api/tasks${params}`),
  quickAdd: (title: string, context?: { projectId?: string | null }) =>
    request<Task>('/api/tasks/quick-add', {
      method: 'POST',
      body: JSON.stringify({ title, projectId: context?.projectId ?? undefined })
    }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  archiveTask: (id: string) => request<Task>(`/api/tasks/${id}`, { method: 'DELETE' }),
  createTask: (body: Record<string, unknown>) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  addTaskComment: (taskId: string, body: string) =>
    request<TaskComment>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body })
    }),
  reorderTask: (taskId: string, beforeId: string | null) =>
    request<Task>(`/api/tasks/${taskId}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ beforeId })
    }),
  rescheduleTask: (taskId: string, dueAt: string | null, scheduledStart?: string | null) =>
    request<Task>(`/api/tasks/${taskId}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ dueAt, scheduledStart })
    }),
  projects: (params = '') => request<Project[]>(`/api/projects${params}`),
  createProject: (name: string) =>
    request<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name })
    }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  archiveProject: (id: string) => request<Project>(`/api/projects/${id}`, { method: 'DELETE' }),
  tags: () => request<Tag[]>('/api/tags'),
  createTag: (name: string) =>
    request<Tag>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name })
    }),
  habits: () => request<Habit[]>('/api/habits'),
  createHabit: (title: string) =>
    request<Habit>('/api/habits', {
      method: 'POST',
      body: JSON.stringify({ title })
    }),
  logHabit: (habitId: string) =>
    request<HabitLog>(`/api/habits/${habitId}/log`, {
      method: 'POST',
      body: JSON.stringify({})
    }),
  focusSessions: () => request<FocusSession[]>('/api/focus-sessions'),
  createFocusSession: (body: Partial<FocusSession>) =>
    request<FocusSession>('/api/focus-sessions', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  savedFilters: () => request<SavedFilter[]>('/api/saved-filters'),
  createSavedFilter: (body: { name: string; color?: string; criteria: SavedFilterCriteria }) =>
    request<SavedFilter>('/api/saved-filters', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  deleteSavedFilter: (id: string) => request<{ ok: true }>(`/api/saved-filters/${id}`, { method: 'DELETE' }),
  stats: () => request<StatsSummary>('/api/stats'),
  exportBackup: () => request<unknown>('/api/backup/export')
};
