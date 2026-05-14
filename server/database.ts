import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type {
  BackupPayload,
  FocusSession,
  Habit,
  HabitLog,
  Project,
  RecurrenceRule,
  SavedFilter,
  SavedFilterCriteria,
  Tag,
  Task,
  TaskComment,
  TaskPriority
} from '../src/types';
import { parsePersianQuickAdd } from '../src/lib/persianDates';
import { calculateStats } from '../src/lib/stats';
import { getNextDueDate } from '../src/lib/recurrence';
import { compareTasks, isTaskInToday, isTaskInUpcoming } from '../src/lib/taskSort';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

interface TaskRow {
  id: string;
  title: string;
  notes: string;
  completed_at: string | null;
  archived_at: string | null;
  project_id: string | null;
  section: string | null;
  parent_id: string | null;
  due_at: string | null;
  deadline_at: string | null;
  reminder_at: string | null;
  scheduled_start: string | null;
  duration_minutes: number | null;
  priority: number;
  energy: 'low' | 'normal' | 'high';
  recurrence: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

interface TaskCommentRow {
  id: string;
  task_id: string;
  body: string;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

interface HabitRow {
  id: string;
  title: string;
  cadence: 'daily' | 'weekly';
  target_count: number;
  created_at: string;
  archived_at: string | null;
}

interface HabitLogRow {
  id: string;
  habit_id: string;
  logged_on: string;
  count: number;
}

interface FocusSessionRow {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  actual_minutes: number;
  status: 'running' | 'completed' | 'cancelled';
}

interface SavedFilterRow {
  id: string;
  name: string;
  color: string;
  criteria: string;
  created_at: string;
}

export interface TaskQuery {
  view?: string;
  search?: string;
  projectId?: string;
  tagId?: string;
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  projectId?: string | null;
  section?: string | null;
  parentId?: string | null;
  dueAt?: string | null;
  deadlineAt?: string | null;
  reminderAt?: string | null;
  scheduledStart?: string | null;
  durationMinutes?: number | null;
  priority?: TaskPriority;
  energy?: Task['energy'];
  recurrence?: RecurrenceRule | null;
  tagIds?: string[];
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  completed?: boolean;
  archived?: boolean;
}

export class KarhaDatabase {
  readonly db: InstanceType<typeof DatabaseSync>;

  constructor(readonly dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.migrate();
    this.seedIfEmpty();
  }

  close(): void {
    this.db.close();
  }

