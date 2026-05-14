import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KarhaDatabase } from './database';
import type { AppSettings, BackupPayload } from '../src/types';

export interface ApiContext {
  store: KarhaDatabase;
  settings: AppSettings;
  distDir?: string;
}

export async function handleApiRequest(request: Request, context: ApiContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = url.pathname;

  try {
    if (method === 'GET' && pathname === '/api/health') {
      return json({ ok: true, app: 'karha' });
    }

    if (method === 'GET' && pathname === '/api/settings') {
      return json(context.settings);
    }

    if (method === 'GET' && pathname === '/api/tasks') {
      return json(
        context.store.listTasks({
          view: url.searchParams.get('view') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
          projectId: url.searchParams.get('projectId') ?? undefined,
          tagId: url.searchParams.get('tagId') ?? undefined
        })
      );
    }

    if (method === 'POST' && pathname === '/api/tasks') {
      return json(context.store.createTask(await request.json()), { status: 201 });
    }

    if (method === 'POST' && pathname === '/api/tasks/quick-add') {
      const body = (await request.json()) as { title?: string };
      if (!body.title?.trim()) return json({ error: 'Task title is required.' }, { status: 400 });
      return json(context.store.quickAddTask(body.title), { status: 201 });
    }

    const taskId = matchId(pathname, '/api/tasks/');
    if (taskId && method === 'PATCH') {
      return json(context.store.updateTask(taskId, await request.json()));
    }
    if (taskId && method === 'DELETE') {
      return json(context.store.deleteTask(taskId));
    }

    const taskCommentsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments$/);
    if (taskCommentsMatch && method === 'GET') {
      return json(context.store.listTaskComments(taskCommentsMatch[1]));
    }
    if (taskCommentsMatch && method === 'POST') {
      const body = (await request.json()) as { body?: string };
      if (!body.body?.trim()) return json({ error: 'Comment body is required.' }, { status: 400 });
      return json(context.store.createTaskComment(taskCommentsMatch[1], body.body), { status: 201 });
    }

    const reorderMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/reorder$/);
    if (reorderMatch && method === 'POST') {
      const body = (await safeJson(request)) as { beforeId?: string | null };
      return json(context.store.reorderTask(reorderMatch[1], body.beforeId ?? null));
    }

    const rescheduleMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/reschedule$/);
    if (rescheduleMatch && method === 'POST') {
      const body = (await request.json()) as { dueAt?: string | null; scheduledStart?: string | null };
      return json(context.store.rescheduleTask(rescheduleMatch[1], body.dueAt ?? null, body.scheduledStart));
    }

    if (method === 'GET' && pathname === '/api/projects') {
      return json(context.store.listProjects());
    }
    if (method === 'POST' && pathname === '/api/projects') {
      return json(context.store.createProject(await request.json()), { status: 201 });
    }

    if (method === 'GET' && pathname === '/api/tags') {
      return json(context.store.listTags());
    }
    if (method === 'POST' && pathname === '/api/tags') {
      return json(context.store.createTag(await request.json()), { status: 201 });
    }

    if (method === 'GET' && pathname === '/api/habits') {
      return json(context.store.listHabits());
    }
    if (method === 'POST' && pathname === '/api/habits') {
      return json(context.store.createHabit(await request.json()), { status: 201 });
    }

    const habitLogMatch = pathname.match(/^\/api\/habits\/([^/]+)\/log$/);
    if (habitLogMatch && method === 'POST') {
      const body = (await safeJson(request)) as { loggedOn?: string; count?: number };
      return json(context.store.logHabit(habitLogMatch[1], body.loggedOn, body.count), { status: 201 });
    }

    if (method === 'GET' && pathname === '/api/focus-sessions') {
      return json(context.store.listFocusSessions());
    }
    if (method === 'POST' && pathname === '/api/focus-sessions') {
      return json(context.store.createFocusSession(await request.json()), { status: 201 });
    }

    if (method === 'GET' && pathname === '/api/saved-filters') {
      return json(context.store.listSavedFilters());
    }
    if (method === 'POST' && pathname === '/api/saved-filters') {
      return json(context.store.createSavedFilter(await request.json()), { status: 201 });
    }

    const savedFilterId = matchId(pathname, '/api/saved-filters/');
    if (savedFilterId && method === 'DELETE') {
      context.store.deleteSavedFilter(savedFilterId);
      return json({ ok: true });
    }

    if (method === 'GET' && pathname === '/api/stats') {
      return json(context.store.getStats());
    }

    if (method === 'GET' && pathname === '/api/backup/export') {
      return json(context.store.exportBackup());
    }

    if (method === 'POST' && pathname === '/api/backup/import') {
      return json(context.store.importBackup((await request.json()) as BackupPayload));
    }

    if (method === 'GET' && pathname === '/api/backup/csv') {
      return new Response(context.store.exportTasksCsv(), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="karha-tasks.csv"'
        }
      });
    }

    return json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: message }, { status: 500 });
  }
}

export async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: ApiContext
): Promise<void> {
  const origin = `http://${req.headers.host ?? '127.0.0.1'}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readIncomingBody(req);
  const request = new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: body ? new Uint8Array(body) : undefined
  });

  if (new URL(request.url).pathname.startsWith('/api/')) {
    await writeResponse(res, await handleApiRequest(request, context));
    return;
  }

  if (context.distDir) {
    await serveStatic(request, res, context.distDir);
    return;
  }

  await writeResponse(res, json({ error: 'API server is running. Use Vite dev server for the UI.' }, { status: 404 }));
}

async function readIncomingBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function serveStatic(request: Request, res: ServerResponse, distDir: string): Promise<void> {
  const url = new URL(request.url);
  const safePath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const filePath = path.resolve(distDir, safePath);
  const resolvedDist = path.resolve(distDir);

  if (!filePath.startsWith(resolvedDist)) {
    await writeResponse(res, json({ error: 'Invalid path' }, { status: 400 }));
    return;
  }

  try {
    const buffer = await readFile(filePath);
    res.writeHead(200, { 'content-type': contentType(filePath) });
    res.end(buffer);
  } catch {
    const buffer = await readFile(path.join(distDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(buffer);
  }
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers
    }
  });
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function matchId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  return id && !id.includes('/') ? decodeURIComponent(id) : null;
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
