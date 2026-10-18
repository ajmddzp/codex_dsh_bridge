# Codex DeepSeek Bridge

[English](README_EN.md)

让 Codex 将边界明确的工程任务交给真正的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Agent。Codex 负责规划与验收，Bridge 提供四个 MCP 工具：`delegate_task`、`get_task_status`、`get_task_result`、`cancel_task`。任务异步运行在独立 Git worktree；Bridge 返回补丁，不自动合并到主工作区。

## 安装

Linux、Node.js 24+、Git、Codex CLI 和 DeepSeek Harness CLI (`dsh`) 是运行条件。先安装 Harness 并确认 `dsh --profile headless --help` 可用。Harness 官方包可通过 `npm install -g @deepseek-ai/dsh@0.2.0-rc.2` 安装；它仍处于 developer preview。

```bash
cd /path/to/codex-deepseek-bridge
codex plugin marketplace add .
codex plugin add codex-deepseek-bridge@codex-deepseek-bridge-local
```

仓库已包含 `bundle/`，安装插件时无需下载 Node 依赖；开发者修改 TypeScript 后运行 `npm ci && npm run build`。运行真实集成脚本前也应先构建。请在启动 Codex 的环境中配置工作区与安全确认：

```bash
export BRIDGE_ALLOWED_ROOTS="$HOME/projects"  # 冒号分隔多个允许的根目录
export BRIDGE_ACK_HOST_ACCESS=1   # 阅读下文安全边界后设置
```

Bridge 默认直接启动本机 `dsh`，不要求再向 Bridge 单独提供 API Key。若你的 Harness 使用环境变量或 `$DSH_HOME/.env`，沿用原有配置即可。若密钥保存在 Harness Web UI 的凭据库中，可在启动 Codex 的环境设置 `BRIDGE_USE_DSH_SAVED_CREDENTIALS=1`；Bridge 会按 Harness 官方说明为 headless 加载凭据配置，不读取或复制密钥。不要把密钥写入仓库、`mcp.json` 或 shell 历史。需要重启 Codex 客户端让环境变量与插件生效。用 `codex plugin list` 检查安装；在 Codex 中查看 MCP 工具。若客户端尚未加载插件 MCP，可用 `codex mcp add deepseek-bridge -- node /path/to/codex-deepseek-bridge/bundle/server.js` 手动连接；将该路径替换成自己的安装位置。

## 使用

例如：“请使用 delegate-to-deepseek 技能，给这个模块补单元测试，执行 pytest，并检查返回的 diff。”Codex 应提交绝对 Git 工作区路径、明确的验收条件、超时和模式；获取 `task_id` 后可继续做其他工作。完成后用 `get_task_result` 查看真正的修改列表、Git patch、退出状态、测试事件与日志，再决定是否应用补丁。

三个示例任务见 [examples/tasks.md](examples/tasks.md)。自动 Mock 端到端测试使用真实 MCP 连接、独立 worktree 与假 Harness 进程，不消耗模型费用。`npm test` 运行它们。可选真实集成脚本见下文；它们使用当前 `dsh` 可用的凭据，若 Harness 无法认证则会报告失败。

## 安全与行为

Git worktree 只隔离仓库内容，**不是 OS 沙箱**。DeepSeek Harness 的 Shell/文件工具仍具有运行它的账户权限。Bridge 要求 `BRIDGE_ALLOWED_ROOTS` 和 `BRIDGE_ACK_HOST_ACCESS=1`；如果需要强文件访问隔离，应在专用容器或受限账户内运行。删除文件、依赖安装和高成本任务需要相应工具参数显式放行，但关键词检查与提示无法保证拦截 agent 生成的危险命令。Bridge 不绕过 Harness 的原有安全机制。日志存于 `~/.local/state/codex-deepseek-bridge`（可用 `BRIDGE_STATE_DIR` 修改），应限制访问。主工作区尚未提交的改动不会传给 Harness。详情见 [架构与接口调查](docs/architecture.md)。

## 常见问题

- Harness 报认证错误：确认本机 `dsh --profile headless` 可运行。headless 默认忽略 GUI 保存的凭据；需要复用时设置 `BRIDGE_USE_DSH_SAVED_CREDENTIALS=1`，或使用 Harness 原有的环境变量、`$DSH_HOME/.env`。
- `workspace is outside BRIDGE_ALLOWED_ROOTS`：配置允许的绝对路径根目录。
- `spawn dsh ENOENT`：安装 Harness 并确保启动 Codex 时的 `PATH` 含 `dsh`。
- `workspace must be inside a Git repository`：先初始化并至少提交一次。非 Git 项目暂不支持。
- 结果中看不到未提交的本地修改：worktree 从 `HEAD` 创建；先提交或让 Codex 自己处理该任务。
- MCP 服务器重启后任务为 `interrupted`：重新提交；Bridge 不会误报已完成。

## 卸载

```bash
codex plugin remove codex-deepseek-bridge@codex-deepseek-bridge-local
codex plugin marketplace remove codex-deepseek-bridge-local
```

删除本地克隆与状态目录前请自行保留需要的日志。不会自动卸载 DeepSeek Harness。

## 验证与发布状态

`npm test` 覆盖 MCP 注册、参数校验、成功/失败、超时、取消、并发、工作目录、重启、缺少 Harness、无额外密钥运行、修改与 worktree 清理。真实 Harness 三场景及取消路径已于 2026-10-18 验证，详情见 [验收记录](docs/acceptance.md)。用户可用本机 Harness 凭据复跑 `node tests/real-integration.mjs`、`node tests/real-cancel.mjs` 和 `node tests/real-local-auth.mjs`。官方公共目录的本地 MCP 发布需要 OpenAI 合作伙伴资格与 allowlist，因此目前使用 Git/本地 marketplace 分发。下一版可增加受限容器执行、跨平台进程管理、多实例任务存储和结构化测试摘要。

MIT 许可。许可证见 [LICENSE](LICENSE)。
