import type {
  AssistantApplyResponse,
  AssistantModel,
  AssistantOperation,
  AssistantOperationType,
  AssistantPlanResponse,
  AssistantTaskDraft,
  RecurrenceRule,
  Task,
  TaskComment,
  TaskPriority
} from '../src/types';
import type { CreateTaskInput, KarhaDatabase, UpdateTaskInput } from './database';

const defaultOllamaBaseUrl = 'http://127.0.0.1:11434';

const operationTypes = new Set<AssistantOperationType>([
  'create_task',
  'update_task',
  'create_subtask',
  'add_comment',
  'complete_task',
  'reopen_task'
]);

const recurrenceFrequencies = new Set(['daily', 'weekly', 'monthly']);
const energyValues = new Set(['low', 'normal', 'high']);
const taskDraftFields = new Set([
  'title',
  'notes',
  'projectName',
  'section',
  'dueAt',
  'deadlineAt',
  'reminderAt',
  'scheduledStart',
  'durationMinutes',
  'priority',
  'energy',
  'recurrence',
  'tagNames',
  'completed'
]);
const operationFields = new Set(['id', 'type', 'summary', 'targetTaskId', 'task', 'patch', 'commentBody', 'subtasks']);
const dateFields = ['dueAt', 'deadlineAt', 'reminderAt', 'scheduledStart'] as const;

type FetchFn = typeof fetch;

interface OllamaOptions {
  baseUrl?: string;
  fetchImpl?: FetchFn;
}

interface OllamaModelResponse {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  response?: string;
}

export class AssistantRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function listOllamaModels(options: OllamaOptions = {}): Promise<AssistantModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${resolveOllamaBaseUrl(options.baseUrl)}/api/tags`);

  if (!response.ok) {
    throw new AssistantRequestError(502, `Ollama پاسخ معتبر نداد: ${response.status}`);
  }

  const payload = (await response.json()) as OllamaModelResponse;
  return (payload.models ?? [])
    .filter((model) => model.name || model.model)
    .map((model) => ({
      name: model.name ?? model.model ?? '',
      model: model.model ?? model.name ?? '',
      size: typeof model.size === 'number' ? model.size : null,
      modifiedAt: model.modified_at ?? null,
      family: model.details?.family ?? null,
      parameterSize: model.details?.parameter_size ?? null,
      quantizationLevel: model.details?.quantization_level ?? null
    }));
}

export async function assertModelAvailable(modelName: string, options: OllamaOptions = {}): Promise<void> {
  const models = await listOllamaModels(options);
  if (!models.some((model) => model.name === modelName || model.model === modelName)) {
    throw new AssistantRequestError(400, 'مدل انتخاب‌شده در Ollama نصب نیست.');
  }
}

export async function generateAssistantPlan({
  store,
  message,
  model,
  baseUrl,
  fetchImpl
}: {
  store: KarhaDatabase;
  message: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: FetchFn;
}): Promise<AssistantPlanResponse> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new AssistantRequestError(400, 'پیام دستیار خالی است.');

  const fetchToUse = fetchImpl ?? fetch;
  const response = await fetchToUse(`${resolveOllamaBaseUrl(baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: assistantPlanSchema,
      options: { temperature: 0.1 },
      messages: [
        { role: 'system', content: assistantSystemPrompt() },
        { role: 'user', content: assistantUserPrompt(store, trimmedMessage) }
      ]
    })
  });

  if (!response.ok) {
    throw new AssistantRequestError(502, `Ollama برنامه دستیار را نساخت: ${response.status}`);
  }

  const payload = (await response.json()) as OllamaChatResponse;
  const content = payload.message?.content ?? payload.response ?? '';
  const parsed = parseAssistantPlanContent(content);
  return normalizeAssistantPlan(parsed, store);
}

