import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from './api';
import type {
  AppSettings,
  Habit,
  Project,
  SavedFilter,
  SavedFilterCriteria,
  StatsSummary,
  Tag,
  Task,
  TaskPriority
} from './types';
import { filterTasks } from './lib/filters';
import {
  readCollapsedCompletedSectionKeys,
  readCollapsedTaskIds,
  toggleCollapsedCompletedSectionKey,
  toggleCollapsedTaskId,
  writeCollapsedCompletedSectionKeys,
  writeCollapsedTaskIds
} from './lib/collapseState';
import {
  parsePersianQuickAdd,
  parsePersianQuickDate,
  formatPersianDate,
  formatPersianTime,
  isPastDay,
  isToday,
  toPersianDigits
} from './lib/persianDates';
import { compareTasks, isTaskInToday, isTaskInUpcoming, type SortView } from './lib/taskSort';
import {
  buildTaskTree,
  canReorderTasks,
  flattenTaskTree,
  getEffectiveCollapsedTaskIds,
  getSortableGroupKey,
  type DragSortMode,
  type TaskTreeNode,
  type TaskTreeRow
} from './lib/taskTree';

type ViewKey =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'project'
  | 'label'
  | 'filter'
  | 'calendar'
  | 'eisenhower'
  | 'focus'
  | 'habits'
  | 'stats'
  | 'completed'
  | 'archived';

interface AppState {
  settings: AppSettings | null;
  tasks: Task[];
  archivedTasks: Task[];
  projects: Project[];
  tags: Tag[];
  habits: Habit[];
  savedFilters: SavedFilter[];
  stats: StatsSummary | null;
}

interface UndoState {
  message: string;
  undo: () => Promise<unknown>;
}

type ThemeMode = 'light' | 'dark';

const themeStorageKey = 'karha.theme';

const primaryViews: Array<{ key: ViewKey; label: string }> = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'today', label: 'امروز' },
  { key: 'upcoming', label: 'پیش رو' }
];

const toolViews: Array<{ key: ViewKey; label: string }> = [
  { key: 'calendar', label: 'تقویم' },
  { key: 'eisenhower', label: 'آیزنهاور' },
  { key: 'focus', label: 'فوکوس' },
  { key: 'habits', label: 'عادت ها' },
  { key: 'stats', label: 'آمار' },
  { key: 'completed', label: 'تکمیل شده' },
  { key: 'archived', label: 'آرشیو' }
];

const priorityLabels: Record<TaskPriority, string> = {
  1: 'اولویت ۱',
  2: 'اولویت ۲',
  3: 'اولویت ۳',
  4: 'بدون اولویت'
};

