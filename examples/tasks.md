# 三个任务示例 / Three task examples

将 `workspace` 改为你的 Git 项目的绝对路径。任务从已提交的 `HEAD` 开始。

## A：训练日志转 CSV

```json
{"task":"编写 Python 脚本，提取训练日志中的 loss 并导出 CSV；添加样例测试并运行。","workspace":"/absolute/path/to/repo","acceptance_criteria":["脚本读取日志并生成 loss CSV","运行测试并给出结果"],"timeout":300,"mode":"write"}
```

## B：补充单元测试

```json
{"task":"为 module.py 补充边界条件单元测试并运行 pytest。","workspace":"/absolute/path/to/repo","acceptance_criteria":["新增有意义的测试","测试运行结果可查"],"timeout":300,"mode":"write"}
```

## C：分析并修复简单错误

```json
{"task":"定位 module.py 中的简单运行错误；仅在确认原因后修复并运行相关测试。","workspace":"/absolute/path/to/repo","acceptance_criteria":["描述错误原因","给出最小修复补丁","运行相关测试"],"timeout":300,"mode":"write"}
```
