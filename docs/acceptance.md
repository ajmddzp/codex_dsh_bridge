# 验收记录（2026-10-18）

本记录区分真实 Harness/MCP 运行、Codex 独立复核和 Mock 自动化测试。真实执行使用用户提供的密钥，仅通过临时进程环境传入；密钥未写入本仓库或本报告。

## 环境和链路

- Linux；Node.js 24.22.0；`@deepseek-ai/dsh` 0.2.0-rc.2；Python 标准库 `unittest`；Git。
- 真实验收通过 `bundle/server.js` 的 stdio MCP 接口调用 `delegate_task`、`get_task_status`、`get_task_result`；`listTools` 返回四个预期工具。Bridge 启动真正的 `dsh --profile headless --json`，并收集其事件流、退出状态和 Git 补丁。
- 此前已在隔离的 Codex 配置中执行 `codex plugin marketplace add`、`codex plugin add`、`codex plugin list`，插件安装并启用。尚未在当前对话内通过 Codex 桌面 UI 直接点击调用插件。

## 三个真实场景

| 场景 | Harness 状态 | 原始修改 | Harness 执行测试 | Codex 复核 |
| --- | --- | --- | --- | --- |
| A：解析训练日志并导出 CSV | `completed` | `parse_train_log.py`、`test_parse_train_log.py`，以及生成的 CSV/缓存 | `python3 -m unittest discover -v`：3 项通过；脚本导出两行数据 | 只接受两个 `.py` 文件；独立运行测试与 CSV 校验通过 |
| B：补充单元测试 | `completed` | `test_stats.py`，以及 Python 缓存 | 同一命令：6 项通过 | 只接受测试文件，确认 `stats.py` 未改动 |
| C：修复简单错误 | `completed` | `module.py`、`test_module.py`，以及 Python 缓存 | 同一命令：1 项通过 | 确认 `a - b` 改为 `a + b`，接受代码与测试 |

真实执行返回的 `task_id` 分别为 `412165b2-ba55-4685-8555-f4623dd214f1`、`ed3a40a5-cf56-46eb-b75c-e7f2179ecab4`、`4bba557c-67db-4447-810e-39e989220ad3`。三个结果均包含 Harness 最终回复、修改文件列表、Git diff、测试工具事件、日志位置和耗时。

Codex 将所选源代码补丁应用到独立验收副本后，重新运行 `python3 -m unittest discover -v`，**10 项全部通过**。再次运行 CSV 脚本得到 `epoch,loss` 表头和 `(1, 0.8)`、`(2, 0.4)` 两行。原始 Git 工作区保持干净，所有任务 worktree 均已清理。生成的 `.pyc`、`__pycache__` 和输出 CSV 未被接受进代码补丁；真实验收脚本的基线仓库现已加入 `.gitignore`，避免后续运行产生这类补丁噪声。

## 取消与故障路径

真实 Harness 取消测试：`task_id` 为 `731fa0bf-4685-479c-a4d3-69898d3d2d4b`。`cancel_task` 返回 `cancelled`；随后验证 Agent 进程退出、worktree 清理，均通过。Mock 自动化测试还覆盖任务失败、超时、只读模式违规、缺少 Harness、无额外 Bridge 密钥运行、并发隔离、MCP 进程意外退出和重启后的 `interrupted` 状态。

原始单次任务验收时 `npm test` 为 **13 项通过，0 项失败**。本次真实运行发现并修复了把 `train.log` 误判为高成本训练的权限检查问题；新增回归测试。测试事件提取也收紧为只记录真正测试命令对应的 `tool_result`，避免将编辑测试文件的事件误列为测试结果。

## 安全与发布边界

Git worktree 隔离了普通代码改动，但不是 OS 沙箱。Bridge 无法阻止 Harness 工具访问运行账户可访问的工作区外路径；生产使用需在受限容器或专用账户中运行。任务文本的权限关键词检查也不能替代命令级强制策略。公开目录中的本地 MCP 插件仍需 OpenAI 的相应提交资格；本项目当前可通过 Git/本地 marketplace 安装，尚未发布到 GitHub 或官方公共目录。

原始事件、结果和独立复核副本暂存于本机私有临时目录，未加入开源包。此文档保留可公开的验收结论，不含密钥或原始日志。

## 本机 Harness 凭据复验

根据用户反馈，Bridge 已取消额外的 `DEEPSEEK_API_KEY` 必填校验，并增加 `BRIDGE_USE_DSH_SAVED_CREDENTIALS=1`。该开关使用仓库内的 [headless 凭据配置](../config/saved-credentials.patch.yml) 启用 Harness 自己的凭据服务；Bridge 不读取本机凭据文件。2026-10-18 使用 Node.js 24 与本机 `dsh` 包、**不传入 Bridge API Key**，经 MCP 提交只读任务，Harness 正确读取 README 中的 `42`，没有修改文件，状态为 `completed`。这验证了无额外 Key 的本机运行路径；所用上游认证的具体来源由 Harness 管理，Bridge 未对其做读取或归因。本机运行结果记录在私有临时验收目录。

## 持久子 agent 验收

用户进一步明确需要像 Codex subagent 一样可多次对话并保留上下文，因此 0.2.0 新增持久 DSH 子 agent 接口，而非独立的训练轮询模式。`create_deepseek_agent` 保存角色、初始背景和实时工作目录；每次 `send_deepseek_message` 都启动一轮真正的 `dsh --profile headless --json`，后续轮次传入相同的 `--session-id`。Codex 控制何时发送下一轮，并可读取历史或关闭 agent。

`npm test` 的持久子 agent 测试通过：在 MCP 连接关闭时，首轮 worker 继续完成；MCP 重新连接后，次轮使用相同 cwd 和 session ID，初始背景仅在首轮注入，历史记录与回复仍可查询。完整自动化套件共 **14 项通过，0 项失败**。

真实 Harness 复验运行 `tests/real-agent.mjs`，使用本机已保存的 Harness 凭据，无额外 Bridge API Key。首轮只读分析 `step=1 loss=1.0`；日志更新后，第二轮读到 `step=2 loss=0.8`，并准确回忆初始背景中的代号 `ORBIT-7`。两轮 session ID 一致，工作目录一致，未修改文件。安装到本机 Codex 的 0.2.0 包也以相同脚本复验通过；MCP 列出全部 10 个工具。真实测试使用一次性临时目录，结束后关闭 agent 并清理目录。此项证明多轮上下文续接可用；训练进程自动启动、周期调度或 Web UI 管理不属于当前接口。
