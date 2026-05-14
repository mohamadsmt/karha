import type { Task } from '../types';

export type DragSortMode = 'manual' | 'smart';

export interface TaskTreeNode {
  task: Task;
  children: Task[];
  parentMatches: boolean;
  contextOnly: boolean;
  sortTask: Task;
}

export interface TaskTreeRow {
  task: Task;
  depth: 0 | 1;
  contextOnly: boolean;
  childCount: number;
}

export function buildTaskTree(
  tasks: Task[],
  matchesTask: (task: Task) => boolean,
  compareTask: (a: Task, b: Task) => number,
  options: {
    includeArchived?: boolean;
    includeAllChildrenForMatchedParent?: boolean;
    filterChildrenForMatchedParent?: (task: Task) => boolean;
  } = {}
): TaskTreeNode[] {
  const usableTasks = options.includeArchived ? tasks : tasks.filter((task) => !task.archivedAt);
  const byId = new Map(usableTasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, Task[]>();

  for (const task of usableTasks) {
    if (!task.parentId) continue;
    childrenByParent.set(task.parentId, [...(childrenByParent.get(task.parentId) ?? []), task]);
  }

  for (const [parentId, children] of childrenByParent) {
    childrenByParent.set(parentId, [...children].sort(compareTask));
  }

  const topLevelIds = new Set<string>();
  for (const task of usableTasks) {
    if (!task.parentId && matchesTask(task)) {
      topLevelIds.add(task.id);
      continue;
    }

    if (task.parentId && matchesTask(task)) {
      const parent = byId.get(task.parentId);
      if (parent && !parent.parentId) topLevelIds.add(parent.id);
    }
  }

  return usableTasks
    .filter((task) => !task.parentId && topLevelIds.has(task.id))
    .map((task) => {
      const children = childrenByParent.get(task.id) ?? [];
      const parentMatches = matchesTask(task);
      const visibleChildren =
        parentMatches && options.filterChildrenForMatchedParent
          ? children.filter(options.filterChildrenForMatchedParent)
          : parentMatches && options.includeAllChildrenForMatchedParent !== false
            ? children
            : children.filter(matchesTask);
      return {
        task,
        children: visibleChildren,
        parentMatches,
        contextOnly: !parentMatches,
        sortTask: parentMatches ? task : visibleChildren[0] ?? task
      };
    })
    .sort((a, b) => compareTask(a.sortTask, b.sortTask));
}

export function flattenTaskTree(nodes: TaskTreeNode[], collapsedTaskIds: Set<string>): TaskTreeRow[] {
  return nodes.flatMap((node) => {
    const parentRow: TaskTreeRow = {
      task: node.task,
      depth: 0,
      contextOnly: node.contextOnly,
      childCount: node.children.length
    };

    if (collapsedTaskIds.has(node.task.id)) return [parentRow];

    return [
      parentRow,
      ...node.children.map((child) => ({
        task: child,
        depth: 1 as const,
        contextOnly: false,
        childCount: 0
      }))
    ];
  });
}

export function getEffectiveCollapsedTaskIds(
  collapsedTaskIds: Set<string>,
  activeTaskId: string | null,
  tasks: Task[]
): Set<string> {
  if (!activeTaskId || !tasks.some((task) => task.parentId === activeTaskId && !task.archivedAt)) {
    return collapsedTaskIds;
  }

  return new Set([...collapsedTaskIds, activeTaskId]);
}

export function canReorderTasks(active: Task, over: Task, mode: DragSortMode): boolean {
  if ((active.parentId ?? null) !== (over.parentId ?? null)) return false;
  if (mode === 'manual') return true;
  return getSmartSortBucket(active) === getSmartSortBucket(over);
}

export function getSortableGroupKey(task: Task, mode: DragSortMode): string {
  const parentKey = task.parentId ?? 'root';
  return mode === 'manual' ? parentKey : `${parentKey}:${getSmartSortBucket(task)}`;
}

function getSmartSortBucket(task: Task): string {
  return `${task.dueAt ?? 'no-date'}:${task.priority}`;
}