export function App() {
  const [state, setState] = useState<AppState>({
    settings: null,
    tasks: [],
    archivedTasks: [],
    projects: [],
    tags: [],
    habits: [],
    savedFilters: [],
    stats: null
  });
  const [view, setView] = useState<ViewKey>('today');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [quickAdd, setQuickAdd] = useState('');
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [newProject, setNewProject] = useState('');
  const [newFilterName, setNewFilterName] = useState('');
  const [newHabit, setNewHabit] = useState('');
  const [focusTaskId, setFocusTaskId] = useState('');
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goPrefix, setGoPrefix] = useState(false);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => readCollapsedTaskIds());
  const [collapsedCompletedSectionKeys, setCollapsedCompletedSectionKeys] = useState<Set<string>>(() =>
    readCollapsedCompletedSectionKeys()
  );
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => readThemeMode());

  const quickInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const parsedQuickAdd = useMemo(() => parsePersianQuickAdd(quickAdd), [quickAdd]);
  const drawerTask = [...state.tasks, ...state.archivedTasks].find((task) => task.id === drawerTaskId) ?? null;
  const currentSavedFilter = state.savedFilters.find((filter) => filter.id === selectedFilterId) ?? null;

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!focusRunning) return;
    const interval = window.setInterval(() => {
      setFocusSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [focusRunning]);

  useEffect(() => {
    if (focusRunning && focusSeconds === 0) {
      setFocusRunning(false);
      void api
        .createFocusSession({
          taskId: focusTaskId || null,
          plannedMinutes: 25,
          actualMinutes: 25,
          status: 'completed'
        })
        .then(load);
    }
  }, [focusRunning, focusSeconds, focusTaskId]);

  async function load() {
    try {
      const [settings, tasks, archivedTasks, projects, tags, habits, savedFilters, stats] = await Promise.all([
        api.settings(),
        api.tasks('?view=all'),
        api.tasks('?view=archived'),
        api.projects(),
        api.tags(),
        api.habits(),
        api.savedFilters(),
        api.stats()
      ]);
      setState({ settings, tasks, archivedTasks, projects, tags, habits, savedFilters, stats });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'خطا در بارگذاری');
    }
  }

  const matchesCurrentView = useMemo(() => {
    const selectedFilter = state.savedFilters.find((filter) => filter.id === selectedFilterId);
    return (task: Task) => {
      if (view === 'archived') {
        if (!task.archivedAt) return false;
      } else if (task.archivedAt) {
        return false;
      }

      let matchesView = true;

      if (view === 'archived') matchesView = true;
      else if (view === 'completed') matchesView = !!task.completedAt;
      else if (task.completedAt) matchesView = false;
      else if (view === 'inbox') matchesView = !task.projectId;
      else if (view === 'today') matchesView = isTaskInToday(task);
      else if (view === 'upcoming') matchesView = isTaskInUpcoming(task);
      else if (view === 'project') matchesView = task.projectId === selectedProjectId;
      else if (view === 'label') matchesView = task.tags.some((tag) => tag.id === selectedTagId);
      else if (view === 'filter' && selectedFilter) matchesView = filterTasks([task], selectedFilter.criteria).length > 0;

      if (!matchesView) return false;

      if (query.trim()) {
        const needle = query.trim().toLowerCase();
        if (!`${task.title} ${task.notes}`.toLowerCase().includes(needle)) return false;
      }

      return true;
    };
  }, [query, selectedFilterId, selectedProjectId, selectedTagId, state.savedFilters, state.tasks, view]);

  const tasksForCurrentView = view === 'archived' ? state.archivedTasks : state.tasks;
  const sortView: SortView = view === 'today' || view === 'upcoming' || view === 'filter' ? view : 'all';
  const completedSectionKey = getCompletedSectionKey(view, selectedProjectId, selectedTagId);
  const taskTree = useMemo(
    () =>
      buildTaskTree(tasksForCurrentView, matchesCurrentView, (a, b) => compareTasks(a, b, sortView), {
        includeArchived: view === 'archived',
        includeAllChildrenForMatchedParent: !completedSectionKey && view !== 'completed',
        filterChildrenForMatchedParent: completedSectionKey ? (task) => !task.completedAt : undefined
      }),
    [completedSectionKey, matchesCurrentView, sortView, tasksForCurrentView, view]
  );
  const completedSectionCollapsed = completedSectionKey ? collapsedCompletedSectionKeys.has(completedSectionKey) : false;
  const completedTaskTree = useMemo(() => {
    if (!completedSectionKey) return [];
    return buildTaskTree(
      state.tasks,
      (task) =>
        matchesSearch(task, query) &&
        taskMatchesCompletedSection(task, view, selectedProjectId, selectedTagId),
      (a, b) => compareTasks(a, b, sortView),
      { includeAllChildrenForMatchedParent: false }
    );
  }, [completedSectionKey, query, selectedProjectId, selectedTagId, sortView, state.tasks, view]);
  const effectiveCollapsedTaskIds = useMemo(
    () => getEffectiveCollapsedTaskIds(collapsedTaskIds, activeDragTaskId, state.tasks),
    [activeDragTaskId, collapsedTaskIds, state.tasks]
  );
  const taskRows = useMemo(() => flattenTaskTree(taskTree, effectiveCollapsedTaskIds), [effectiveCollapsedTaskIds, taskTree]);
  const focusedTask = taskRows[focusedIndex]?.task ?? null;
  const dragMode: DragSortMode = view === 'today' || view === 'upcoming' || view === 'filter' ? 'smart' : 'manual';

  useEffect(() => {
    setFocusedIndex((index) => Math.min(index, Math.max(taskRows.length - 1, 0)));
  }, [taskRows.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches('input, textarea, select, [contenteditable="true"]');

      if (event.key === '?' && !isTyping) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (isTyping) return;

      if (goPrefix) {
        event.preventDefault();
        setGoPrefix(false);
        if (event.key === 'i') openView('inbox');
        if (event.key === 't') openView('today');
        if (event.key === 'u') openView('upcoming');
        return;
      }

      if (event.key === 'g') {
        event.preventDefault();
        setGoPrefix(true);
        return;
      }

      if (event.key === 'q') {
        event.preventDefault();
        quickInputRef.current?.focus();
      }
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.key === 'ArrowUp' || event.key === 'k') && event.shiftKey && focusedTask) {
        event.preventDefault();
        void moveFocusedTask('up');
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'j') && event.shiftKey && focusedTask) {
        event.preventDefault();
        void moveFocusedTask('down');
        return;
      }
      if (/^[1-4]$/.test(event.key) && focusedTask) {
        event.preventDefault();
        void setPriorityFromShortcut(focusedTask, Number(event.key) as TaskPriority);
        return;
      }
      if (event.key === 'd' && focusedTask) {
        event.preventDefault();
        void rescheduleTaskWithUndo(focusedTask, todayAtNineIso());
        return;
      }
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedIndex((index) => Math.min(index + 1, taskRows.length - 1));
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === 'Enter' && focusedTask) {
        event.preventDefault();
        setDrawerTaskId(focusedTask.id);
      }
      if (event.key === 'x' && focusedTask) {
        event.preventDefault();
        void toggleTaskCompletion(focusedTask);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && focusedTask) {
        event.preventDefault();
        void archiveTask(focusedTask);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedTask, goPrefix, taskRows.length]);

  function openView(nextView: ViewKey) {
    setView(nextView);
    setSelectedProjectId(null);
    setSelectedTagId(null);
    setSelectedFilterId(null);
    setQuery('');
    setFocusedIndex(0);
  }

  function openProject(projectId: string) {
    setView('project');
    setSelectedProjectId(projectId);
    setSelectedTagId(null);
    setSelectedFilterId(null);
    setQuery('');
    setFocusedIndex(0);
  }

  function openTag(tagId: string) {
    setView('label');
    setSelectedTagId(tagId);
    setSelectedProjectId(null);
    setSelectedFilterId(null);
    setQuery('');
    setFocusedIndex(0);
  }

  function openFilter(filterId: string) {
    setView('filter');
    setSelectedFilterId(filterId);
    setSelectedProjectId(null);
    setSelectedTagId(null);
    setQuery('');
    setFocusedIndex(0);
  }

  async function submitQuickAdd(event: FormEvent) {
    event.preventDefault();
    if (!quickAdd.trim()) return;
    const created = await api.quickAdd(quickAdd);
    setQuickAdd('');
    setDrawerTaskId(created.id);
    await load();
  }

  async function completeTask(task: Task) {
    const openSubtaskIds = task.parentId
      ? []
      : state.tasks
          .filter((candidate) => candidate.parentId === task.id && !candidate.completedAt && !candidate.archivedAt)
          .map((candidate) => candidate.id);

    await api.updateTask(task.id, { completed: true });
    setUndo({
      message: openSubtaskIds.length ? 'تسک و زیرتسک ها تکمیل شدند' : 'تسک تکمیل شد',
      undo: async () => {
        await api.updateTask(task.id, { completed: false });
        await Promise.all(openSubtaskIds.map((id) => api.updateTask(id, { completed: false })));
      }
    });
    await load();
  }

  async function toggleTaskCompletion(task: Task) {
    if (!task.completedAt) {
      await completeTask(task);
      return;
    }

    await api.updateTask(task.id, { completed: false });
    setUndo({ message: 'تسک باز شد', undo: () => api.updateTask(task.id, { completed: true }) });
    await load();
  }

  async function archiveTask(task: Task) {
    await api.archiveTask(task.id);
    setDrawerTaskId(null);
    setUndo({ message: 'تسک آرشیو شد', undo: () => api.updateTask(task.id, { archived: false }) });
    await load();
  }

  async function restoreTask(task: Task) {
    await api.updateTask(task.id, { archived: false });
    setDrawerTaskId(null);
    setUndo({ message: 'تسک از آرشیو برگشت', undo: () => api.updateTask(task.id, { archived: true }) });
    await load();
  }

  async function undoLastAction() {
    if (!undo) return;
    const action = undo;
    setUndo(null);
    await action.undo();
    await load();
  }

  async function setPriorityFromShortcut(task: Task, priority: TaskPriority) {
    await api.updateTask(task.id, { priority });
    await load();
  }

  async function rescheduleTaskWithUndo(task: Task, dueAt: string | null) {
    const previousDueAt = task.dueAt;
    const previousStart = task.scheduledStart;
    await api.rescheduleTask(task.id, dueAt);
    setUndo({
      message: 'تاریخ تسک تغییر کرد',
      undo: () => api.updateTask(task.id, { dueAt: previousDueAt, scheduledStart: previousStart })
    });
    await load();
  }

  async function moveFocusedTask(direction: 'up' | 'down') {
    const task = taskRows[focusedIndex]?.task;
    if (!task) return;

    const groupRows = getReorderableRows(task, taskRows, dragMode);
    const indexInGroup = groupRows.findIndex((row) => row.task.id === task.id);
    const nextIndex = direction === 'up' ? indexInGroup - 1 : indexInGroup + 1;
    const overTask = groupRows[nextIndex]?.task;
    if (!overTask) return;

    await reorderTaskWithUndo(task, overTask);
    await load();
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragTaskId(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;

    const activeTask = state.tasks.find((task) => task.id === activeId);
    const overTask = state.tasks.find((task) => task.id === overId);
    if (!activeTask || !overTask) return;

    await reorderTaskWithUndo(activeTask, overTask);
    await load();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragTaskId(String(event.active.id));
  }

  function handleDragCancel() {
    setActiveDragTaskId(null);
  }

  async function reorderTaskWithUndo(activeTask: Task, overTask: Task) {
    if (!canReorderTasks(activeTask, overTask, dragMode)) return;

    const groupRows = getReorderableRows(activeTask, taskRows, dragMode);
    const groupIds = groupRows.map((row) => row.task.id);
    const oldIndex = groupIds.indexOf(activeTask.id);
    const newIndex = groupIds.indexOf(overTask.id);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

    const reordered = arrayMove(groupIds, oldIndex, newIndex);
    const beforeId = reordered[newIndex + 1] ?? null;
    const originalBeforeId = groupIds[oldIndex + 1] ?? null;

    await api.reorderTask(activeTask.id, beforeId);
    setUndo({
      message: 'ترتیب تسک تغییر کرد',
      undo: () => api.reorderTask(activeTask.id, originalBeforeId)
    });

    const newFlatIndex = taskRows.findIndex((row) => row.task.id === overTask.id);
    if (newFlatIndex >= 0) setFocusedIndex(newFlatIndex);
  }

  function toggleCollapsed(taskId: string) {
    setCollapsedTaskIds((current) => {
      const next = toggleCollapsedTaskId(current, taskId);
      writeCollapsedTaskIds(next);
      return next;
    });
  }

  function toggleCompletedSection(sectionKey: string) {
    setCollapsedCompletedSectionKeys((current) => {
      const next = toggleCollapsedCompletedSectionKey(current, sectionKey);
      writeCollapsedCompletedSectionKeys(next);
      return next;
    });
  }

  async function addProject(event: FormEvent) {
    event.preventDefault();
    if (!newProject.trim()) return;
    const project = await api.createProject(newProject);
    setNewProject('');
    openProject(project.id);
    await load();
  }

  async function addSavedFilter(event: FormEvent) {
    event.preventDefault();
    if (!newFilterName.trim()) return;
    const filter = await api.createSavedFilter({
      name: newFilterName,
      color: '#0f766e',
      criteria: {
        view: toFilterView(view),
        text: query || undefined,
        projectId: selectedProjectId ?? undefined,
        tagIds: selectedTagId ? [selectedTagId] : undefined
      }
    });
    setNewFilterName('');
    openFilter(filter.id);
    await load();
  }

  async function addHabit(event: FormEvent) {
    event.preventDefault();
    if (!newHabit.trim()) return;
    await api.createHabit(newHabit);
    setNewHabit('');
    await load();
  }

  async function completeFocusNow() {
    setFocusRunning(false);
    await api.createFocusSession({
      taskId: focusTaskId || null,
      plannedMinutes: 25,
      actualMinutes: Math.max(1, Math.round((25 * 60 - focusSeconds) / 60)),
      status: 'completed'
    });
    setFocusSeconds(25 * 60);
    await load();
  }

  const pageTitle = getPageTitle(view, state, selectedProjectId, selectedTagId, currentSavedFilter);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="ناوبری">
        <div className="brand">
          <div className="brand-mark">ک</div>
          <strong>کارها</strong>
        </div>

        <div className="theme-switch" aria-label="انتخاب تم">
          <button
            className={theme === 'light' ? 'active' : ''}
            type="button"
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            روشن
          </button>
          <button
            className={theme === 'dark' ? 'active' : ''}
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            تیره
          </button>
        </div>

        <form className="quick-capture compact" onSubmit={submitQuickAdd}>
          <input
            ref={quickInputRef}
            value={quickAdd}
            onChange={(event) => setQuickAdd(event.target.value)}
            placeholder="افزودن سریع"
          />
        </form>

        <nav className="nav-list">
          {primaryViews.map((item) => (
            <button
              className={view === item.key ? 'nav-item active' : 'nav-item'}
              key={item.key}
              type="button"
              onClick={() => openView(item.key)}
            >
              <span>{item.label}</span>
              <small>{countForView(item.key, state.tasks)}</small>
            </button>
          ))}
        </nav>

        <section className="sidebar-section">
          <div className="section-title">پروژه ها</div>
          {state.projects.map((project) => (
            <button
              className={view === 'project' && selectedProjectId === project.id ? 'project-row active' : 'project-row'}
              key={project.id}
              type="button"
              onClick={() => openProject(project.id)}
            >
              <span className="dot" style={{ background: project.color }} />
              <span>{project.name}</span>
            </button>
          ))}
          <form className="inline-form" onSubmit={addProject}>
            <input value={newProject} onChange={(event) => setNewProject(event.target.value)} placeholder="پروژه جدید" />
            <button type="submit" aria-label="افزودن پروژه">+</button>
          </form>
        </section>

        <section className="sidebar-section">
          <div className="section-title">فیلترها و برچسب ها</div>
          {state.savedFilters.map((filter) => (
            <button
              className={view === 'filter' && selectedFilterId === filter.id ? 'project-row active' : 'project-row'}
              key={filter.id}
              type="button"
              onClick={() => openFilter(filter.id)}
            >
              <span className="dot" style={{ background: filter.color }} />
              <span>{filter.name}</span>
            </button>
          ))}
          {state.tags.map((tag) => (
            <button
              className={view === 'label' && selectedTagId === tag.id ? 'project-row active' : 'project-row'}
              key={tag.id}
              type="button"
              onClick={() => openTag(tag.id)}
            >
              <span className="dot" style={{ background: tag.color }} />
              <span>@{tag.name}</span>
            </button>
          ))}
          <form className="inline-form" onSubmit={addSavedFilter}>
            <input value={newFilterName} onChange={(event) => setNewFilterName(event.target.value)} placeholder="ذخیره فیلتر فعلی" />
            <button type="submit" aria-label="ذخیره فیلتر">+</button>
          </form>
        </section>

        <details className="tools" open={toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
          <summary>ابزارها</summary>
          <div className="nav-list">
            {toolViews.map((item) => (
              <button
                className={view === item.key ? 'nav-item active' : 'nav-item'}
                key={item.key}
                type="button"
                onClick={() => openView(item.key)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </details>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{pageTitle}</h1>
            <p>{view === 'today' ? 'عقب افتاده ها و کارهای امروز' : getPageHint(view)}</p>
          </div>
          <input
            ref={searchRef}
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جستجو /"
          />
        </header>

        <form className="quick-capture" onSubmit={submitQuickAdd}>
          <input
            value={quickAdd}
            onChange={(event) => setQuickAdd(event.target.value)}
            placeholder="مثلا: ارسال گزارش فردا ساعت ۹ #کار /جلسه @ایمیل !1 هر هفته"
          />
          <button type="submit">افزودن</button>
          <QuickAddChips parsed={parsedQuickAdd} />
        </form>

        {error ? <div className="error">{error}</div> : null}

        {view === 'calendar' ? (
          <CalendarView tasks={state.tasks} />
        ) : view === 'eisenhower' ? (
          <EisenhowerView tasks={state.tasks.filter((task) => !task.completedAt && !task.archivedAt)} />
        ) : view === 'focus' ? (
          <FocusView
            tasks={state.tasks.filter((task) => !task.completedAt && !task.archivedAt)}
            focusTaskId={focusTaskId}
            setFocusTaskId={setFocusTaskId}
            focusSeconds={focusSeconds}
            focusRunning={focusRunning}
            setFocusRunning={setFocusRunning}
            completeFocusNow={completeFocusNow}
          />
        ) : view === 'habits' ? (
          <HabitsView habits={state.habits} addHabit={addHabit} newHabit={newHabit} setNewHabit={setNewHabit} reload={load} />
        ) : view === 'stats' ? (
          <StatsView stats={state.stats} />
        ) : view === 'upcoming' ? (
          <UpcomingList
            groups={groupTaskTreeByPersianDay(taskTree)}
            collapsedTaskIds={effectiveCollapsedTaskIds}
            dragMode={dragMode}
            focusedTaskId={focusedTask?.id ?? null}
            sensors={sensors}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            onDragCancel={handleDragCancel}
            onOpen={setDrawerTaskId}
            onToggleComplete={toggleTaskCompletion}
            onToggleCollapse={toggleCollapsed}
          />
        ) : view === 'archived' ? (
          <TaskList
            nodes={taskTree}
            collapsedTaskIds={effectiveCollapsedTaskIds}
            dragMode={dragMode}
            focusedTaskId={focusedTask?.id ?? null}
            sensors={sensors}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            onDragCancel={handleDragCancel}
            onOpen={setDrawerTaskId}
            onToggleComplete={toggleTaskCompletion}
            onToggleCollapse={toggleCollapsed}
            disableReorder
            completionDisabled
            actionLabel="بازگردانی"
            emptyMessage="آرشیو خالی است."
            onAction={restoreTask}
          />
        ) : (
          <div className="task-list-stack">
            <TaskList
              nodes={taskTree}
              collapsedTaskIds={effectiveCollapsedTaskIds}
              dragMode={dragMode}
              focusedTaskId={focusedTask?.id ?? null}
              sensors={sensors}
              onDragEnd={handleDragEnd}
              onDragStart={handleDragStart}
              onDragCancel={handleDragCancel}
              onOpen={setDrawerTaskId}
              onToggleComplete={toggleTaskCompletion}
              onToggleCollapse={toggleCollapsed}
              emptyMessage={completedTaskTree.length ? null : undefined}
            />
            {completedSectionKey && completedTaskTree.length ? (
              <CompletedSection
                nodes={completedTaskTree}
                collapsed={completedSectionCollapsed}
                collapsedTaskIds={effectiveCollapsedTaskIds}
                dragMode={dragMode}
                focusedTaskId={null}
                sensors={sensors}
                sectionKey={completedSectionKey}
                onDragEnd={handleDragEnd}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onOpen={setDrawerTaskId}
                onToggleComplete={toggleTaskCompletion}
                onToggleCollapse={toggleCollapsed}
                onToggleSection={toggleCompletedSection}
              />
            ) : null}
          </div>
        )}
      </section>

      {drawerTask ? (
        <TaskDrawer
          task={drawerTask}
          projects={state.projects}
          tags={state.tags}
          onClose={() => setDrawerTaskId(null)}
          onSave={async (patch) => {
            await api.updateTask(drawerTask.id, patch);
            await load();
          }}
          onArchive={() => archiveTask(drawerTask)}
          onRestore={() => restoreTask(drawerTask)}
          onCreateSubtask={async (title) => {
            await api.createTask({ title, parentId: drawerTask.id, projectId: drawerTask.projectId, section: drawerTask.section });
            await load();
          }}
          onToggleSubtask={toggleTaskCompletion}
          onAddComment={async (body) => {
            await api.addTaskComment(drawerTask.id, body);
            await load();
          }}
          onCreateTag={async (name) => {
            return api.createTag(name);
          }}
        />
      ) : null}

      {undo ? (
        <div className="undo-toast">
          <span>{undo.message}</span>
          <button type="button" onClick={() => void undoLastAction()}>
            بازگردانی
          </button>
        </div>
      ) : null}

      {shortcutsOpen ? <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} /> : null}
    </main>
  );
}

function QuickAddChips({ parsed }: { parsed: ReturnType<typeof parsePersianQuickAdd> }) {
  if (!parsed.title && !parsed.matchedTokens.length) return null;
  return (
    <div className="quick-chips" aria-label="تحلیل افزودن سریع">
      {parsed.dueAt ? <span>{formatPersianDate(parsed.dueAt)} {formatPersianTime(parsed.dueAt)}</span> : null}
      {parsed.projectName ? <span>#{parsed.projectName}</span> : null}
      {parsed.sectionName ? <span>/{parsed.sectionName}</span> : null}
      {parsed.tagNames.map((tag) => (
        <span key={tag}>@{tag}</span>
      ))}
      {parsed.priority !== 4 ? <span>{priorityLabels[parsed.priority]}</span> : null}
      {parsed.recurrence ? <span>{formatRecurrence(parsed.recurrence.frequency)}</span> : null}
    </div>
  );
}

function TaskList({
  nodes,
  collapsedTaskIds,
  dragMode,
  focusedTaskId,
  sensors,
  onDragEnd,
  onDragStart,
  onDragCancel,
  onOpen,
  onToggleComplete,
  onToggleCollapse,
  disableReorder = false,
  completionDisabled = false,
  emptyMessage = 'اینجا خالی است.',
  actionLabel,
  onAction
}: {
  nodes: TaskTreeNode[];
  collapsedTaskIds: Set<string>;
  dragMode: DragSortMode;
  focusedTaskId: string | null;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => Promise<void>;
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onOpen: (id: string) => void;
  onToggleComplete: (task: Task) => Promise<void>;
  onToggleCollapse: (taskId: string) => void;
  disableReorder?: boolean;
  completionDisabled?: boolean;
  emptyMessage?: string | null;
  actionLabel?: string;
  onAction?: (task: Task) => Promise<void>;
}) {
  if (!nodes.length) return emptyMessage ? <div className="empty-state">{emptyMessage}</div> : null;

  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={(event) => void onDragEnd(event)}
    >
      <section className="task-list" aria-label="تسک ها">
        <TaskTree
          nodes={nodes}
          collapsedTaskIds={collapsedTaskIds}
          dragMode={dragMode}
          focusedTaskId={focusedTaskId}
          onOpen={onOpen}
          onToggleComplete={onToggleComplete}
          onToggleCollapse={onToggleCollapse}
          disableReorder={disableReorder}
          completionDisabled={completionDisabled}
          actionLabel={actionLabel}
          onAction={onAction}
        />
      </section>
    </DndContext>
  );
}

function CompletedSection({
  nodes,
  collapsed,
  collapsedTaskIds,
  dragMode,
  focusedTaskId,
  sensors,
  sectionKey,
  onDragEnd,
  onDragStart,
  onDragCancel,
  onOpen,
  onToggleComplete,
  onToggleCollapse,
  onToggleSection
}: {
  nodes: TaskTreeNode[];
  collapsed: boolean;
  collapsedTaskIds: Set<string>;
  dragMode: DragSortMode;
  focusedTaskId: string | null;
  sensors: ReturnType<typeof useSensors>;
  sectionKey: string;
  onDragEnd: (event: DragEndEvent) => Promise<void>;
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onOpen: (id: string) => void;
  onToggleComplete: (task: Task) => Promise<void>;
  onToggleCollapse: (taskId: string) => void;
  onToggleSection: (sectionKey: string) => void;
}) {
  return (
    <section className="completed-section">
      <button
        className="completed-separator"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggleSection(sectionKey)}
      >
        <span>{collapsed ? '‹' : '⌄'}</span>
        <strong>تکمیل‌شده‌ها ({toPersianDigits(countTasksInTree(nodes))})</strong>
      </button>
      {collapsed ? null : (
        <TaskList
          nodes={nodes}
          collapsedTaskIds={collapsedTaskIds}
          dragMode={dragMode}
          focusedTaskId={focusedTaskId}
          sensors={sensors}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onDragCancel={onDragCancel}
          onOpen={onOpen}
          onToggleComplete={onToggleComplete}
          onToggleCollapse={onToggleCollapse}
          disableReorder
          emptyMessage={null}
        />
      )}
    </section>
  );
}

function UpcomingList({
  groups,
  collapsedTaskIds,
  dragMode,
  focusedTaskId,
  sensors,
  onDragEnd,
  onDragStart,
  onDragCancel,
  onOpen,
  onToggleComplete,
  onToggleCollapse
}: {
  groups: Array<{ key: string; label: string; nodes: TaskTreeNode[] }>;
  collapsedTaskIds: Set<string>;
  dragMode: DragSortMode;
  focusedTaskId: string | null;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => Promise<void>;
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onOpen: (id: string) => void;
  onToggleComplete: (task: Task) => Promise<void>;
  onToggleCollapse: (taskId: string) => void;
}) {
  if (!groups.length) return <div className="empty-state">برنامه آینده خالی است.</div>;
  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={(event) => void onDragEnd(event)}
    >
      <section className="task-list grouped" aria-label="تسک های پیش رو">
        {groups.map((group) => (
          <div className="task-group" key={group.key}>
            <h2>{group.label}</h2>
            <TaskTree nodes={group.nodes} collapsedTaskIds={collapsedTaskIds} dragMode={dragMode} focusedTaskId={focusedTaskId} onOpen={onOpen} onToggleComplete={onToggleComplete} onToggleCollapse={onToggleCollapse} />
          </div>
        ))}
      </section>
    </DndContext>
  );
}

function TaskTree({
  nodes,
  collapsedTaskIds,
  dragMode,
  focusedTaskId,
  onOpen,
  onToggleComplete,
  onToggleCollapse,
  disableReorder = false,
  completionDisabled = false,
  actionLabel,
  onAction
}: {
  nodes: TaskTreeNode[];
  collapsedTaskIds: Set<string>;
  dragMode: DragSortMode;
  focusedTaskId: string | null;
  onOpen: (id: string) => void;
  onToggleComplete: (task: Task) => Promise<void>;
  onToggleCollapse: (taskId: string) => void;
  disableReorder?: boolean;
  completionDisabled?: boolean;
  actionLabel?: string;
  onAction?: (task: Task) => Promise<void>;
}) {
  return (
    <SortableContext items={nodes.map((node) => node.task.id)} strategy={verticalListSortingStrategy}>
      {nodes.map((node) => {
        const collapsed = collapsedTaskIds.has(node.task.id);
        return (
          <div className="task-tree-node" key={node.task.id}>
            <TaskRow
              childCount={node.children.length}
              collapsed={collapsed}
              contextOnly={node.contextOnly}
              depth={0}
              disabled={disableReorder || node.contextOnly}
              dragMode={dragMode}
              focused={node.task.id === focusedTaskId}
              task={node.task}
              onOpen={onOpen}
              onToggleCollapse={onToggleCollapse}
              onToggleComplete={onToggleComplete}
              completionDisabled={completionDisabled}
              actionLabel={actionLabel}
              onAction={onAction}
            />
            {!collapsed && node.children.length ? (
              <SortableContext items={node.children.map((child) => child.id)} strategy={verticalListSortingStrategy}>
                <div className="subtask-list">
                  {node.children.map((child) => (
                    <TaskRow
                      childCount={0}
                      collapsed={false}
                      contextOnly={false}
                      depth={1}
                      disabled={disableReorder}
                      dragMode={dragMode}
                      focused={child.id === focusedTaskId}
                      key={child.id}
                      task={child}
                      onOpen={onOpen}
                      onToggleCollapse={onToggleCollapse}
                      onToggleComplete={onToggleComplete}
                      completionDisabled={completionDisabled}
                      actionLabel={actionLabel}
                      onAction={onAction}
                    />
                  ))}
                </div>
              </SortableContext>
            ) : null}
          </div>
        );
      })}
    </SortableContext>
  );
}

function TaskRow({
  task,
  focused,
  childCount,
  collapsed,
  contextOnly,
  depth,
  disabled,
  dragMode,
  onOpen,
  onToggleCollapse,
  onToggleComplete,
  completionDisabled = false,
  actionLabel,
  onAction
}: {
  task: Task;
  focused: boolean;
  childCount: number;
  collapsed: boolean;
  contextOnly: boolean;
  depth: 0 | 1;
  disabled: boolean;
  dragMode: DragSortMode;
  onOpen: (id: string) => void;
  onToggleCollapse: (taskId: string) => void;
  onToggleComplete: (task: Task) => Promise<void>;
  completionDisabled?: boolean;
  actionLabel?: string;
  onAction?: (task: Task) => Promise<void>;
}) {
  const sortable = useSortable({
    id: task.id,
    data: { group: getSortableGroupKey(task, dragMode), parentId: task.parentId ?? null },
    disabled
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };

  return (
    <article
      className={[
        'task-row',
        focused ? 'focused' : '',
        depth === 1 ? 'subtask-row' : '',
        task.completedAt ? 'done' : '',
        contextOnly ? 'context-row' : '',
        sortable.isDragging ? 'dragging' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      ref={sortable.setNodeRef}
      style={style}
      onClick={() => onOpen(task.id)}
    >
      <button
        className="drag-handle"
        type="button"
        aria-label="جابجایی"
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        ⋮⋮
      </button>
      <button
        className={task.priority <= 2 ? `check p${task.priority}` : 'check'}
        type="button"
        aria-label={task.completedAt ? 'باز کردن' : 'تکمیل'}
        disabled={completionDisabled}
        onClick={(event) => {
          event.stopPropagation();
          if (completionDisabled) return;
          void onToggleComplete(task);
        }}
      />
      <div className="task-main">
        <div className="task-title-line">
          {childCount ? (
            <button
              className="collapse-toggle"
              type="button"
              aria-label={collapsed ? 'نمایش زیرتسک ها' : 'مخفی کردن زیرتسک ها'}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse(task.id);
              }}
            >
              {collapsed ? '‹' : '⌄'}
            </button>
          ) : null}
          <strong>{task.title}</strong>
        </div>
        <div className="task-meta">
          {contextOnly ? <span>زمینه</span> : null}
          {task.projectId ? null : <span>Inbox</span>}
          {task.section ? <span>/{task.section}</span> : null}
          {task.dueAt ? <span className={isPastDay(task.dueAt) ? 'overdue' : ''}>{formatPersianDate(task.dueAt)}</span> : null}
          {task.dueAt ? <span>{formatPersianTime(task.dueAt)}</span> : null}
          {task.tags.map((tag) => (
            <span key={tag.id}>@{tag.name}</span>
          ))}
          {task.subtasks?.length ? <span>{toPersianDigits(task.subtasks.length)} زیرتسک</span> : null}
        </div>
      </div>
      <button
        className="row-action"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (onAction) {
            void onAction(task);
            return;
          }
          onOpen(task.id);
        }}
      >
        {actionLabel ?? 'ویرایش'}
      </button>
    </article>
  );
}

