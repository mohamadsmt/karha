export type TaskPriority = 1 | 2 | 3 | 4;

export type TaskStatus = 'open' | 'done' | 'archived';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  completedAt: string | null;
  archivedAt: string | null;
  projectId: string | null;
  section: string | null;
  parentId: string | null;
  dueAt: string | null;
  deadlineAt: string | null;
  reminderAt: string | null;
  scheduledStart: string | null;
  durationMinutes: number | null;
  priority: TaskPriority;
  energy: 'low' | 'normal' | 'high';
  recurrence: RecurrenceRule | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
  subtasks?: Task[];
  comments?: TaskComment[];
}

export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
}

export interface Habit {
  id: string;
  title: string;
  cadence: 'daily' | 'weekly';
  targetCount: number;
  createdAt: string;
  archivedAt: string | null;
  logs: HabitLog[];
}

export interface HabitLog {
  id: string;
  habitId: string;
  loggedOn: string;
  count: number;
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  status: 'running' | 'completed' | 'cancelled';
}

export interface SavedFilterCriteria {
  view?: 'inbox' | 'today' | 'upcoming' | 'completed' | 'archived' | 'all';
  text?: string;
  projectId?: string;
  tagIds?: string[];
  priorities?: TaskPriority[];
  dueBefore?: string;
  dueAfter?: string;
  quadrant?: 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'not-urgent-not-important';
}

export interface SavedFilter {
  id: string;
  name: string;
  color: string;
  criteria: SavedFilterCriteria;
  createdAt: string;
}

export interface StatsSummary {
  openTasks: number;
  completedToday: number;
  overdueTasks: number;
  focusMinutesToday: number;
  habitCompletionToday: number;
  byPriority: Record<TaskPriority, number>;
  byProject: Array<{ projectId: string | null; name: string; count: number }>;
}

export interface AppSettings {
  appName: string;
  dataDir: string;
  dbPath: string;
  locale: 'fa-IR';
  calendar: 'persian';
  notifications: 'browser-only';
}

export interface AssistantModel {
  name: string;
  model: string;
  size: number | null;
  modifiedAt: string | null;
  family: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
}

export interface AssistantSettings {
  selectedModel: string | null;
}

export interface AssistantModelsResponse {
  reachable: boolean;
  selectedModel: string | null;
  models: AssistantModel[];
  error?: string;
}

export type AssistantOperationType =
  | 'create_task'
  | 'update_task'
  | 'create_subtask'
  | 'add_comment'
  | 'complete_task'
  | 'reopen_task';

export interface AssistantTaskDraft {
  title?: string;
  notes?: string;
  projectName?: string | null;
  section?: string | null;
  dueAt?: string | null;
  deadlineAt?: string | null;
  reminderAt?: string | null;
  scheduledStart?: string | null;
  durationMinutes?: number | null;
  priority?: TaskPriority;
  energy?: Task['energy'];
  recurrence?: RecurrenceRule | null;
  tagNames?: string[];
  completed?: boolean;
}

export interface AssistantOperation {
  id: string;
  type: AssistantOperationType;
  summary: string;
  targetTaskId?: string | null;
  task?: AssistantTaskDraft | null;
  patch?: AssistantTaskDraft | null;
  commentBody?: string | null;
  subtasks?: AssistantTaskDraft[];
}

export interface AssistantPlanResponse {
  reply: string;
  clarificationQuestion: string | null;
  operations: AssistantOperation[];
}

export interface AssistantApplyResult {
  operationId: string;
  task?: Task;
  tasks?: Task[];
  comment?: TaskComment;
}

export interface AssistantApplyResponse {
  ok: true;
  applied: AssistantApplyResult[];
}

export interface BackupPayload {
  exportedAt: string;
  version: number;
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
  taskComments: TaskComment[];
  habits: Habit[];
  focusSessions: FocusSession[];
  savedFilters: SavedFilter[];
}
