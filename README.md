# Karha

Karha is a local-first, Persian, RTL task manager. It aims to combine the
simple daily workflow of Todoist and Things with a few practical TickTick-style
tools, without sync, telemetry, or personal task data stored in the repository.

Public repository:
[github.com/mohamadsmt/karha](https://github.com/mohamadsmt/karha)

## Features

- Minimal Todoist-like interface with quiet navigation, separator-style task
  rows, advanced controls in collapsible areas, a detail drawer instead of a
  permanent side panel, and a persisted light/dark theme switch.
- Persian quick-add parsing for today, tomorrow, weekdays, next week, Jalali
  dates like `1405/02/20`, time expressions, projects with `#work`, sections
  with `/meeting`, tags with `@email`, priorities with `!1` to `!4`, and daily,
  weekly, or monthly recurrences.
- Inbox, Today, Upcoming, projects, sections, tags, priorities, subtasks,
  descriptions, deadlines, reminders, durations, personal comments/activity,
  search, and saved filters.
- Completed tasks appear under a separate separator in Today, project, and tag
  views. That section can be collapsed per page, and archived tasks can be
  restored from the archive view.
- Manual drag-and-drop ordering for sibling tasks and subtasks. Subtasks stay
  nested under their parent with proper indentation, collapse, complete, and
  reopen behavior.
- Today includes overdue and current-day tasks. Upcoming is grouped by Persian
  Jalali dates.
- Calendar views, weekly/monthly/agenda modes, Eisenhower matrix, habits,
  Pomodoro/focus sessions, and basic stats.
- Keyboard shortcuts: `q` for quick add, `/` for search, `g` then `i/t/u` for
  Inbox/Today/Upcoming, `j/k` for movement, `Enter` for the detail drawer, `x`
  for completion, `Delete` for archive, `1..4` for priority, `d` to schedule
  for today, and `?` for the shortcut guide.
- Undo toasts for completion, archive, date changes, and manual reordering.
- Local SQLite storage with simple migrations.
- JSON export/import and CSV export.

## Requirements

- Node.js and npm
- A local environment for the UI and API. The server binds to `127.0.0.1`.

## Run Locally

```bash
git clone https://github.com/mohamadsmt/karha.git
cd karha
npm ci
npm run dev
```

The UI runs at `http://127.0.0.1:5173` and the API runs at
`http://127.0.0.1:3737`.

For a production build:

```bash
npm run build
npm run start
```

## Data Storage

Karha stores user data in a local SQLite database. SQLite files, local
environment files, backups, exports, and repository-local data directories are
ignored by Git.

If no `.env.local` file is present, Karha uses the default operating-system data
directory:

- macOS: `~/Library/Application Support/karha/karha.sqlite`
- Linux: `~/.local/share/karha/karha.sqlite`
- Windows: `%APPDATA%/karha/karha.sqlite`

To use a custom data directory outside the repository:

```bash
TASKS_DATA_DIR=/absolute/path/outside/repo npm run dev
```

By default, the server refuses to use a data directory inside the repository.
This prevents accidental commits of personal task data. If you intentionally
store local data in an ignored repository directory such as `.local-data/`, set
both variables in `.env.local`:

```bash
TASKS_DATA_DIR=.local-data
KARHA_ALLOW_REPO_DATA=1
```

Only use that override for ignored directories.

## Local API

Main routes:

- `GET/POST/PATCH/DELETE /api/tasks`
- `POST /api/tasks/quick-add`
- `GET/POST /api/tasks/:id/comments`
- `POST /api/tasks/:id/reorder`
- `POST /api/tasks/:id/reschedule`
- `GET/POST /api/projects`
- `GET/POST /api/tags`
- `GET/POST /api/habits`
- `POST /api/habits/:id/log`
- `GET/POST /api/focus-sessions`
- `GET/POST /api/saved-filters`
- `DELETE /api/saved-filters/:id`
- `GET /api/stats`
- `GET /api/backup/export`
- `POST /api/backup/import`
- `GET /api/backup/csv`
- `GET /api/settings`

## Development

```bash
npm run lint
npm run test
npm run build
git diff --check
```

Karha has no telemetry and does not send user data anywhere. See
`docs/privacy-and-data.md` for more detail about local data and files that must
not be published.