function TaskDrawer({
  task,
  projects,
  tags,
  onClose,
  onSave,
  onArchive,
  onRestore,
  onCreateSubtask,
  onToggleSubtask,
  onAddComment,
  onCreateTag
}: {
  task: Task;
  projects: Project[];
  tags: Tag[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
  onCreateSubtask: (title: string) => Promise<void>;
  onToggleSubtask: (task: Task) => Promise<void>;
  onAddComment: (body: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<Tag>;
}) {
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [comment, setComment] = useState('');
  const [tagName, setTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    if (!subtaskTitle.trim()) return;
    await onCreateSubtask(subtaskTitle);
    setSubtaskTitle('');
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    await onAddComment(comment);
    setComment('');
  }

  async function addTag(event: FormEvent) {
    event.preventDefault();
    if (!tagName.trim()) return;
    const tag = await onCreateTag(tagName.replace(/^@/, ''));
    await onSave({ tagIds: uniqueIds([...task.tags.map((item) => item.id), tag.id]) });
    setTagName('');
  }

  async function removeTag(tagId: string) {
    await onSave({ tagIds: task.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id) });
  }

  async function editTag(event: FormEvent) {
    event.preventDefault();
    if (!editingTagId || !editingTagName.trim()) return;
    const replacement = await onCreateTag(editingTagName.replace(/^@/, ''));
    const tagIds = uniqueIds(task.tags.map((tag) => (tag.id === editingTagId ? replacement.id : tag.id)));
    await onSave({ tagIds });
    setEditingTagId(null);
    setEditingTagName('');
  }

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label="جزئیات تسک">
      <aside className="task-drawer" key={task.id}>
        <header className="drawer-header">
          <button type="button" onClick={onClose} aria-label="بستن">
            ×
          </button>
          {task.archivedAt ? (
            <button className="quiet" type="button" onClick={() => void onRestore()}>
              بازگردانی
            </button>
          ) : (
            <button className="danger quiet" type="button" onClick={() => void onArchive()}>
              آرشیو
            </button>
          )}
        </header>

        <label className="title-input">
          <input defaultValue={task.title} onBlur={(event) => void onSave({ title: event.target.value })} />
        </label>

        <textarea
          className="description"
          defaultValue={task.notes}
          placeholder="توضیح..."
          onBlur={(event) => void onSave({ notes: event.target.value })}
        />

        <div className="drawer-grid">
          <label>
            تاریخ
            <input
              defaultValue={formatEditablePersianDate(task.dueAt)}
              placeholder="امروز ساعت ۹ یا ۱۴۰۵/۰۲/۲۰ ساعت ۹"
              onBlur={(event) => void onSave({ dueAt: parseEditablePersianDate(event.target.value, task.dueAt) })}
            />
          </label>
          <label>
            ددلاین
            <input
              defaultValue={formatEditablePersianDate(task.deadlineAt)}
              placeholder="۱۴۰۵/۰۲/۳۰ ساعت ۱۷"
              onBlur={(event) => void onSave({ deadlineAt: parseEditablePersianDate(event.target.value, task.deadlineAt) })}
            />
          </label>
          <label>
            یادآور
            <input
              defaultValue={formatEditablePersianDate(task.reminderAt)}
              placeholder="فردا ساعت ۸"
              onBlur={(event) => void onSave({ reminderAt: parseEditablePersianDate(event.target.value, task.reminderAt) })}
            />
          </label>
          <label>
            مدت
            <input
              inputMode="numeric"
              defaultValue={task.durationMinutes ?? ''}
              onBlur={(event) => void onSave({ durationMinutes: event.target.value ? Number(event.target.value) : null })}
            />
          </label>
          <label>
            پروژه
            <select value={task.projectId ?? ''} onChange={(event) => void onSave({ projectId: event.target.value || null })}>
              <option value="">Inbox</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            بخش
            <input defaultValue={task.section ?? ''} onBlur={(event) => void onSave({ section: event.target.value || null })} />
          </label>
          <label>
            اولویت
            <select value={task.priority} onChange={(event) => void onSave({ priority: Number(event.target.value) })}>
              {[1, 2, 3, 4].map((priority) => (
                <option value={priority} key={priority}>
                  {priorityLabels[priority as TaskPriority]}
                </option>
              ))}
            </select>
          </label>
          <label>
            تکرار
            <select
              value={task.recurrence?.frequency ?? ''}
              onChange={(event) =>
                void onSave({
                  recurrence: event.target.value ? { frequency: event.target.value, interval: 1 } : null
                })
              }
            >
              <option value="">بدون تکرار</option>
              <option value="daily">هر روز</option>
              <option value="weekly">هر هفته</option>
              <option value="monthly">هر ماه</option>
            </select>
          </label>
        </div>

        <section className="drawer-section">
          <h3>برچسب ها</h3>
          <div className="tag-list">
            {task.tags.map((tag) => (
              editingTagId === tag.id ? (
                <form className="tag-edit-form" key={tag.id} onSubmit={editTag}>
                  <input value={editingTagName} onChange={(event) => setEditingTagName(event.target.value)} />
                  <button type="submit">ذخیره</button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => {
                      setEditingTagId(null);
                      setEditingTagName('');
                    }}
                  >
                    لغو
                  </button>
                </form>
              ) : (
                <span className="tag-chip" key={tag.id}>
                  @{tag.name}
                  <button
                    type="button"
                    aria-label={`ویرایش ${tag.name}`}
                    onClick={() => {
                      setEditingTagId(tag.id);
                      setEditingTagName(tag.name);
                    }}
                  >
                    <svg aria-hidden="true" viewBox="0 0 16 16">
                      <path d="M11.8 2.2a1.4 1.4 0 0 1 2 2L5.4 12.6 2.2 13.8l1.2-3.2 8.4-8.4Z" />
                      <path d="m10.8 3.2 2 2" />
                    </svg>
                  </button>
                  <button type="button" aria-label={`حذف ${tag.name}`} onClick={() => void removeTag(tag.id)}>
                    ×
                  </button>
                </span>
              )
            ))}
            {tags
              .filter((tag) => !task.tags.some((taskTag) => taskTag.id === tag.id))
              .slice(0, 4)
              .map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => void onSave({ tagIds: [...task.tags.map((item) => item.id), tag.id] })}
                >
                  @{tag.name}
                </button>
              ))}
          </div>
          <form className="inline-form wide" onSubmit={addTag}>
            <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="@برچسب جدید" />
            <button type="submit">افزودن</button>
          </form>
        </section>

        <section className="drawer-section">
          <h3>زیرتسک ها</h3>
          {task.subtasks?.map((subtask) => (
            <button
              className={subtask.completedAt ? 'subtask done' : 'subtask'}
              key={subtask.id}
              type="button"
              onClick={() => void onToggleSubtask(subtask)}
            >
              <span className={subtask.priority <= 2 ? `check p${subtask.priority}` : 'check'} />
              <span>{subtask.title}</span>
            </button>
          ))}
          <form className="inline-form wide" onSubmit={addSubtask}>
            <input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="زیرتسک جدید" />
            <button type="submit">افزودن</button>
          </form>
        </section>

        <section className="drawer-section">
          <h3>کامنت و فعالیت</h3>
          {task.comments?.map((item) => (
            <p className="comment" key={item.id}>
              {item.body}
              <small>{formatPersianDate(item.createdAt)} {formatPersianTime(item.createdAt)}</small>
            </p>
          ))}
          <form className="inline-form wide" onSubmit={addComment}>
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="یادداشت فعالیت..." />
            <button type="submit">ثبت</button>
          </form>
        </section>
      </aside>
    </div>
  );
}

