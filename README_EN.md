# Codex DeepSeek Bridge

[中文](README.md)

Connect Codex to the real [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent. Codex plans and reviews. The bridge supports isolated one-shot tasks and persistent subagents that receive multiple messages in one live project workspace, resuming the same Harness conversation.

## Install

Requires Linux, Node.js 24+, Git, Codex CLI, and the `dsh` CLI. Install DeepSeek Harness (for example, `npm install -g @deepseek-ai/dsh@0.2.0-rc.2`) and check `dsh --profile headless --help`.

```bash
cd /path/to/codex-deepseek-bridge
codex plugin marketplace add .
codex plugin add codex-deepseek-bridge@codex-deepseek-bridge-local
```

The repository contains `bundle/`; an unmodified plugin install needs no npm download. After source changes, or before the real integration runner, use `npm ci && npm run build`. Set the workspace root and host access acknowledgment in the environment that launches Codex:

```bash
export BRIDGE_ALLOWED_ROOTS="$HOME/projects"  # colon-separated roots
export BRIDGE_ACK_HOST_ACCESS=1   # after reading Security below
```

The bridge launches the local `dsh` and does not require a separate API key. Existing Harness environment variables and `$DSH_HOME/.env` work as usual. To reuse credentials saved by the Harness GUI, set `BRIDGE_USE_DSH_SAVED_CREDENTIALS=1` when launching Codex; the bridge enables Harness headless credential consumers without reading or copying the key. Never commit a key or add it to `mcp.json`. Restart Codex, then check `codex plugin list` and available MCP tools. If your client does not load the bundled server, use `codex mcp add deepseek-bridge -- node /path/to/codex-deepseek-bridge/bundle/server.js` with your installation path.

## Use

For a bounded isolated task, ask Codex to use `delegate-to-deepseek`, such as generating tests and reviewing the resulting patch. Codex uses `delegate_task`, `get_task_status`, `get_task_result`, and optionally `cancel_task`. This path needs a Git repository and does not directly edit your main checkout. See [three examples](examples/tasks.md).

For ongoing work, ask Codex to create a DSH subagent with the `use-deepseek-subagent` skill. `create_deepseek_agent` sets its lasting role, initial context, live workspace, and read-only or write mode. `send_deepseek_message` starts an asynchronous turn. Codex checks `get_deepseek_agent_status` and `get_deepseek_agent_history`, then sends later instructions to the same agent ID. The bridge resumes the Harness session using `--session-id` in the same directory. `list_deepseek_agents` retrieves saved agents; `close_deepseek_agent` ends one and preserves its history. The agent survives MCP reconnection. Codex decides when to send another message; the bridge does not schedule periodic checks itself.

A persistent agent sees current project files, including logs that change during model training. Write mode can edit the live workspace. Read-only mode selects Harness's read-only permission setting. A persistent agent does not need Git.

Run `npm test` for no-cost MCP-to-mock-agent end-to-end tests. Optional real integration runners include `node tests/real-agent.mjs` for a two-turn session and `node tests/real-integration.mjs` for one-shot tasks. They use your configured Harness credentials and may incur model cost. See the [acceptance record](docs/acceptance.md).

## Security

Git worktrees protect the main checkout for one-shot tasks but **are not OS sandboxes**. Persistent agents work in the live workspace and can edit it in write mode. Harness tools run with host account access. The bridge requires an allowed root and explicit `BRIDGE_ACK_HOST_ACCESS=1` acknowledgment. Use a container or restricted account for stronger isolation. Deletion, dependency installation, and expensive work require opt-in tool parameters, but prompt rules and keyword checks do not enforce shell-level restrictions. Harness's original safety mechanisms remain in place. State, logs, and subagent history are under `~/.local/state/codex-deepseek-bridge` by default; protect that directory. Uncommitted main-checkout changes are invisible to one-shot tasks and visible to persistent agents. See [architecture and verified interfaces](docs/architecture.md).

## FAQ

- Harness authentication error: check your local headless configuration. Saved GUI credentials require `BRIDGE_USE_DSH_SAVED_CREDENTIALS=1`; environment variables and `$DSH_HOME/.env` follow Harness defaults.
- Workspace outside allowed roots: set `BRIDGE_ALLOWED_ROOTS` to the relevant absolute parent.
- `spawn dsh ENOENT`: install Harness and ensure it is on Codex's `PATH`.
- Non-Git or empty repo: initialize Git and commit once for isolated one-shot tasks. Persistent subagents can use non-Git workspaces.
- `interrupted` after restart: resubmit. The bridge does not claim an unfinished task completed.

## Uninstall

```bash
codex plugin remove codex-deepseek-bridge@codex-deepseek-bridge-local
codex plugin marketplace remove codex-deepseek-bridge-local
```

Remove the clone and state directory after saving any wanted logs. Harness is not removed automatically.

## Verification and distribution

Automated tests cover the original one-shot path plus persistent session reuse, workspace continuity, MCP reconnection, and durable history. Real Harness one-shot and two-turn agent checks passed in this environment on 2026-10-18. Public directory submission of a local MCP server currently requires OpenAI partner approval and allowlisting; Git/local marketplace distribution is the practical route for now.

MIT license. See [LICENSE](LICENSE).