  listTasks(query: TaskQuery = {}): Task[] {
    const tasks = this.loadTasksWithRelations();
    const now = new Date();

    return tasks.filter((task) => {
      if (query.view === 'archived') return !!task.archivedAt;
      if (query.view === 'completed') return !!task.completedAt && !task.archivedAt;
      if (task.archivedAt) return false;
      if (query.view !== 'completed' && query.view !== 'all' && task.completedAt) return false;
      if (query.view === 'inbox' && task.projectId) return false;
      if (query.view === 'today' && !isTaskInToday(task, now)) return false;
      if (query.view === 'upcoming' && !isTaskInUpcoming(task, now)) return false;
      if (query.projectId && task.projectId !== query.projectId) return false;
      if (query.tagId && !task.tags.some((tag) => tag.id === query.tagId)) return false;
      if (query.search) {
        const needle = query.search.toLowerCase();
        if (!`${task.title} ${task.notes}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => compareTasks(a, b, query.view === 'today' || query.view === 'upcoming' ? query.view : 'all'));
  }

  getTask(id: string): Task | null {
    return this.loadTasksWithRelations().find((task) => task.id === id) ?? null;
  }

  createTask(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const id = randomUUID();
    const priority = input.priority ?? 4;
    const orderIndex = this.nextOrderIndex(input.parentId ?? null);

    this.db
      .prepare(
        `INSERT INTO tasks (
          id, title, notes, completed_at, archived_at, project_id, section, parent_id,
          due_at, deadline_at, reminder_at, scheduled_start, duration_minutes, priority, energy, recurrence,
          order_index, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.title.trim(),
        input.notes ?? '',
        input.projectId ?? null,
        input.section ?? null,
        input.parentId ?? null,
        input.dueAt ?? null,
        input.deadlineAt ?? null,
        input.reminderAt ?? null,
        input.scheduledStart ?? null,
        input.durationMinutes ?? null,
        priority,
        input.energy ?? 'normal',
        input.recurrence ? JSON.stringify(input.recurrence) : null,
        orderIndex,
        now,
        now
      );

    this.replaceTaskTags(id, input.tagIds ?? []);
    return this.requireTask(id);
  }

  quickAddTask(rawTitle: string): Task {
    const parsed = parsePersianQuickAdd(rawTitle);
    const project = parsed.projectName ? this.findOrCreateProject(parsed.projectName) : null;
    const tagIds = parsed.tagNames.map((name, index) => this.findOrCreateTag(name, tagColors[index % tagColors.length]).id);

    return this.createTask({
      title: parsed.title || rawTitle.trim(),
      dueAt: parsed.dueAt,
      projectId: project?.id ?? null,
      section: parsed.sectionName,
      priority: parsed.priority,
      recurrence: parsed.recurrence,
      tagIds
    });
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const existing = this.requireTask(id);
    const now = new Date().toISOString();
    const completedAt =
      input.completed === undefined ? existing.completedAt : input.completed ? existing.completedAt ?? now : null;
    const archivedAt = input.archived === undefined ? existing.archivedAt : input.archived ? existing.archivedAt ?? now : null;

    this.db
      .prepare(
        `UPDATE tasks SET
          title = ?, notes = ?, completed_at = ?, archived_at = ?, project_id = ?, section = ?,
          parent_id = ?, due_at = ?, deadline_at = ?, reminder_at = ?, scheduled_start = ?, duration_minutes = ?, priority = ?,
          energy = ?, recurrence = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        input.title?.trim() ?? existing.title,
        input.notes ?? existing.notes,
        completedAt,
        archivedAt,
        input.projectId === undefined ? existing.projectId : input.projectId,
        input.section === undefined ? existing.section : input.section,
        input.parentId === undefined ? existing.parentId : input.parentId,
        input.dueAt === undefined ? existing.dueAt : input.dueAt,
        input.deadlineAt === undefined ? existing.deadlineAt : input.deadlineAt,
        input.reminderAt === undefined ? existing.reminderAt : input.reminderAt,
        input.scheduledStart === undefined ? existing.scheduledStart : input.scheduledStart,
        input.durationMinutes === undefined ? existing.durationMinutes : input.durationMinutes,
        input.priority ?? existing.priority,
        input.energy ?? existing.energy,
        input.recurrence === undefined ? serializeRecurrence(existing.recurrence) : serializeRecurrence(input.recurrence),
        now,
        id
      );

    if (input.tagIds) this.replaceTaskTags(id, input.tagIds);

    if (input.completed && !existing.parentId) {
      this.db
        .prepare(
          `UPDATE tasks
           SET completed_at = ?, updated_at = ?
           WHERE parent_id = ? AND completed_at IS NULL AND archived_at IS NULL`
        )
        .run(completedAt, now, existing.id);
    }

    const updated = this.requireTask(id);
    if (input.completed && existing.recurrence && existing.dueAt) {
      this.createTask({
        title: existing.title,
        notes: existing.notes,
        projectId: existing.projectId,
        section: existing.section,
        dueAt: getNextDueDate(existing.dueAt, existing.recurrence),
        deadlineAt: existing.deadlineAt ? getNextDueDate(existing.deadlineAt, existing.recurrence) : null,
        reminderAt: existing.reminderAt ? getNextDueDate(existing.reminderAt, existing.recurrence) : null,
        scheduledStart: existing.scheduledStart ? getNextDueDate(existing.scheduledStart, existing.recurrence) : null,
        durationMinutes: existing.durationMinutes,
        priority: existing.priority,
        energy: existing.energy,
        recurrence: existing.recurrence,
        tagIds: existing.tags.map((tag) => tag.id)
      });
    }

    return updated;
  }

  deleteTask(id: string): Task {
    return this.updateTask(id, { archived: true });
  }

  listProjects(): Project[] {
    return rows<ProjectRow>(this.db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all()).map(mapProject);
  }

  createProject(input: { name: string; color?: string }): Project {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.name.trim(), input.color ?? '#2563eb', now, now);
    return mapProject(row<ProjectRow>(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id)));
  }

  findOrCreateProject(name: string, color = '#2563eb'): Project {
    const normalized = name.trim();
    const existing = optionalRow<ProjectRow>(this.db.prepare('SELECT * FROM projects WHERE name = ?').get(normalized));
    if (existing) return mapProject(existing);
    return this.createProject({ name: normalized, color });
  }

  listTags(): Tag[] {
    return rows<TagRow>(this.db.prepare('SELECT * FROM tags ORDER BY name ASC').all()).map(mapTag);
  }

  findOrCreateTag(name: string, color = '#0f766e'): Tag {
    const normalized = name.trim();
    const existing = optionalRow<TagRow>(this.db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized));
    if (existing) return mapTag(existing);
    const id = randomUUID();
    this.db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(id, normalized, color);
    return mapTag(row<TagRow>(this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id)));
  }

  createTag(input: { name: string; color?: string }): Tag {
    return this.findOrCreateTag(input.name, input.color ?? '#0f766e');
  }

  listHabits(): Habit[] {
    const habitRows = rows<HabitRow>(this.db.prepare('SELECT * FROM habits WHERE archived_at IS NULL ORDER BY created_at ASC').all());
    const logs = rows<HabitLogRow>(this.db.prepare('SELECT * FROM habit_logs ORDER BY logged_on DESC').all());
    return habitRows.map((habitRow) => ({
      id: habitRow.id,
      title: habitRow.title,
      cadence: habitRow.cadence,
      targetCount: habitRow.target_count,
      createdAt: habitRow.created_at,
      archivedAt: habitRow.archived_at,
      logs: logs.filter((log) => log.habit_id === habitRow.id).map(mapHabitLog)
    }));
  }

  createHabit(input: { title: string; cadence?: 'daily' | 'weekly'; targetCount?: number }): Habit {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO habits (id, title, cadence, target_count, created_at, archived_at) VALUES (?, ?, ?, ?, ?, NULL)'
      )
      .run(id, input.title.trim(), input.cadence ?? 'daily', input.targetCount ?? 1, new Date().toISOString());
    return this.listHabits().find((habit) => habit.id === id)!;
  }

  logHabit(habitId: string, loggedOn = localDateKey(), count = 1): HabitLog {
    const existing = this.db
      .prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND logged_on = ?')
      .get(habitId, loggedOn);
    const existingLog = optionalRow<HabitLogRow>(existing);

    if (existingLog) {
      this.db.prepare('UPDATE habit_logs SET count = ? WHERE id = ?').run(existingLog.count + count, existingLog.id);
      return mapHabitLog(row<HabitLogRow>(this.db.prepare('SELECT * FROM habit_logs WHERE id = ?').get(existingLog.id)));
    }

    const id = randomUUID();
    this.db
      .prepare('INSERT INTO habit_logs (id, habit_id, logged_on, count) VALUES (?, ?, ?, ?)')
      .run(id, habitId, loggedOn, count);
    return mapHabitLog(row<HabitLogRow>(this.db.prepare('SELECT * FROM habit_logs WHERE id = ?').get(id)));
  }

  listFocusSessions(): FocusSession[] {
    return rows<FocusSessionRow>(this.db.prepare('SELECT * FROM focus_sessions ORDER BY started_at DESC').all()).map(mapFocusSession);
  }

  createFocusSession(input: {
    taskId?: string | null;
    plannedMinutes?: number;
    actualMinutes?: number;
    status?: FocusSession['status'];
    startedAt?: string;
    endedAt?: string | null;
  }): FocusSession {
    const id = randomUUID();
    const startedAt = input.startedAt ?? new Date().toISOString();
    const status = input.status ?? 'completed';
    const endedAt =
      input.endedAt === undefined
        ? status === 'completed'
          ? new Date(new Date(startedAt).getTime() + (input.actualMinutes ?? input.plannedMinutes ?? 25) * 60000).toISOString()
          : null
        : input.endedAt;
    this.db
      .prepare(
        `INSERT INTO focus_sessions
        (id, task_id, started_at, ended_at, planned_minutes, actual_minutes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.taskId ?? null,
        startedAt,
        endedAt,
        input.plannedMinutes ?? 25,
        input.actualMinutes ?? input.plannedMinutes ?? 25,
        status
      );
    return mapFocusSession(row<FocusSessionRow>(this.db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id)));
  }

  listSavedFilters(): SavedFilter[] {
    return rows<SavedFilterRow>(this.db.prepare('SELECT * FROM saved_filters ORDER BY created_at ASC').all()).map(mapSavedFilter);
  }

  createSavedFilter(input: { name: string; color?: string; criteria: SavedFilterCriteria }): SavedFilter {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO saved_filters (id, name, color, criteria, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.name.trim(), input.color ?? '#7c3aed', JSON.stringify(input.criteria), new Date().toISOString());
    return mapSavedFilter(row<SavedFilterRow>(this.db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(id)));
  }

  deleteSavedFilter(id: string): void {
    this.db.prepare('DELETE FROM saved_filters WHERE id = ?').run(id);
  }

  listTaskComments(taskId: string): TaskComment[] {
    return rows<TaskCommentRow>(
      this.db.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC').all(taskId)
    ).map(mapTaskComment);
  }

  createTaskComment(taskId: string, body: string): TaskComment {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO task_comments (id, task_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(id, taskId, body.trim(), createdAt);
    return mapTaskComment(row<TaskCommentRow>(this.db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id)));
  }

  reorderTask(id: string, beforeId: string | null): Task {
    const target = this.requireTask(id);
    const before = beforeId ? this.requireTask(beforeId) : null;

    if (before && (before.parentId ?? null) !== (target.parentId ?? null)) {
      return target;
    }

    const orderIndex = before ? before.orderIndex - 0.5 : this.nextOrderIndex(target.parentId);
    this.db.prepare('UPDATE tasks SET order_index = ?, updated_at = ? WHERE id = ?').run(orderIndex, new Date().toISOString(), target.id);
    this.normalizeOrder(target.parentId);
    return this.requireTask(id);
  }

  rescheduleTask(id: string, dueAt: string | null, scheduledStart?: string | null): Task {
    return this.updateTask(id, {
      dueAt,
      scheduledStart: scheduledStart === undefined ? dueAt : scheduledStart
    });
  }

  getStats() {
    return calculateStats(
      this.listTasks({ view: 'all' }),
      this.listHabits(),
      this.listFocusSessions(),
      new Map(this.listProjects().map((project) => [project.id, project.name]))
    );
  }

  exportBackup(): BackupPayload {
    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      projects: this.listProjects(),
      tags: this.listTags(),
      tasks: this.loadTasksWithRelations(),
      taskComments: rows<TaskCommentRow>(this.db.prepare('SELECT * FROM task_comments ORDER BY created_at ASC').all()).map(
        mapTaskComment
      ),
      habits: this.listHabits(),
      focusSessions: this.listFocusSessions(),
      savedFilters: this.listSavedFilters()
    };
  }

  importBackup(payload: BackupPayload): BackupPayload {
    this.db.exec('BEGIN');
    try {
      this.db.exec(
        'DELETE FROM task_tags; DELETE FROM task_comments; DELETE FROM habit_logs; DELETE FROM focus_sessions; DELETE FROM saved_filters; DELETE FROM habits; DELETE FROM tasks; DELETE FROM tags; DELETE FROM projects;'
      );

      for (const project of payload.projects ?? []) {
        this.db
          .prepare('INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(project.id, project.name, project.color, project.createdAt, project.updatedAt);
      }

      for (const tag of payload.tags ?? []) {
        this.db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(tag.id, tag.name, tag.color);
      }

      for (const task of payload.tasks ?? []) {
        this.db
          .prepare(
            `INSERT INTO tasks (
              id, title, notes, completed_at, archived_at, project_id, section, parent_id,
              due_at, deadline_at, reminder_at, scheduled_start, duration_minutes, priority, energy, recurrence,
              order_index, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            task.id,
            task.title,
            task.notes,
            task.completedAt,
            task.archivedAt,
            task.projectId,
            task.section,
            task.parentId,
            task.dueAt,
            task.deadlineAt,
            task.reminderAt,
            task.scheduledStart,
            task.durationMinutes,
            task.priority,
            task.energy,
            serializeRecurrence(task.recurrence),
            task.orderIndex,
            task.createdAt,
            task.updatedAt
          );
        this.replaceTaskTags(
          task.id,
          (task.tags ?? []).map((tag) => tag.id)
        );
      }

      for (const comment of payload.taskComments ?? []) {
        this.db
          .prepare('INSERT INTO task_comments (id, task_id, body, created_at) VALUES (?, ?, ?, ?)')
          .run(comment.id, comment.taskId, comment.body, comment.createdAt);
      }

      for (const habit of payload.habits ?? []) {
        this.db
          .prepare(
            'INSERT INTO habits (id, title, cadence, target_count, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(habit.id, habit.title, habit.cadence, habit.targetCount, habit.createdAt, habit.archivedAt);
        for (const log of habit.logs ?? []) {
          this.db
            .prepare('INSERT INTO habit_logs (id, habit_id, logged_on, count) VALUES (?, ?, ?, ?)')
            .run(log.id, log.habitId, log.loggedOn, log.count);
        }
      }

      for (const session of payload.focusSessions ?? []) {
        this.db
          .prepare(
            `INSERT INTO focus_sessions
            (id, task_id, started_at, ended_at, planned_minutes, actual_minutes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            session.id,
            session.taskId,
            session.startedAt,
            session.endedAt,
            session.plannedMinutes,
            session.actualMinutes,
            session.status
          );
      }

      for (const filter of payload.savedFilters ?? []) {
        this.db
          .prepare('INSERT INTO saved_filters (id, name, color, criteria, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(filter.id, filter.name, filter.color, JSON.stringify(filter.criteria), filter.createdAt);
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return this.exportBackup();
  }

  exportTasksCsv(): string {
    const headers = ['title', 'notes', 'due_at', 'deadline_at', 'reminder_at', 'priority', 'completed_at', 'project', 'section', 'tags'];
    const projects = new Map(this.listProjects().map((project) => [project.id, project.name]));
    const rows = this.listTasks({ view: 'all' }).map((task) => [
      task.title,
      task.notes,
      task.dueAt ?? '',
      task.deadlineAt ?? '',
      task.reminderAt ?? '',
      String(task.priority),
      task.completedAt ?? '',
      task.projectId ? projects.get(task.projectId) ?? '' : '',
      task.section ?? '',
      task.tags.map((tag) => tag.name).join('|')
    ]);

    return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        completed_at TEXT,
        archived_at TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        section TEXT,
        parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        due_at TEXT,
        deadline_at TEXT,
        reminder_at TEXT,
        scheduled_start TEXT,
        duration_minutes INTEGER,
        priority INTEGER NOT NULL DEFAULT 4 CHECK(priority BETWEEN 1 AND 4),
        energy TEXT NOT NULL DEFAULT 'normal',
        recurrence TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cadence TEXT NOT NULL DEFAULT 'daily',
        target_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS habit_logs (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        logged_on TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        UNIQUE(habit_id, logged_on)
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        planned_minutes INTEGER NOT NULL,
        actual_minutes INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_filters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        criteria TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
    `);
    this.ensureTaskColumn('deadline_at', 'TEXT');
    this.ensureTaskColumn('reminder_at', 'TEXT');
  }

  private seedIfEmpty(): void {
    const projectCount = Number(row<{ count: number }>(this.db.prepare('SELECT COUNT(*) AS count FROM projects').get()).count);
    const taskCount = Number(row<{ count: number }>(this.db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).count);
    const habitCount = Number(row<{ count: number }>(this.db.prepare('SELECT COUNT(*) AS count FROM habits').get()).count);

    if (projectCount === 0) {
      this.createProject({ name: 'شخصی', color: '#0f766e' });
      this.createProject({ name: 'کار عمیق', color: '#2563eb' });
    }

    if (taskCount === 0) {
      const personal = this.listProjects().find((project) => project.name === 'شخصی')!;
      const focus = this.listProjects().find((project) => project.name === 'کار عمیق')!;
      const writingTag = this.createTag({ name: 'نوشتن', color: '#b45309' });
      const healthTag = this.createTag({ name: 'سلامت', color: '#0f766e' });

      this.createTask({
        title: 'مرور برنامه امروز',
        notes: 'نمونه امن برای شروع. این داده داخل ریپو ذخیره نمی‌شود.',
        dueAt: new Date(new Date().setHours(9, 0, 0, 0)).toISOString(),
        priority: 2,
        tagIds: [writingTag.id]
      });
      this.createTask({
        title: 'پیاده‌روی کوتاه',
        projectId: personal.id,
        dueAt: new Date(new Date().setHours(18, 0, 0, 0)).toISOString(),
        priority: 3,
        tagIds: [healthTag.id]
      });
      this.createTask({
        title: 'بلوک تمرکز ۲۵ دقیقه‌ای',
        projectId: focus.id,
        scheduledStart: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(),
        durationMinutes: 25,
        priority: 1
      });
    }

    if (habitCount === 0) {
      this.createHabit({ title: 'مطالعه روزانه', cadence: 'daily', targetCount: 1 });
    }
  }

  private loadTasksWithRelations(): Task[] {
    const taskRows = rows<TaskRow>(this.db.prepare('SELECT * FROM tasks ORDER BY completed_at ASC, order_index ASC').all());
    const tagsByTask = new Map<string, Tag[]>();
    const tagRows = this.db
      .prepare(
        `SELECT task_tags.task_id, tags.id, tags.name, tags.color
         FROM task_tags
         JOIN tags ON tags.id = task_tags.tag_id`
      )
      .all();

    for (const tagRow of rows<TagRow & { task_id: string }>(tagRows)) {
      const tags = tagsByTask.get(tagRow.task_id) ?? [];
      tags.push(mapTag(tagRow));
      tagsByTask.set(tagRow.task_id, tags);
    }

    const tasks = taskRows.map((taskRow) => mapTask(taskRow, tagsByTask.get(taskRow.id) ?? []));
    const commentsByTask = new Map<string, TaskComment[]>();
    const commentRows = rows<TaskCommentRow>(this.db.prepare('SELECT * FROM task_comments ORDER BY created_at ASC').all());
    for (const comment of commentRows) {
      commentsByTask.set(comment.task_id, [...(commentsByTask.get(comment.task_id) ?? []), mapTaskComment(comment)]);
    }
    const byParent = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.parentId) {
        const children = byParent.get(task.parentId) ?? [];
        children.push(task);
        byParent.set(task.parentId, children);
      }
    }
    return tasks.map((task) => ({ ...task, subtasks: byParent.get(task.id) ?? [], comments: commentsByTask.get(task.id) ?? [] }));
  }

  private nextOrderIndex(parentId: string | null): number {
    const statement = parentId
      ? this.db.prepare('SELECT COALESCE(MAX(order_index), 0) + 1 AS value FROM tasks WHERE parent_id = ?')
      : this.db.prepare('SELECT COALESCE(MAX(order_index), 0) + 1 AS value FROM tasks WHERE parent_id IS NULL');
    const result = parentId ? statement.get(parentId) : statement.get();
    return Number(row<{ value: number }>(result).value);
  }

  private replaceTaskTags(taskId: string, tagIds: string[]): void {
    this.db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    const insert = this.db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) insert.run(taskId, tagId);
  }

  private requireTask(id: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  private normalizeOrder(parentId: string | null): void {
    const statement = parentId
      ? this.db.prepare('SELECT id FROM tasks WHERE parent_id = ? ORDER BY order_index ASC, created_at ASC')
      : this.db.prepare('SELECT id FROM tasks WHERE parent_id IS NULL ORDER BY order_index ASC, created_at ASC');
    const tasks = rows<{ id: string }>((parentId ? statement.all(parentId) : statement.all()) as unknown[]);
    const update = this.db.prepare('UPDATE tasks SET order_index = ? WHERE id = ?');
    tasks.forEach((task, index) => update.run(index + 1, task.id));
  }

  private ensureTaskColumn(name: string, type: string): void {
    const columns = rows<{ name: string }>(this.db.prepare('PRAGMA table_info(tasks)').all());
    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
    }
  }
}

function mapTask(row: TaskRow, tags: Tag[]): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    projectId: row.project_id,
    section: row.section,
    parentId: row.parent_id,
    dueAt: row.due_at,
    deadlineAt: row.deadline_at,
    reminderAt: row.reminder_at,
    scheduledStart: row.scheduled_start,
    durationMinutes: row.duration_minutes,
    priority: row.priority as TaskPriority,
    energy: row.energy,
    recurrence: row.recurrence ? (JSON.parse(row.recurrence) as RecurrenceRule) : null,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags
  };
}

function mapTaskComment(row: TaskCommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    createdAt: row.created_at
  };
}

function row<T>(value: unknown): T {
  if (!value) throw new Error('Expected database row.');
  return value as T;
}

function optionalRow<T>(value: unknown): T | undefined {
  return value ? (value as T) : undefined;
}

function rows<T>(value: unknown): T[] {
  return value as T[];
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color
  };
}

function mapHabitLog(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    loggedOn: row.logged_on,
    count: row.count
  };
}

function mapFocusSession(row: FocusSessionRow): FocusSession {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    plannedMinutes: row.planned_minutes,
    actualMinutes: row.actual_minutes,
    status: row.status
  };
}

function mapSavedFilter(row: SavedFilterRow): SavedFilter {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    criteria: JSON.parse(row.criteria) as SavedFilterCriteria,
    createdAt: row.created_at
  };
}

function serializeRecurrence(value: RecurrenceRule | null | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function isSameDay(isoDate: string | null, baseDate: Date): boolean {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  return (
    date.getFullYear() === baseDate.getFullYear() &&
    date.getMonth() === baseDate.getMonth() &&
    date.getDate() === baseDate.getDate()
  );
}

function isWithinDays(isoDate: string | null, baseDate: Date, days: number): boolean {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const end = new Date(today);
  end.setDate(today.getDate() + days);
  return date >= today && date <= end;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const tagColors = ['#0f766e', '#b45309', '#2563eb', '#7c3aed'];