function CalendarView({ tasks }: { tasks: Task[] }) {
  const scheduled = tasks.filter((task) => task.dueAt && !task.completedAt && !task.archivedAt);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  });

  return (
    <section className="calendar-board">
      <div className="calendar-grid">
        {days.map((day) => (
          <div className="day-cell" key={day.toISOString()}>
            <strong>{formatPersianDate(day.toISOString(), { weekday: 'short', day: 'numeric' })}</strong>
            {scheduled
              .filter((task) => task.dueAt && sameDay(new Date(task.dueAt), day))
              .map((task) => (
                <span key={task.id}>{task.title}</span>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function EisenhowerView({ tasks }: { tasks: Task[] }) {
  const quadrants = [
    ['urgent-important', 'فوری و مهم'],
    ['not-urgent-important', 'مهم، غیرفوری'],
    ['urgent-not-important', 'فوری، کم اهمیت'],
    ['not-urgent-not-important', 'بعدا']
  ] as const;

  return (
    <section className="matrix">
      {quadrants.map(([key, label]) => (
        <div className="matrix-cell" key={key}>
          <h2>{label}</h2>
          {filterTasks(tasks, { quadrant: key }).map((task) => (
            <p key={task.id}>{task.title}</p>
          ))}
        </div>
      ))}
    </section>
  );
}

function FocusView({
  tasks,
  focusTaskId,
  setFocusTaskId,
  focusSeconds,
  focusRunning,
  setFocusRunning,
  completeFocusNow
}: {
  tasks: Task[];
  focusTaskId: string;
  setFocusTaskId: (id: string) => void;
  focusSeconds: number;
  focusRunning: boolean;
  setFocusRunning: (value: boolean) => void;
  completeFocusNow: () => Promise<void>;
}) {
  const minutes = Math.floor(focusSeconds / 60);
  const seconds = focusSeconds % 60;

  return (
    <section className="focus-panel">
      <div className="timer">{toPersianDigits(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`)}</div>
      <select value={focusTaskId} onChange={(event) => setFocusTaskId(event.target.value)}>
        <option value="">بدون اتصال به تسک</option>
        {tasks.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title}
          </option>
        ))}
      </select>
      <div className="button-row">
        <button type="button" onClick={() => setFocusRunning(!focusRunning)}>
          {focusRunning ? 'توقف' : 'شروع'}
        </button>
        <button type="button" onClick={() => void completeFocusNow()}>
          ثبت جلسه
        </button>
      </div>
    </section>
  );
}

function HabitsView({
  habits,
  addHabit,
  newHabit,
  setNewHabit,
  reload
}: {
  habits: Habit[];
  addHabit: (event: FormEvent) => Promise<void>;
  newHabit: string;
  setNewHabit: (value: string) => void;
  reload: () => Promise<void>;
}) {
  return (
    <section className="habits">
      <form className="inline-form wide" onSubmit={addHabit}>
        <input value={newHabit} onChange={(event) => setNewHabit(event.target.value)} placeholder="عادت جدید" />
        <button type="submit">افزودن</button>
      </form>
      {habits.map((habit) => (
        <article className="habit-row" key={habit.id}>
          <div>
            <strong>{habit.title}</strong>
            <span>{toPersianDigits(habit.logs.length)} ثبت</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              await api.logHabit(habit.id);
              await reload();
            }}
          >
            امروز انجام شد
          </button>
        </article>
      ))}
    </section>
  );
}

function StatsView({ stats }: { stats: StatsSummary | null }) {
  if (!stats) return <div className="empty-state">آمار در حال بارگذاری است.</div>;
  const cards = [
    ['تسک باز', stats.openTasks],
    ['تکمیل امروز', stats.completedToday],
    ['عقب افتاده', stats.overdueTasks],
    ['دقیقه فوکوس', stats.focusMinutesToday],
    ['عادت امروز', `${stats.habitCompletionToday}%`]
  ];

  return (
    <section className="stats-grid">
      {cards.map(([label, value]) => (
        <article className="stat-card" key={label}>
          <span>{label}</span>
          <strong>{toPersianDigits(value)}</strong>
        </article>
      ))}
    </section>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    ['q', 'افزودن سریع'],
    ['/', 'جستجو'],
    ['g سپس t/i/u', 'رفتن به Today / Inbox / Upcoming'],
    ['j / k', 'حرکت بین تسک ها'],
    ['Shift + j/k', 'جابجایی تسک'],
    ['Enter', 'باز کردن drawer'],
    ['1 تا 4', 'تغییر اولویت'],
    ['d', 'زمان بندی برای امروز'],
    ['x', 'تکمیل تسک'],
    ['Delete', 'آرشیو'],
    ['?', 'نمایش میانبرها']
  ];

  return (
    <div className="drawer-backdrop">
      <section className="shortcut-panel">
        <header>
          <h2>میانبرها</h2>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </header>
        {shortcuts.map(([key, label]) => (
          <p key={key}>
            <kbd>{key}</kbd>
            <span>{label}</span>
          </p>
        ))}
      </section>
    </div>
  );
}

function getReorderableRows(task: Task, rows: TaskTreeRow[], mode: DragSortMode): TaskTreeRow[] {
  return rows.filter((row) => !row.contextOnly && canReorderTasks(task, row.task, mode));
}

function groupTaskTreeByPersianDay(nodes: TaskTreeNode[]): Array<{ key: string; label: string; nodes: TaskTreeNode[] }> {
  const groups = new Map<string, TaskTreeNode[]>();
  for (const node of nodes) {
    const key = node.sortTask.dueAt ? startOfDayIso(node.sortTask.dueAt) : 'no-date';
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupedNodes]) => ({
      key,
      label:
        key === 'no-date'
          ? 'بدون تاریخ'
          : new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            }).format(new Date(key)),
      nodes: groupedNodes
    }));
}

function startOfDayIso(isoDate: string): string {
  const date = new Date(isoDate);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function getCompletedSectionKey(view: ViewKey, projectId: string | null, tagId: string | null): string | null {
  if (view === 'today') return 'today';
  if (view === 'project' && projectId) return `project:${projectId}`;
  if (view === 'label' && tagId) return `label:${tagId}`;
  return null;
}

function matchesSearch(task: Task, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || `${task.title} ${task.notes}`.toLowerCase().includes(needle);
}

function taskMatchesCompletedSection(task: Task, view: ViewKey, projectId: string | null, tagId: string | null): boolean {
  if (!task.completedAt || task.archivedAt) return false;
  if (view === 'today') return isPastDay(task.dueAt) || isToday(task.dueAt) || isToday(task.completedAt);
  if (view === 'project') return !!projectId && task.projectId === projectId;
  if (view === 'label') return !!tagId && task.tags.some((tag) => tag.id === tagId);
  return false;
}

function countTasksInTree(nodes: TaskTreeNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count +
      (node.contextOnly || !node.task.completedAt ? 0 : 1) +
      node.children.filter((child) => !!child.completedAt).length,
    0
  );
}

function countForView(view: ViewKey, tasks: Task[]): string {
  const count = tasks.filter((task) => {
    if (view === 'completed') return !!task.completedAt && !task.archivedAt;
    if (task.completedAt || task.archivedAt) return false;
    if (view === 'inbox') return !task.projectId;
    if (view === 'today') return isTaskInToday(task);
    if (view === 'upcoming') return isTaskInUpcoming(task);
    return false;
  }).length;
  return count ? toPersianDigits(count) : '';
}

function getPageTitle(
  view: ViewKey,
  state: AppState,
  projectId: string | null,
  tagId: string | null,
  filter: SavedFilter | null
): string {
  if (view === 'project') return state.projects.find((project) => project.id === projectId)?.name ?? 'پروژه';
  if (view === 'label') return `@${state.tags.find((tag) => tag.id === tagId)?.name ?? 'برچسب'}`;
  if (view === 'filter') return filter?.name ?? 'فیلتر';
  const labels: Record<ViewKey, string> = {
    inbox: 'Inbox',
    today: 'امروز',
    upcoming: 'پیش رو',
    project: 'پروژه',
    label: 'برچسب',
    filter: 'فیلتر',
    calendar: 'تقویم',
    eisenhower: 'آیزنهاور',
    focus: 'فوکوس',
    habits: 'عادت ها',
    stats: 'آمار',
    completed: 'تکمیل شده',
    archived: 'آرشیو'
  };
  return labels[view];
}

function getPageHint(view: ViewKey): string {
  if (view === 'upcoming') return 'گروه بندی شده بر اساس روز';
  if (view === 'inbox') return 'برای capture سریع و بی تصمیم';
  if (view === 'archived') return 'تسک های آرشیوشده و قابل بازگردانی';
  return 'لیست ساده و کم نویز';
}

function toFilterView(view: ViewKey): SavedFilterCriteria['view'] {
  if (view === 'inbox' || view === 'today' || view === 'upcoming' || view === 'completed') return view;
  return 'all';
}

function formatRecurrence(frequency: string): string {
  if (frequency === 'daily') return 'هر روز';
  if (frequency === 'weekly') return 'هر هفته';
  if (frequency === 'monthly') return 'هر ماه';
  return 'تکرار';
}

function todayAtNineIso(): string {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatEditablePersianDate(isoDate: string | null): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  const time = new Intl.DateTimeFormat('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
  return `${jalali} ساعت ${time}`;
}

function parseEditablePersianDate(value: string, fallback: string | null): string | null {
  if (!value.trim()) return null;
  return parsePersianQuickDate(value).dueAt ?? fallback;
}

function readThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'light';
  return localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light';
}
