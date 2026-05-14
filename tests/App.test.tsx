import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const settings = {
  appName: 'کارها',
  dataDir: '/private/tmp/karha',
  dbPath: '/private/tmp/karha/karha.sqlite',
  locale: 'fa-IR',
  calendar: 'persian',
  notifications: 'browser-only'
};

const task = {
  id: 'task-1',
  title: 'مرور برنامه امروز',
  notes: '',
  completedAt: null,
  archivedAt: null,
  projectId: null,
  section: null,
  parentId: null,
  dueAt: new Date().toISOString(),
  deadlineAt: null,
  reminderAt: null,
  scheduledStart: null,
  durationMinutes: null,
  priority: 2,
  energy: 'normal',
  recurrence: null,
  orderIndex: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
  subtasks: [],
  comments: []
};

const tag = { id: 'tag-1', name: 'خانه', color: '#0f766e' };
const renamedTag = { id: 'tag-2', name: 'کار', color: '#0f766e' };
const project = { id: 'project-1', name: 'کار', color: '#2563eb' };

const openSubtask = {
  ...task,
  id: 'subtask-1',
  title: 'زیرتسک باز',
  parentId: 'task-1',
  dueAt: null,
  priority: 4,
  orderIndex: 2,
  subtasks: []
};

const completedSubtask = {
  ...task,
  id: 'subtask-2',
  title: 'زیرتسک انجام شده',
  completedAt: new Date().toISOString(),
  parentId: 'task-1',
  dueAt: null,
  priority: 4,
  orderIndex: 3,
  subtasks: []
};

