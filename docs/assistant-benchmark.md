# Assistant Benchmark

Karha's assistant keeps the product local-first and Persian-first while borrowing
the smallest useful assistant patterns from established task apps.

## Benchmarked patterns

- Todoist AI Assistant: suggests tasks, improves task wording, breaks tasks into
  smaller tasks, and can add advice as comments.
- Todoist Ramble: turns natural language capture into reviewed task fields such
  as due date, deadline, project, labels, and priority before adding them.
- Akiflow AI assistant request: emphasizes actionable naming and task breakdown.
- Motion AI task manager: focuses on automated scheduling and prioritization.

## Karha v1 scope

- Uses local Ollama through the server API.
- Lists installed Ollama models and stores the selected model in SQLite.
- Produces a preview first; no task mutation happens until the user confirms.
- Supports task creation, task edits, subtasks, comments, completion, and reopen
  actions.
- Leaves full auto-scheduling and autonomous reprioritization out of v1.

## References

- https://www.todoist.com/integrations/apps/ai-assistant
- https://www.todoist.com/help/articles/capture-tasks-at-the-speed-of-thought-ramble-beta-nov-19-r6701hY0t
- https://product.akiflow.com/p/ai-assistant-for-tasks
- https://www.usemotion.com/features/ai-task-manager
- https://docs.ollama.com/api/chat
- https://docs.ollama.com/api/tags
- https://docs.ollama.com/capabilities/structured-outputs
