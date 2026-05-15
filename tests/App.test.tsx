import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-multi-date-picker', async () => {
  const React = await import('react');

  type MockDatePickerProps = {
    render?: (
      value: string,
      openCalendar: () => void,
      handleValueChange: () => void,
      locale: unknown,
      separator: string
    ) => ReactNode;
    onChange?: (date: { toDate: () => Date }) => void;
  };

  return {
    default: function MockDatePicker({ render, onChange }: MockDatePickerProps) {
      const openCalendar = () => {
        onChange?.({
          toDate: () => new Date(2026, 4, 20, 14, 30, 45, 500)
        });
      };

      return React.createElement('span', { 'data-testid': 'mock-date-picker' }, render?.('', openCalendar, () => undefined, {}, '/'));
    }
  };
});

vi.mock('react-multi-date-picker/plugins/time_picker', async () => {
  const React = await import('react');

  return {
    default: function MockTimePicker() {
      return React.createElement('span', { 'data-testid': 'mock-time-picker' });
    }
  };
});

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
const project = { id: 'project-1', name: 'کار', color: '#2563eb', archivedAt: null };
const archivedProject = {
  id: 'project-archived',
  name: 'قدیمی',
  color: '#b45309',
  archivedAt: '2026-05-15T10:00:00.000Z'
};
const pickerDate = new Date(2026, 4, 20, 14, 30, 0, 0);

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

function lastTaskPatchBody(taskId = 'task-1'): string {
  const patches = vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => String(url).includes(`/api/tasks/${taskId}`) && init?.method === 'PATCH');
  return String(patches.at(-1)?.[1]?.body ?? '');
}

function lastQuickAddBody(): string {
  const calls = vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => String(url).includes('/api/tasks/quick-add') && init?.method === 'POST');
  return String(calls.at(-1)?.[1]?.body ?? '');
}

function taskDeleteCalls(taskId = 'task-1'): Array<unknown[]> {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => String(url).includes(`/api/tasks/${taskId}`) && init?.method === 'DELETE');
}

function projectRequestBody(projectId: string, method: string): string {
  const latestCall = projectRequestCalls(projectId, method).at(-1);
  return String(latestCall?.[1]?.body ?? '');
}

function projectRequestCalls(projectId: string, method: string) {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => String(url).includes(`/api/projects/${projectId}`) && init?.method === method);
}