export function applyAssistantOperations(store: KarhaDatabase, operations: AssistantOperation[]): AssistantApplyResponse {
  const normalized = normalizeAssistantPlan({ reply: '', clarificationQuestion: null, operations }, store).operations;
  const applied: AssistantApplyResponse['applied'] = [];

  store.db.exec('BEGIN');
  try {
    for (const operation of normalized) {
      if (operation.type === 'create_task') {
        const task = store.createTask(createInputFromDraft(store, operation.task!, {}));
        const createdSubtasks = createSubtasks(store, task, operation.subtasks ?? []);
        applied.push({ operationId: operation.id, task, tasks: createdSubtasks.length ? [task, ...createdSubtasks] : [task] });
        continue;
      }

      if (operation.type === 'update_task') {
        const task = store.updateTask(operation.targetTaskId!, updateInputFromDraft(store, operation.patch!));
        applied.push({ operationId: operation.id, task });
        continue;
      }

      if (operation.type === 'create_subtask') {
        const parent = requireTask(store, operation.targetTaskId!);
        const drafts = operation.subtasks?.length ? operation.subtasks : [operation.task!];
        const tasks = createSubtasks(store, parent, drafts);
        applied.push({ operationId: operation.id, task: tasks[0], tasks });
        continue;
      }

      if (operation.type === 'add_comment') {
        const comment = store.createTaskComment(operation.targetTaskId!, operation.commentBody!);
        applied.push({ operationId: operation.id, comment });
        continue;
      }

      if (operation.type === 'complete_task' || operation.type === 'reopen_task') {
        const task = store.updateTask(operation.targetTaskId!, { completed: operation.type === 'complete_task' });
        applied.push({ operationId: operation.id, task });
      }
    }

    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }

  return { ok: true, applied };
}

function createSubtasks(store: KarhaDatabase, parent: Task, drafts: AssistantTaskDraft[]): Task[] {
  return drafts.map((draft) =>
    store.createTask(
      createInputFromDraft(store, draft, {
        parentId: parent.id,
        projectId: parent.projectId,
        section: parent.section
      })
    )
  );
}

function normalizeAssistantPlan(value: unknown, store: KarhaDatabase): AssistantPlanResponse {
  if (!isRecord(value)) throw new AssistantRequestError(502, 'خروجی دستیار JSON معتبر نبود.');
  const operationsValue = value.operations;
  const operations = Array.isArray(operationsValue)
    ? operationsValue.map((operation, index) => normalizeOperation(operation, index, store))
    : [];

  return {
    reply: typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : 'پیشنهاد آماده است.',
    clarificationQuestion:
      typeof value.clarificationQuestion === 'string' && value.clarificationQuestion.trim()
        ? value.clarificationQuestion.trim()
        : null,
    operations
  };
}

function normalizeOperation(value: unknown, index: number, store: KarhaDatabase): AssistantOperation {
  if (!isRecord(value)) throw new AssistantRequestError(502, 'یکی از عملیات دستیار ساختار معتبر ندارد.');
  assertNoUnknownKeys(value, operationFields, 'operation');

  const type = readOperationType(value.type);
  const operation: AssistantOperation = {
    id: readOptionalString(value.id) ?? `op-${index + 1}`,
    type,
    summary: readOptionalString(value.summary) ?? defaultOperationSummary(type)
  };

  if (value.targetTaskId !== undefined) {
    const targetTaskId = readNullableString(value.targetTaskId, 'targetTaskId');
    if (targetTaskId) operation.targetTaskId = targetTaskId;
  }

  if (value.task !== undefined && value.task !== null) {
    operation.task = sanitizeTaskDraft(value.task, type === 'create_task' || type === 'create_subtask');
  }
  if (value.patch !== undefined && value.patch !== null) {
    operation.patch = sanitizeTaskDraft(value.patch, false);
  }
  if (value.commentBody !== undefined && value.commentBody !== null) {
    operation.commentBody = readRequiredString(value.commentBody, 'commentBody');
  }
  if (value.subtasks !== undefined && value.subtasks !== null) {
    if (!Array.isArray(value.subtasks)) throw new AssistantRequestError(502, 'subtasks باید آرایه باشد.');
    operation.subtasks = value.subtasks.map((draft) => sanitizeTaskDraft(draft, true));
  }

  validateOperation(operation, store);
  return operation;
}

