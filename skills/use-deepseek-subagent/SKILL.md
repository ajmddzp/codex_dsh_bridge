---
name: use-deepseek-subagent
description: Use a persistent DeepSeek Harness subagent when Codex needs multiple rounds of work or investigation in the same project, including follow-up analysis of a long-running experiment.
---

Codex is the supervising agent. Create a DeepSeek subagent for work that benefits from several turns in one project. Use the one-shot `delegate_task` workflow for a bounded task that should run in an isolated worktree.

1. Call `create_deepseek_agent` with an absolute live workspace, a lasting role, relevant `initial_context`, and `read_only` or `write` mode. Include only context the subagent needs; the workspace is shared with the user's project.
2. Send a concrete next step with `send_deepseek_message`. Keep the returned agent ID. The call starts an asynchronous Harness turn; poll `get_deepseek_agent_status` and read `get_deepseek_agent_history` for its answer and logs.
3. Send later instructions to the same agent ID. The bridge resumes the Harness session in the same workspace, so prior conversation remains available. Include newly observed facts or changed goals in the follow-up message.
4. Inspect results and project changes yourself before relying on them. For training supervision, ask the agent to inspect existing logs or checkpoints and report findings; Codex decides when to ask again and what actions to take. The bridge does not schedule periodic checks on its own.
5. Call `close_deepseek_agent` when the assignment is finished. Closing cancels an active turn and preserves saved history.

`read_only` selects Harness's read-only permission mode. The agent runs under the host account, so use a restricted account or container when a stronger access boundary is needed. The agent's working directory is the live workspace; write mode may change it directly.
