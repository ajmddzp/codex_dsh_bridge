# Codex DeepSeek Bridge

[中文](README.md)

Delegate bounded coding work from Codex to the real [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent. Codex plans and reviews; four MCP tools submit, inspect status/results, and cancel tasks. Tasks run asynchronously in separate Git worktrees. The bridge returns a patch and never merges it automatically.

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

Ask Codex to use the `delegate-to-deepseek` skill for a bounded task, such as generating tests and reviewing the resulting patch. Codex supplies the absolute Git workspace, acceptance criteria, timeout, and read-only or write mode. It polls status, inspects the actual diff and test events, and decides whether to apply the patch. See [three examples](examples/tasks.md).

Run `npm test` for no-cost MCP-to-mock-agent end-to-end tests. An optional real integration runner is `node tests/real-integration.mjs`, which uses your configured Harness credentials and may incur model cost. The three real Harness scenarios and cancellation path were verified on 2026-10-18; see the [acceptance record](docs/acceptance.md). A run without a working Harness authentication route remains unverified.

## Security

Git worktrees protect the main checkout from ordinary edits but **are not OS sandboxes**. Harness tools can access files permitted to the host account. The bridge requires an allowed root and explicit `BRIDGE_ACK_HOST_ACCESS=1` acknowledgment. Use a container or restricted account for stronger isolation. Deletion, dependency installation, and expensive work require opt-in tool parameters, but prompt rules and keyword checks do not enforce shell-level restrictions. Harness's original safety mechanisms remain in place. State and logs are under `~/.local/state/codex-deepseek-bridge` by default; protect that directory. Uncommitted main-checkout changes are not visible to the task. See [architecture and verified interfaces](docs/architecture.md).

## FAQ

- Harness authentication error: check your local headless configuration. Saved GUI credentials require `BRIDGE_USE_DSH_SAVED_CREDENTIALS=1`; environment variables and `$DSH_HOME/.env` follow Harness defaults.
- Workspace outside allowed roots: set `BRIDGE_ALLOWED_ROOTS` to the relevant absolute parent.
- `spawn dsh ENOENT`: install Harness and ensure it is on Codex's `PATH`.
- Non-Git or empty repo: initialize Git and commit once. These repositories are unsupported in v1.
- `interrupted` after restart: resubmit. The bridge does not claim an unfinished task completed.

## Uninstall

```bash
codex plugin remove codex-deepseek-bridge@codex-deepseek-bridge-local
codex plugin marketplace remove codex-deepseek-bridge-local
```

Remove the clone and state directory after saving any wanted logs. Harness is not removed automatically.

## Verification and distribution

Automated tests cover MCP registration/validation, success/failure, timeout, cancellation, concurrency, paths, restart, missing Harness and running without an extra bridge key, file changes, and worktree cleanup. The real Harness scenarios and cancellation path passed in this environment on 2026-10-18. Public directory submission of a local MCP server currently requires OpenAI partner approval and allowlisting; Git/local marketplace distribution is the practical route for now. Future work: container isolation, cross-platform process handling, multi-instance storage, and richer test summaries.

MIT license. See [LICENSE](LICENSE).