describe('App', () => {
  let tasksResponse: Array<Record<string, unknown>>;
  let archivedTasksResponse: Array<Record<string, unknown>>;
  let projectsResponse: Array<typeof project>;
  let tagsResponse: Array<typeof tag>;

  beforeEach(() => {
    tasksResponse = [task];
    archivedTasksResponse = [];
    projectsResponse = [];
    tagsResponse = [];
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/settings')) return json(settings);
        if (url.includes('/api/projects')) return json(projectsResponse);
        if (url.includes('/api/tags') && init?.method === 'POST') return json(renamedTag);
        if (url.includes('/api/tags')) return json(tagsResponse);
        if (url.includes('/api/saved-filters')) return json([]);
        if (url.includes('/api/habits')) return json([]);
        if (url.includes('/api/stats')) {
          return json({
            openTasks: 1,
            completedToday: 0,
            overdueTasks: 0,
            focusMinutesToday: 0,
            habitCompletionToday: 0,
            byPriority: { 1: 0, 2: 1, 3: 0, 4: 0 },
            byProject: []
          });
        }
        if (url.includes('/api/tasks/quick-add') && init?.method === 'POST') return json({ ...task, title: 'تسک جدید' });
        if (url.includes('/api/tasks?view=archived')) return json(archivedTasksResponse);
        if (url.includes('/api/tasks') && init?.method === 'PATCH') return json({ ...task, completedAt: new Date().toISOString() });
        if (url.includes('/api/tasks')) return json(tasksResponse);
        return json({});
      })
    );
  });

  it('renders the Persian RTL task surface and quick-add flow', async () => {
    render(<App />);
    expect(await screen.findByText('کارها')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'امروز' })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/ارسال گزارش/), 'تسک جدید فردا #کار /جلسه @ایمیل !1 هر روز');

    expect(screen.getByText('#کار')).toBeInTheDocument();
    expect(screen.getByText('/جلسه')).toBeInTheDocument();
    expect(screen.getByText('@ایمیل')).toBeInTheDocument();
    expect(screen.getByText('اولویت ۱')).toBeInTheDocument();
    expect(screen.getByText('هر روز')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'افزودن' }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/quick-add'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('opens the keyboard shortcut overlay', async () => {
    render(<App />);
    expect(await screen.findByText('کارها')).toBeInTheDocument();

    await userEvent.keyboard('?');

    expect(screen.getByRole('heading', { name: 'میانبرها' })).toBeInTheDocument();
    expect(screen.getByText('تغییر اولویت')).toBeInTheDocument();
  });

  it('switches and persists the dark theme', async () => {
    render(<App />);
    expect(await screen.findByText('کارها')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'تیره' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('karha.theme')).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'روشن' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('renders collapsible subtasks under the parent row', async () => {
    tasksResponse = [{ ...task, subtasks: [openSubtask, completedSubtask] }, openSubtask, completedSubtask];

    render(<App />);

    expect(await screen.findByText('زیرتسک باز')).toBeInTheDocument();
    expect(screen.getByText('زیرتسک انجام شده')).toBeInTheDocument();
    expect(screen.getByText('تکمیل‌شده‌ها (۱)')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'مخفی کردن زیرتسک ها' })[0]);

    expect(screen.queryByText('زیرتسک باز')).not.toBeInTheDocument();
    expect(localStorage.getItem('karha.collapsedSubtasks')).toContain('task-1');

    await userEvent.click(screen.getAllByRole('button', { name: 'نمایش زیرتسک ها' })[0]);
    expect(screen.getByText('زیرتسک باز')).toBeInTheDocument();
  });

  it('shows today completed tasks under a collapsible completed separator', async () => {
    const now = new Date().toISOString();
    tasksResponse = [
      task,
      { ...task, id: 'done-due-today', title: 'کامل با موعد امروز', completedAt: now, dueAt: now },
      { ...task, id: 'done-today', title: 'کامل شده امروز', completedAt: now, dueAt: null }
    ];

    render(<App />);

    expect(await screen.findByText('مرور برنامه امروز')).toBeInTheDocument();
    expect(screen.getByText('تکمیل‌شده‌ها (۲)')).toBeInTheDocument();
    expect(screen.getByText('کامل با موعد امروز')).toBeInTheDocument();
    expect(screen.getByText('کامل شده امروز')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '⌄ تکمیل‌شده‌ها (۲)' }));

    expect(screen.queryByText('کامل با موعد امروز')).not.toBeInTheDocument();
    expect(localStorage.getItem('karha.collapsedCompletedSections')).toContain('today');
  });

  it('shows project and tag completed tasks under their own separators', async () => {
    projectsResponse = [project];
    tagsResponse = [tag];
    tasksResponse = [
      { ...task, id: 'open-project', title: 'باز پروژه', projectId: project.id, dueAt: null },
      { ...task, id: 'done-project', title: 'کامل پروژه', projectId: project.id, completedAt: new Date().toISOString(), dueAt: null },
      { ...task, id: 'done-tag', title: 'کامل برچسب', completedAt: new Date().toISOString(), dueAt: null, tags: [tag] }
    ];

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'کار' }));
    expect(screen.getByText('تکمیل‌شده‌ها (۱)')).toBeInTheDocument();
    expect(screen.getByText('کامل پروژه')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '⌄ تکمیل‌شده‌ها (۱)' }));
    expect(localStorage.getItem('karha.collapsedCompletedSections')).toContain(`project:${project.id}`);

    await userEvent.click(screen.getByRole('button', { name: '@خانه' }));
    expect(screen.getByText('کامل برچسب')).toBeInTheDocument();
  });

  it('shows archived tasks under tools and restores them from the row action', async () => {
    archivedTasksResponse = [
      { ...task, id: 'archived-task', title: 'تسک آرشیوی', archivedAt: new Date().toISOString(), dueAt: null }
    ];

    render(<App />);

    expect(await screen.findByText('کارها')).toBeInTheDocument();
    await userEvent.click(screen.getByText('ابزارها'));
    await userEvent.click(screen.getByRole('button', { name: 'آرشیو' }));

    const archivedRow = screen.getByText('تسک آرشیوی').closest('article');
    expect(archivedRow).not.toBeNull();

    await userEvent.click(within(archivedRow!).getByRole('button', { name: 'بازگردانی' }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/archived-task'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"archived":false')
      })
    );
  });

  it('toggles a subtask from the list', async () => {
    tasksResponse = [{ ...task, subtasks: [openSubtask] }, openSubtask];

    render(<App />);

    const subtaskRow = (await screen.findByText('زیرتسک باز')).closest('article');
    expect(subtaskRow).not.toBeNull();

    await userEvent.click(within(subtaskRow!).getByRole('button', { name: 'تکمیل' }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/subtask-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"completed":true')
      })
    );
  });

  it('removes and edits tags on a task from the drawer', async () => {
    tagsResponse = [tag];
    tasksResponse = [{ ...task, tags: [tag] }];

    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));
    await userEvent.click(screen.getByRole('button', { name: 'حذف خانه' }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/task-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"tagIds":[]')
      })
    );

    await userEvent.click(screen.getByRole('button', { name: 'ویرایش خانه' }));
    const input = screen.getByDisplayValue('خانه');
    await userEvent.clear(input);
    await userEvent.type(input, 'کار');
    await userEvent.click(screen.getByRole('button', { name: 'ذخیره' }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tags'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"کار"')
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/task-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"tagIds":["tag-2"]')
      })
    );
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