function validateOperation(operation: AssistantOperation, store: KarhaDatabase): void {
  if (operation.type === 'create_task') {
    if (!operation.task?.title) throw new AssistantRequestError(502, 'عملیات ایجاد تسک عنوان ندارد.');
    return;
  }

  if (!operation.targetTaskId) throw new AssistantRequestError(502, 'عملیات روی تسک موجود targetTaskId ندارد.');
  requireTask(store, operation.targetTaskId);

  if (operation.type === 'update_task') {
    if (!operation.patch || Object.keys(operation.patch).length === 0) {
      throw new AssistantRequestError(502, 'عملیات ویرایش تسک patch ندارد.');
    }
    return;
  }

  if (operation.type === 'create_subtask') {
    const hasOneTask = !!operation.task?.title;
    const hasSubtasks = !!operation.subtasks?.length;
    if (!hasOneTask && !hasSubtasks) throw new AssistantRequestError(502, 'عملیات زیرتسک عنوان ندارد.');
    return;
  }

  if (operation.type === 'add_comment' && !operation.commentBody?.trim()) {
    throw new AssistantRequestError(502, 'عملیات کامنت متن ندارد.');
  }
}

function sanitizeTaskDraft(value: unknown, requiresTitle: boolean): AssistantTaskDraft {
  if (!isRecord(value)) throw new AssistantRequestError(502, 'task یا patch ساختار معتبر ندارد.');
  assertNoUnknownKeys(value, taskDraftFields, 'task');

  const draft: AssistantTaskDraft = {};
  if (value.title !== undefined) draft.title = readRequiredString(value.title, 'title');
  if (requiresTitle && !draft.title) throw new AssistantRequestError(502, 'عنوان تسک الزامی است.');
  if (value.notes !== undefined && value.notes !== null) draft.notes = readRequiredString(value.notes, 'notes');
  if (value.projectName !== undefined) draft.projectName = readNullableString(value.projectName, 'projectName');
  if (value.section !== undefined) draft.section = readNullableString(value.section, 'section');

  for (const field of dateFields) {
    if (value[field] !== undefined) draft[field] = readNullableIso(value[field], field);
  }

  if (value.durationMinutes !== undefined) {
    draft.durationMinutes = readNullableDuration(value.durationMinutes);
  }
  if (value.priority !== undefined) draft.priority = readPriority(value.priority);
  if (value.energy !== undefined) draft.energy = readEnergy(value.energy);
  if (value.recurrence !== undefined) draft.recurrence = readNullableRecurrence(value.recurrence);
  if (value.tagNames !== undefined) draft.tagNames = readTagNames(value.tagNames);
  if (value.completed !== undefined) {
    if (typeof value.completed !== 'boolean') throw new AssistantRequestError(502, 'completed باید boolean باشد.');
    draft.completed = value.completed;
  }

  return draft;
}

function createInputFromDraft(
  store: KarhaDatabase,
  draft: AssistantTaskDraft,
  defaults: { parentId?: string | null; projectId?: string | null; section?: string | null }
): CreateTaskInput {
  return {
    title: draft.title!,
    notes: draft.notes ?? '',
    parentId: defaults.parentId ?? null,
    projectId: projectIdFromDraft(store, draft, defaults.projectId ?? null),
    section: draft.section === undefined ? defaults.section ?? null : draft.section,
    dueAt: draft.dueAt ?? null,
    deadlineAt: draft.deadlineAt ?? null,
    reminderAt: draft.reminderAt ?? null,
    scheduledStart: draft.scheduledStart ?? null,
    durationMinutes: draft.durationMinutes ?? null,
    priority: draft.priority ?? 4,
    energy: draft.energy ?? 'normal',
    recurrence: draft.recurrence ?? null,
    tagIds: draft.tagNames ? tagIdsFromNames(store, draft.tagNames) : []
  };
}

