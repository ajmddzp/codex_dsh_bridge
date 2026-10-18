---
name: delegate-to-deepseek
description: Delegate bounded coding implementation, routine fixes, test writing, data scripts, or log analysis to DeepSeek Harness through the Codex DeepSeek Bridge MCP tools when delegation is likely useful.
---

Codex remains responsible for planning, task selection, review, and acceptance. Delegation is optional; do the work directly when that is faster.

Use DeepSeek for a specific implementation or investigation with observable acceptance criteria. Keep architecture, experiment design, security decisions, final review, and interpretation of research results with Codex.

1. Identify an absolute Git workspace under the configured `BRIDGE_ALLOWED_ROOTS`. Explain that the agent sees committed `HEAD`; local uncommitted changes are excluded.
2. Write a narrow task, explicit acceptance criteria, a 10–3600 second timeout, and `read_only` or `write` mode. Set deletion, installation, or expensive-work flags only when the user has authorized those actions.
3. Call `delegate_task`. Keep its `task_id`. Continue independent work while the task runs.
4. Poll `get_task_status` at reasonable intervals. Use `cancel_task` if the task is no longer needed.
5. Once terminal, call `get_task_result`. Read the actual diff, changed-file list, process outcome, and recorded test events. A final text response alone is insufficient evidence.
6. Review paths and content for correctness and safety. Apply an accepted patch to the main workspace only after reviewing it. Check conflicts against local changes; do not overwrite them. Run relevant tests yourself when feasible.
7. Report what was delegated, evidence inspected, what was accepted, and what remains unverified.

`read_only` means the bridge rejects changes found in the isolated worktree; it is not an OS file access sandbox. The bridge requires explicit host access acknowledgment in its environment.