describe('App', () => {
  let tasksResponse: Array<Record<string, unknown>>;
  let archivedTasksResponse: Array<Record<string, unknown>>;
  let projectsResponse: Array<typeof project>;
  let archivedProjectsResponse: Array<typeof archivedProject>;
  let tagsResponse: Array<typeof tag>;

  beforeEach(() => {
    tasksResponse = [task];
    archivedTasksResponse = [];
    projectsResponse = [];
    archivedProjectsResponse = [];
    tagsResponse = [];
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('prompt', vi.fn(() => 'کار ویرایش‌شده'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/settings')) return json(settings);
        if (url.includes('/api/projects?view=archived')) return json(archivedProjectsResponse);
        if (url.includes('/api/projects/') && init?.method === 'PATCH') return json({ ...project, name: 'کار ویرایش‌شده' });
        if (url.includes('/api/projects/') && init?.method === 'DELETE') return json({ ...project, archivedAt: new Date().toISOString() });
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('uses the open project as quick-add context', async () => {
    projectsResponse = [project];

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'کار' }));
    await userEvent.type(screen.getByPlaceholderText(/ارسال گزارش/), 'تسک پروژه');
    await userEvent.click(screen.getByRole('button', { name: 'افزودن' }));

    expect(lastQuickAddBody()).toContain(`"projectId":"${project.id}"`);
  });

  it('edits and archives projects from the sidebar', async () => {
    projectsResponse = [project];

    render(<App />);

    expect(await screen.findByRole('button', { name: 'کار' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ویرایش کار' }));
    expect(prompt).toHaveBeenCalledWith('نام جدید پروژه', 'کار');
    expect(projectRequestBody(project.id, 'PATCH')).toContain('"name":"کار ویرایش‌شده"');

    await userEvent.click(screen.getByRole('button', { name: 'آرشیو کار' }));
    expect(confirm).toHaveBeenCalledWith('پروژه «کار» آرشیو شود؟ تسک‌های داخل پروژه حذف نمی‌شوند.');
    expect(projectRequestCalls(project.id, 'DELETE')).toHaveLength(1);
  });

  it('shows archived projects and restores them', async () => {
    archivedProjectsResponse = [archivedProject];

    render(<App />);

    await userEvent.click(await screen.findByText('پروژه‌های آرشیوشده'));
    await userEvent.click(screen.getByRole('button', { name: 'بازگردانی قدیمی' }));

    expect(projectRequestBody(archivedProject.id, 'PATCH')).toContain('"archived":false');
  });

  it('clarifies task duration and section fields in the drawer', async () => {
    const { container } = render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));

    expect(screen.getByLabelText('مدت زمان به دقیقه')).toHaveAttribute('placeholder', 'مثلاً ۳۰');
    expect(screen.getByRole('button', { name: 'عدد را به دقیقه وارد کنید؛ برای برآورد زمان انجام تسک.' })).toBeInTheDocument();
    expect(screen.getByLabelText('بخش پروژه')).toHaveAttribute('placeholder', 'مثلاً جلسه یا بک‌لاگ');
    expect(
      screen.getByRole('button', { name: 'گروه‌بندی داخل همان پروژه؛ در افزودن سریع با /بخش هم تنظیم می‌شود.' })
    ).toBeInTheDocument();
    expect(container.querySelector('.field-hint')).toBeNull();
  });

  it('closes the task drawer when clicking outside it', async () => {
    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));

    const dialog = screen.getByRole('dialog', { name: 'جزئیات تسک' });
    await userEvent.click(screen.getByDisplayValue('مرور برنامه امروز'));

    expect(screen.getByRole('dialog', { name: 'جزئیات تسک' })).toBeInTheDocument();

    await userEvent.click(dialog);

    expect(screen.queryByRole('dialog', { name: 'جزئیات تسک' })).not.toBeInTheDocument();
  });

  it('asks for confirmation before archiving a task', async () => {
    vi.mocked(confirm).mockReturnValue(false);

    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'جزئیات تسک' })).getByRole('button', { name: 'آرشیو' }));

    expect(confirm).toHaveBeenCalledWith('این تسک آرشیو شود؟');
    expect(taskDeleteCalls()).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'جزئیات تسک' })).toBeInTheDocument();
  });

  it('archives a task after confirmation', async () => {
    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'جزئیات تسک' })).getByRole('button', { name: 'آرشیو' }));

    expect(confirm).toHaveBeenCalledWith('این تسک آرشیو شود؟');
    expect(taskDeleteCalls()).toHaveLength(1);
  });

  it('dismisses undo notifications after a few seconds', async () => {
    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));

    vi.useFakeTimers();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'جزئیات تسک' })).getByRole('button', { name: 'آرشیو' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('تسک آرشیو شد')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText('تسک آرشیو شد')).not.toBeInTheDocument();
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

  it('sets an empty due date from the Persian date/time picker with a 09:00 default', async () => {
    tasksResponse = [{ ...task, dueAt: null }];

    render(<App />);

    expect(await screen.findByText('کارها')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Inbox/ }));
    await userEvent.click(await screen.findByText('مرور برنامه امروز'));
    await userEvent.click(screen.getByRole('button', { name: 'انتخاب تاریخ' }));

    const expectedIso = new Date(2026, 4, 20, 9, 0, 0, 0).toISOString();
    await waitFor(() => {
      expect(lastTaskPatchBody()).toContain(`"dueAt":"${expectedIso}"`);
    });
  });

  it.each([
    { label: 'ددلاین', field: 'deadlineAt' },
    { label: 'یادآور', field: 'reminderAt' }
  ])('updates $label from the Persian date/time picker', async ({ label, field }) => {
    tasksResponse = [
      {
        ...task,
        deadlineAt: '2026-05-15T09:00:00.000Z',
        reminderAt: '2026-05-15T08:30:00.000Z'
      }
    ];

    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));
    await userEvent.click(screen.getByRole('button', { name: `انتخاب ${label}` }));

    await waitFor(() => {
      expect(lastTaskPatchBody()).toContain(`"${field}":"${pickerDate.toISOString()}"`);
    });
  });

  it('clears a date field from the drawer control', async () => {
    tasksResponse = [{ ...task, reminderAt: '2026-05-15T08:30:00.000Z' }];

    render(<App />);

    await userEvent.click(await screen.findByText('مرور برنامه امروز'));
    await userEvent.click(screen.getByRole('button', { name: 'پاک کردن یادآور' }));

    await waitFor(() => {
      expect(lastTaskPatchBody()).toContain('"reminderAt":null');
    });
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
