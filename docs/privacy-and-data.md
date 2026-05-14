# Privacy and Data Storage

Karha is local-first. The app stores personal task data in a SQLite database on
the local machine and does not send telemetry or analytics.

## What is safe to publish

The source code, migrations, tests, and demo seed data are safe to publish on
GitHub.

## What must stay private

Never commit:

- SQLite database files
- `.env.local`
- JSON backups
- CSV exports
- `.local-data/`

The `.gitignore` file blocks these by default.

## Data directory guard

By default the server refuses to use a data directory inside the repository.
This prevents accidental commits of personal tasks. This personal checkout uses
an ignored `.env.local` file to set `TASKS_DATA_DIR=.local-data` and
`KARHA_ALLOW_REPO_DATA=1`, so the local SQLite database is stored at
`.local-data/karha.sqlite`.

Only use repository-local data directories when the directory is ignored by
Git.
