// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApiRequest } from '../server/app';
import { KarhaDatabase } from '../server/database';
import { resolveDataPaths } from '../server/dataPaths';
import type { AppSettings } from '../src/types';

let cleanupPaths: string[] = [];

afterEach(() => {
  for (const dir of cleanupPaths) rmSync(dir, { recursive: true, force: true });
  cleanupPaths = [];
  vi.unstubAllGlobals();
});

function createContext() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'karha-test-'));
  cleanupPaths.push(dataDir);
  const store = new KarhaDatabase(path.join(dataDir, 'karha.sqlite'));
  const settings: AppSettings = {
    appName: 'کارها',
    dataDir,
    dbPath: path.join(dataDir, 'karha.sqlite'),
    locale: 'fa-IR',
    calendar: 'persian',
    notifications: 'browser-only'
  };
  return { store, settings };
}

function mockOllama({
  models = ['llama3.1:8b'],
  plan
}: {
  models?: string[];
  plan?: Record<string, unknown>;
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return json({
          models: models.map((name) => ({
            name,
            model: name,
            modified_at: '2026-05-15T09:00:00.000Z',
            size: 4_900_000_000,
            details: { family: 'llama', parameter_size: '8B', quantization_level: 'Q4_K_M' }
          }))
        });
      }

      if (url.endsWith('/api/chat') && init?.method === 'POST') {
        return json({
          message: {
            content: JSON.stringify(
              plan ?? {
                reply: 'پیشنهاد آماده است.',
                clarificationQuestion: null,
                operations: []
              }
            )
          }
        });
      }

      return json({}, 404);
    })
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('local API', () => {
  it('creates a task through Persian quick add', async () => {
    const context = createContext();
    const response = await handleApiRequest(
      new Request('http://local/api/tasks/quick-add', {
        method: 'POST',
        body: JSON.stringify({ title: 'ارسال ایمیل فردا ساعت ۹ #کار @ایمیل /جلسه !1 هر هفته' })
      }),
      context
    );

    expect(response.status).toBe(201);
    const task = await response.json();
    expect(task.title).toBe('ارسال ایمیل');
    expect(task.tags[0].name).toBe('ایمیل');
    expect(task.section).toBe('جلسه');
    expect(task.recurrence.frequency).toBe('weekly');
    expect(task.priority).toBe(1);
    expect(context.store.listProjects().some((project) => project.name === 'کار')).toBe(true);
    context.store.close();
  });

  it('uses the quick-add fallback project unless text names another project', async () => {
    const context = createContext();
    const fallbackProject = context.store.createProject({ name: 'کار' });
    const fallbackResponse = await handleApiRequest(
      new Request('http://local/api/tasks/quick-add', {
        method: 'POST',
        body: JSON.stringify({ title: 'مرور تسک ها', projectId: fallbackProject.id })
      }),
      context
    );
    const explicitResponse = await handleApiRequest(
      new Request('http://local/api/tasks/quick-add', {
        method: 'POST',
        body: JSON.stringify({ title: 'مرور تسک ها #شخصی', projectId: fallbackProject.id })
      }),
      context
    );

    const fallbackTask = await fallbackResponse.json();
    const explicitTask = await explicitResponse.json();
    const explicitProject = context.store.listProjects().find((project) => project.name === 'شخصی');

    expect(fallbackTask.projectId).toBe(fallbackProject.id);
    expect(explicitTask.projectId).toBe(explicitProject?.id);
    expect(explicitTask.projectId).not.toBe(fallbackProject.id);
    context.store.close();
  });

  it('updates, archives, and restores projects without deleting their tasks', async () => {
    const context = createContext();
    const project = context.store.createProject({ name: 'کاری' });
    const task = context.store.createTask({ title: 'تسک پروژه', projectId: project.id });

    const updateResponse = await handleApiRequest(
      new Request(`http://local/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'کاری ویرایش‌شده' })
      }),
      context
    );
    const archiveResponse = await handleApiRequest(new Request(`http://local/api/projects/${project.id}`, { method: 'DELETE' }), context);
    const activeProjectsResponse = await handleApiRequest(new Request('http://local/api/projects'), context);
    const archivedProjectsResponse = await handleApiRequest(new Request('http://local/api/projects?view=archived'), context);
    const restoreResponse = await handleApiRequest(
      new Request(`http://local/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: false })
      }),
      context
    );

    const updatedProject = await updateResponse.json();
    const archivedProject = await archiveResponse.json();
    const activeProjects = await activeProjectsResponse.json();
    const archivedProjects = await archivedProjectsResponse.json();
    const restoredProject = await restoreResponse.json();

    expect(updatedProject.name).toBe('کاری ویرایش‌شده');
    expect(archivedProject.archivedAt).toEqual(expect.any(String));
    expect(activeProjects.some((item: { id: string }) => item.id === project.id)).toBe(false);
    expect(archivedProjects.some((item: { id: string }) => item.id === project.id)).toBe(true);
    expect(restoredProject.archivedAt).toBeNull();
    expect(context.store.getTask(task.id)?.projectId).toBe(project.id);
    context.store.close();
  });

  it('lists Ollama models and reports when Ollama is unreachable', async () => {
    const context = createContext();
    mockOllama({ models: ['llama3.1:8b', 'qwen3:14b'] });

    const modelsResponse = await handleApiRequest(new Request('http://local/api/assistant/models'), context);
    const modelsPayload = await modelsResponse.json();

    expect(modelsResponse.status).toBe(200);
    expect(modelsPayload.reachable).toBe(true);
    expect(modelsPayload.models.map((model: { name: string }) => model.name)).toEqual(['llama3.1:8b', 'qwen3:14b']);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('connection refused');
      })
    );
    const offlineResponse = await handleApiRequest(new Request('http://local/api/assistant/models'), context);
    const offlinePayload = await offlineResponse.json();

    expect(offlineResponse.status).toBe(200);
    expect(offlinePayload.reachable).toBe(false);
    expect(offlinePayload.models).toEqual([]);
    context.store.close();
  });

  it('saves only installed assistant models', async () => {
    const context = createContext();
    mockOllama({ models: ['llama3.1:8b'] });

    const saveResponse = await handleApiRequest(
      new Request('http://local/api/assistant/settings', {
        method: 'PATCH',
        body: JSON.stringify({ selectedModel: 'llama3.1:8b' })
      }),
      context
    );
    const invalidResponse = await handleApiRequest(
      new Request('http://local/api/assistant/settings', {
        method: 'PATCH',
        body: JSON.stringify({ selectedModel: 'missing:latest' })
      }),
      context
    );

    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toEqual({ selectedModel: 'llama3.1:8b' });
    expect(context.store.getAssistantSettings().selectedModel).toBe('llama3.1:8b');
    expect(invalidResponse.status).toBe(400);
    context.store.close();
  });

  it('plans assistant operations without mutating tasks', async () => {
    const context = createContext();
    context.store.updateAssistantSettings({ selectedModel: 'llama3.1:8b' });
    const beforeCount = context.store.listTasks({ view: 'all' }).length;
    mockOllama({
      plan: {
        reply: 'این تغییرات را پیشنهاد می‌کنم.',
        clarificationQuestion: null,
        operations: [
          {
            id: 'op-1',
            type: 'create_task',
            summary: 'ایجاد تسک آماده‌سازی گزارش',
            task: {
              title: 'آماده‌سازی گزارش',
              projectName: 'کار',
              dueAt: '2026-05-16T09:00:00.000Z',
              priority: 1,
              tagNames: ['گزارش']
            },
            subtasks: [{ title: 'جمع‌آوری داده' }]
          }
        ]
      }
    });

    const response = await handleApiRequest(
      new Request('http://local/api/assistant/plan', {
        method: 'POST',
        body: JSON.stringify({ message: 'برای گزارش فردا یک تسک بساز' })
      }),
      context
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.operations[0].summary).toBe('ایجاد تسک آماده‌سازی گزارش');
    expect(context.store.listTasks({ view: 'all' })).toHaveLength(beforeCount);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/api/chat'))).toBe(true);
    context.store.close();
  });

  it('applies confirmed assistant operations through task APIs', async () => {
    const context = createContext();
    const parent = context.store.createTask({ title: 'گزارش ماهانه' });
    const response = await handleApiRequest(
      new Request('http://local/api/assistant/apply', {
        method: 'POST',
        body: JSON.stringify({
          operations: [
            {
              id: 'op-1',
              type: 'update_task',
              summary: 'اولویت گزارش بالا برود',
              targetTaskId: parent.id,
              patch: { priority: 1, tagNames: ['گزارش'] }
            },
            {
              id: 'op-2',
              type: 'create_subtask',
              summary: 'زیرتسک‌های گزارش ساخته شوند',
              targetTaskId: parent.id,
              subtasks: [{ title: 'جمع‌آوری داده' }, { title: 'بازبینی نهایی' }]
            },
            {
              id: 'op-3',
              type: 'add_comment',
              summary: 'کامنت راهنما اضافه شود',
              targetTaskId: parent.id,
              commentBody: 'پیشنهاد دستیار'
            }
          ]
        })
      }),
      context
    );
    const payload = await response.json();
    const updatedParent = context.store.getTask(parent.id)!;

    expect(response.status).toBe(200);
    expect(payload.applied).toHaveLength(3);
    expect(updatedParent.priority).toBe(1);
    expect(updatedParent.tags.map((tag) => tag.name)).toEqual(['گزارش']);
    expect(updatedParent.subtasks?.map((task) => task.title)).toEqual(['جمع‌آوری داده', 'بازبینی نهایی']);
    expect(updatedParent.comments?.[0].body).toBe('پیشنهاد دستیار');
    context.store.close();
  });

  it('returns assistant clarification questions without operations', async () => {
    const context = createContext();
    context.store.updateAssistantSettings({ selectedModel: 'llama3.1:8b' });
    mockOllama({
      plan: {
        reply: 'ابهام دارم.',
        clarificationQuestion: 'کدام جلسه را تغییر بدهم؟',
        operations: []
      }
    });

    const response = await handleApiRequest(
      new Request('http://local/api/assistant/plan', {
        method: 'POST',
        body: JSON.stringify({ message: 'جلسه را فردا کن' })
      }),
      context
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.clarificationQuestion).toBe('کدام جلسه را تغییر بدهم؟');
    expect(payload.operations).toEqual([]);
    context.store.close();
  });

  it('rejects invalid assistant apply operations before mutation', async () => {
    const context = createContext();
    const beforeTitles = context.store.listTasks({ view: 'all' }).map((task) => task.title);

    const response = await handleApiRequest(
      new Request('http://local/api/assistant/apply', {
        method: 'POST',
        body: JSON.stringify({
          operations: [
            {
              id: 'bad',
              type: 'update_task',
              summary: 'نامعتبر',
              targetTaskId: 'missing-task',
              patch: { title: 'نباید اعمال شود' }
            }
          ]
        })
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(context.store.listTasks({ view: 'all' }).map((task) => task.title)).toEqual(beforeTitles);
    context.store.close();
  });

  it('supports task comments and detail fields', async () => {
    const context = createContext();
    const taskResponse = await handleApiRequest(
      new Request('http://local/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'تسک دارای جزئیات',
          deadlineAt: '2026-05-15T09:00:00.000Z',
          reminderAt: '2026-05-15T08:30:00.000Z'
        })
      }),
      context
    );
    const task = await taskResponse.json();

    const commentResponse = await handleApiRequest(
      new Request(`http://local/api/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: 'یادداشت داخلی' })
      }),
      context
    );

    expect(commentResponse.status).toBe(201);
    expect(context.store.getTask(task.id)?.deadlineAt).toBe('2026-05-15T09:00:00.000Z');
    expect(context.store.getTask(task.id)?.comments?.[0].body).toBe('یادداشت داخلی');
    context.store.close();
  });

  it('supports reschedule, reorder, and saved filter deletion APIs', async () => {
    const context = createContext();
    const first = context.store.createTask({ title: 'اول' });
    const second = context.store.createTask({ title: 'دوم' });
    const filter = context.store.createSavedFilter({ name: 'فوری', criteria: { priorities: [1] } });

    const rescheduleResponse = await handleApiRequest(
      new Request(`http://local/api/tasks/${first.id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ dueAt: '2026-05-16T09:00:00.000Z' })
      }),
      context
    );
    const reorderResponse = await handleApiRequest(
      new Request(`http://local/api/tasks/${second.id}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ beforeId: first.id })
      }),
      context
    );
    const deleteFilterResponse = await handleApiRequest(
      new Request(`http://local/api/saved-filters/${filter.id}`, { method: 'DELETE' }),
      context
    );

    expect(rescheduleResponse.status).toBe(200);
    expect(reorderResponse.status).toBe(200);
    expect(deleteFilterResponse.status).toBe(200);
    expect(context.store.getTask(first.id)?.dueAt).toBe('2026-05-16T09:00:00.000Z');
    expect(context.store.listTasks({ view: 'all' }).map((task) => task.id).indexOf(second.id)).toBeLessThan(
      context.store.listTasks({ view: 'all' }).map((task) => task.id).indexOf(first.id)
    );
    expect(context.store.listSavedFilters().some((item) => item.id === filter.id)).toBe(false);
    context.store.close();
  });

  it('reorders only within the same sibling group', async () => {
    const context = createContext();
    const parent = context.store.createTask({ title: 'والد' });
    const otherParent = context.store.createTask({ title: 'والد دیگر' });
    const first = context.store.createTask({ title: 'اول', parentId: parent.id });
    const second = context.store.createTask({ title: 'دوم', parentId: parent.id });
    const otherChild = context.store.createTask({ title: 'غریبه', parentId: otherParent.id });

    await handleApiRequest(
      new Request(`http://local/api/tasks/${second.id}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ beforeId: first.id })
      }),
      context
    );
    const ignoredResponse = await handleApiRequest(
      new Request(`http://local/api/tasks/${first.id}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ beforeId: otherChild.id })
      }),
      context
    );

    const parentTask = context.store.getTask(parent.id)!;
    expect(parentTask.subtasks?.map((task) => task.id)).toEqual([second.id, first.id]);
    expect((await ignoredResponse.json()).parentId).toBe(parent.id);
    expect(context.store.getTask(otherParent.id)?.subtasks?.[0].id).toBe(otherChild.id);
    context.store.close();
  });

  it('completes open direct subtasks when parent is completed', async () => {
    const context = createContext();
    const parent = context.store.createTask({ title: 'والد' });
    const openChild = context.store.createTask({ title: 'باز', parentId: parent.id });
    const doneChild = context.store.updateTask(context.store.createTask({ title: 'تمام', parentId: parent.id }).id, {
      completed: true
    });

    await handleApiRequest(
      new Request(`http://local/api/tasks/${parent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: true })
      }),
      context
    );
    await handleApiRequest(
      new Request(`http://local/api/tasks/${openChild.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: false })
      }),
      context
    );

    expect(context.store.getTask(parent.id)?.completedAt).not.toBeNull();
    expect(context.store.getTask(openChild.id)?.completedAt).toBeNull();
    expect(context.store.getTask(doneChild.id)?.completedAt).not.toBeNull();
    context.store.close();
  });

  it('lists archived tasks separately, restores them, and keeps them in JSON backup', async () => {
    const context = createContext();
    const active = context.store.createTask({ title: 'فعال' });
    const archived = context.store.deleteTask(context.store.createTask({ title: 'آرشیوی' }).id);

    const archivedResponse = await handleApiRequest(new Request('http://local/api/tasks?view=archived'), context);
    const archivedTasks = await archivedResponse.json();
    const exportResponse = await handleApiRequest(new Request('http://local/api/backup/export'), context);
    const payload = await exportResponse.json();

    expect(context.store.listTasks({ view: 'all' }).some((task) => task.id === active.id)).toBe(true);
    expect(context.store.listTasks({ view: 'all' }).some((task) => task.id === archived.id)).toBe(false);
    expect(archivedTasks.map((task: { id: string }) => task.id)).toContain(archived.id);
    expect(payload.tasks.some((task: { id: string; archivedAt: string | null }) => task.id === archived.id && task.archivedAt)).toBe(
      true
    );

    const restoreResponse = await handleApiRequest(
      new Request(`http://local/api/tasks/${archived.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: false })
      }),
      context
    );
    const restored = await restoreResponse.json();

    expect(restored.archivedAt).toBeNull();
    expect(context.store.listTasks({ view: 'archived' }).some((task) => task.id === archived.id)).toBe(false);
    context.store.close();
  });

  it('exports and imports backup payloads', async () => {
    const context = createContext();
    const exportResponse = await handleApiRequest(new Request('http://local/api/backup/export'), context);
    const payload = await exportResponse.json();

    expect(payload.tasks.length).toBeGreaterThan(0);

    const importResponse = await handleApiRequest(
      new Request('http://local/api/backup/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
      context
    );

    expect(importResponse.status).toBe(200);
    context.store.close();
  });

  it('rejects TASKS_DATA_DIR inside the repository by default', () => {
    expect(() =>
      resolveDataPaths({
        repoRoot: '/repo/karha',
        env: { TASKS_DATA_DIR: '/repo/karha/.local-data' } as NodeJS.ProcessEnv
      })
    ).toThrow(/inside the repository/);
  });

  it('resolves relative TASKS_DATA_DIR from the repository root when explicitly allowed', () => {
    expect(
      resolveDataPaths({
        repoRoot: '/repo/karha',
        env: { TASKS_DATA_DIR: '.local-data', KARHA_ALLOW_REPO_DATA: '1' } as NodeJS.ProcessEnv
      })
    ).toEqual({
      dataDir: '/repo/karha/.local-data',
      dbPath: '/repo/karha/.local-data/karha.sqlite'
    });
  });
});
