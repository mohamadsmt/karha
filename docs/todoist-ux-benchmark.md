# Todoist UX Benchmark

This pass keeps Karha local-first and Persian-first, while using Todoist as the
main interaction benchmark.

## Contracts

- Fast capture: one-line Quick Add accepts Persian dates and Todoist-like tokens
  for project, section, labels, priority, and recurrence.
- Low-noise navigation: Inbox, امروز, پیش‌رو, پروژه‌ها, and filters/labels stay
  primary. Calendar, Eisenhower, focus, habits, stats, and completed tasks are
  available under the collapsed ابزارها area, with archived tasks available in
  their own restore-oriented archive view.
- Smart ordering: Today includes overdue plus today and sorts by due date/time,
  priority, manual order, and creation time. Upcoming only shows future tasks
  grouped by Persian/Jalali day.
- Rich detail without context switching: task detail opens in a drawer with
  title, description, due date/time, deadline, reminder, duration, project,
  section, priority, labels, subtasks, and personal comments/activity.
- Reversible fast actions: completion, archive, reschedule, and manual reorder
  show an undo toast.
- Completed tasks stay available in Today, project, and label contexts under a
  collapsible separator so the active list can stay quiet without losing history.
- Hierarchical clarity: subtasks render directly below their parent with a
  compact indent, local collapse state, independent completion, and same-level
  drag sorting.

## Intentionally Out Of Scope

- Teams, sharing, assignees, file attachments, location reminders, cloud sync,
  and background native notifications.
- Any telemetry or remote analytics.
