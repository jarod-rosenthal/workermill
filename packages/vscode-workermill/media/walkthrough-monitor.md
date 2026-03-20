# Monitor & Review

Track every detail of task execution in real time — from planning through PR delivery.

### Coordination Feed

The sidebar feed shows live messages from active workers:
- Planning progress and story decomposition
- Expert assignments and file changes
- Quality gate results (pass/fail)
- Blocker escalations that need your input
- PR creation and review status

### Live Terminal Logs

Click **Show Task Logs** on any active task to open a live terminal stream — the same output you'd see if the worker were running in your terminal.

### Live Code Diffs

As workers write code, you can view changes in real time:
1. Click on a file change in the Coordination Feed
2. A diff editor opens showing the worker's changes against the base branch
3. Changes update live as the worker continues writing

### Respond to Escalations

When a worker hits a blocker (ambiguous requirements, missing context, conflicting instructions), it escalates to you:
1. A notification appears in VS Code
2. Click **Talk to Worker** to provide guidance
3. The worker resumes with your input

### Review & Approve

When all stories complete:
- A consolidated PR is created on your SCM provider
- Optional tech lead review runs automatically
- Open the PR link from the sidebar to review and merge