function updateInputFromDraft(store: KarhaDatabase, patch: AssistantTaskDraft): UpdateTaskInput {
  const input: UpdateTaskInput = {};
  if (patch.title !== undefined) input.title = patch.title;
  if (patch.notes !== undefined) input.notes = patch.notes;
  if (patch.projectName !== undefined) input.projectId = projectIdFromDraft(store, patch, null);
  if (patch.section !== undefined) input.section = patch.section;
  for (const field of dateFields) {
    if (patch[field] !== undefined) input[field] = patch[field] ?? null;
  }
  if (patch.durationMinutes !== undefined) input.durationMinutes = patch.durationMinutes;
  if (patch.priority !== undefined) input.priority = patch.priority;
  if (patch.energy !== undefined) input.energy = patch.energy;
  if (patch.recurrence !== undefined) input.recurrence = patch.recurrence;
  if (patch.tagNames !== undefined) input.tagIds = tagIdsFromNames(store, patch.tagNames);
  if (patch.completed !== undefined) input.completed = patch.completed;
  return input;
}

function projectIdFromDraft(store: KarhaDatabase, draft: AssistantTaskDraft, fallback: string | null): string | null {
  if (draft.projectName === undefined) return fallback;
  if (draft.projectName === null) return null;
  return store.findOrCreateProject(draft.projectName).id;
}

function tagIdsFromNames(store: KarhaDatabase, tagNames: string[]): string[] {
  return tagNames.map((name) => store.findOrCreateTag(name).id);
}

function requireTask(store: KarhaDatabase, taskId: string): Task {
  const task = store.getTask(taskId);
  if (!task) throw new AssistantRequestError(400, `تسک پیدا نشد: ${taskId}`);
  return task;
}

function readOperationType(value: unknown): AssistantOperationType {
  if (typeof value !== 'string' || !operationTypes.has(value as AssistantOperationType)) {
    throw new AssistantRequestError(502, 'نوع عملیات دستیار پشتیبانی نمی‌شود.');
  }
  return value as AssistantOperationType;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AssistantRequestError(502, `${field} باید متن غیرخالی باشد.`);
  }
  return value.trim();
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return readRequiredString(value, field);
}

function readNullableIso(value: unknown, field: string): string | null {
  if (value === null) return null;
  const iso = readRequiredString(value, field);
  if (Number.isNaN(new Date(iso).getTime())) {
    throw new AssistantRequestError(502, `${field} باید ISO معتبر یا null باشد.`);
  }
  return iso;
}

function readNullableDuration(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1440) {
    throw new AssistantRequestError(502, 'durationMinutes باید عدد صحیح بین ۰ و ۱۴۴۰ باشد.');
  }
  return value;
}

function readPriority(value: unknown): TaskPriority {
  if (typeof value !== 'number' || ![1, 2, 3, 4].includes(value)) {
    throw new AssistantRequestError(502, 'priority باید عدد ۱ تا ۴ باشد.');
  }
  return value as TaskPriority;
}

function readEnergy(value: unknown): Task['energy'] {
  if (typeof value !== 'string' || !energyValues.has(value)) {
    throw new AssistantRequestError(502, 'energy معتبر نیست.');
  }
  return value as Task['energy'];
}

function readNullableRecurrence(value: unknown): RecurrenceRule | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new AssistantRequestError(502, 'recurrence باید object یا null باشد.');
  const frequency = value.frequency;
  const interval = value.interval;
  if (typeof frequency !== 'string' || !recurrenceFrequencies.has(frequency)) {
    throw new AssistantRequestError(502, 'recurrence.frequency معتبر نیست.');
  }
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new AssistantRequestError(502, 'recurrence.interval معتبر نیست.');
  }
  return { frequency: frequency as RecurrenceRule['frequency'], interval };
}

function readTagNames(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AssistantRequestError(502, 'tagNames باید آرایه باشد.');
  return [...new Set(value.map((item) => readRequiredString(item, 'tagName')))];
}

function assertNoUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) throw new AssistantRequestError(502, `${label}.${unknownKey} پشتیبانی نمی‌شود.`);
}

function parseAssistantPlanContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new AssistantRequestError(502, 'دستیار خروجی JSON قابل خواندن برنگرداند.');
  }
}

function assistantUserPrompt(store: KarhaDatabase, message: string): string {
  const projects = new Map(store.listProjects({ view: 'all' }).map((project) => [project.id, project.name]));
  const taskContext = store.listTasks({ view: 'all' }).map((task) => ({
    id: task.id,
    title: task.title,
    notes: task.notes.slice(0, 240),
    completed: !!task.completedAt,
    projectName: task.projectId ? projects.get(task.projectId) ?? null : null,
    section: task.section,
    dueAt: task.dueAt,
    deadlineAt: task.deadlineAt,
    reminderAt: task.reminderAt,
    scheduledStart: task.scheduledStart,
    durationMinutes: task.durationMinutes,
    priority: task.priority,
    recurrence: task.recurrence,
    tags: task.tags.map((tag) => tag.name),
    subtasks: (task.subtasks ?? []).map((subtask) => ({ id: subtask.id, title: subtask.title, completed: !!subtask.completedAt }))
  }));

  return JSON.stringify({
    currentDate: new Date().toISOString(),
    locale: 'fa-IR',
    calendar: 'persian',
    userMessage: message,
    projects: store.listProjects({ view: 'all' }).map((project) => ({ id: project.id, name: project.name, archived: !!project.archivedAt })),
    tags: store.listTags().map((tag) => tag.name),
    tasks: taskContext
  });
}

function assistantSystemPrompt(): string {
  return [
    'تو دستیار محلی اپ Karha هستی؛ یک task manager فارسی، RTL و local-first.',
    'هیچ تغییری را اعمال نکن. فقط JSON طبق schema برگردان.',
    'اگر درخواست کاربر مبهم است یا چند تسک می‌تواند هدف باشد، clarificationQuestion را پر کن و operations را خالی بگذار.',
    'برای تغییر تسک موجود فقط از id های داخل context و فیلد targetTaskId استفاده کن.',
    'برای پروژه و برچسب از نام استفاده کن: projectName و tagNames. tagNames همیشه فهرست نهایی برچسب‌هاست.',
    'همه تاریخ‌ها باید ISO 8601 باشند یا null. از currentDate برای عبارت‌های نسبی مثل امروز و فردا استفاده کن.',
    'عملیات مجاز: create_task, update_task, create_subtask, add_comment, complete_task, reopen_task.',
    'برای شکستن یک تسک موجود به زیرتسک، create_subtask با targetTaskId و subtasks برگردان.'
  ].join('\n');
}

function defaultOperationSummary(type: AssistantOperationType): string {
  if (type === 'create_task') return 'ایجاد تسک';
  if (type === 'update_task') return 'ویرایش تسک';
  if (type === 'create_subtask') return 'ایجاد زیرتسک';
  if (type === 'add_comment') return 'افزودن کامنت';
  if (type === 'complete_task') return 'تکمیل تسک';
  return 'باز کردن تسک';
}

function resolveOllamaBaseUrl(baseUrl = process.env.OLLAMA_BASE_URL ?? defaultOllamaBaseUrl): string {
  return baseUrl.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const assistantPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'clarificationQuestion', 'operations'],
  properties: {
    reply: { type: 'string' },
    clarificationQuestion: { type: ['string', 'null'] },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'summary'],
        properties: {
          id: { type: 'string' },
          type: { enum: Array.from(operationTypes) },
          summary: { type: 'string' },
          targetTaskId: { type: ['string', 'null'] },
          task: { type: ['object', 'null'], additionalProperties: true },
          patch: { type: ['object', 'null'], additionalProperties: true },
          commentBody: { type: ['string', 'null'] },
          subtasks: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      }
    }
  }
};
