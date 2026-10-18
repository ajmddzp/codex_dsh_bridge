// src/worker.ts
import { join as join4 } from "node:path";

// src/store.ts
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
var stateDir = () => process.env.BRIDGE_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "codex-deepseek-bridge");
var taskPath = (id2) => join(stateDir(), `${id2}.json`);
async function save(record) {
  await mkdir(stateDir(), { recursive: true, mode: 448 });
  const p = taskPath(record.task_id);
  const t = `${p}.${process.pid}.tmp`;
  await writeFile(t, JSON.stringify(record, null, 2), { mode: 384 });
  await rename(t, p);
}
async function get(id2) {
  if (!/^[a-f0-9-]{36}$/.test(id2)) return;
  try {
    return JSON.parse(await readFile(taskPath(id2), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
}

// src/workspace.ts
import { join as join2 } from "node:path";
import { mkdir as mkdir2, rm } from "node:fs/promises";

// src/process.ts
import { spawn } from "node:child_process";
function command(command2, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(command2, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "", stderr = "";
    p.stdout.on("data", (b) => stdout += b);
    p.stderr.on("data", (b) => stderr += b);
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
function killGroup(pid, signal = "SIGTERM") {
  try {
    process.kill(-pid, signal);
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
}

// src/workspace.ts
async function createWorktree(workspace, id2) {
  const top = await command("git", ["rev-parse", "--show-toplevel"], workspace);
  if (top.code !== 0) throw Error("workspace must be inside a Git repository");
  const root = top.stdout.trim();
  const commit = await command("git", ["rev-parse", "HEAD"], root);
  if (commit.code !== 0) throw Error("repository needs at least one commit");
  const dir = join2(stateDir(), "worktrees", id2);
  await mkdir2(join2(stateDir(), "worktrees"), { recursive: true, mode: 448 });
  const r = await command("git", ["worktree", "add", "--detach", dir, commit.stdout.trim()], root);
  if (r.code !== 0) throw Error(`git worktree add failed: ${r.stderr.trim()}`);
  return { dir, root, base: commit.stdout.trim() };
}
async function collectDiff(dir) {
  const untracked = await command("git", ["ls-files", "--others", "--exclude-standard", "-z"], dir);
  if (untracked.code !== 0) throw Error(untracked.stderr);
  const files = untracked.stdout.split("\0").filter(Boolean);
  if (files.length) {
    const add = await command("git", ["add", "-N", "--", ...files], dir);
    if (add.code !== 0) throw Error(add.stderr);
  }
  const diff = await command("git", ["diff", "--binary", "HEAD"], dir);
  const names = await command("git", ["diff", "--name-only", "-z", "HEAD"], dir);
  if (diff.code !== 0 || names.code !== 0) throw Error(diff.stderr || names.stderr);
  return { diff: diff.stdout, modified_files: names.stdout.split("\0").filter(Boolean) };
}
async function removeWorktree(root, dir) {
  const r = await command("git", ["worktree", "remove", "--force", dir], root);
  if (r.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    await command("git", ["worktree", "prune"], root);
  }
}

// src/adapter.ts
import { spawn as spawn2 } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// src/redact.ts
function redact(value) {
  const key = process.env.DEEPSEEK_API_KEY;
  const withoutEnvKey = key ? value.replaceAll(key, "[REDACTED]") : value;
  return withoutEnvKey.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}

// src/adapter.ts
function savedCredentialsPatch() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const patch = join3(dir, "config", "saved-credentials.patch.yml");
    if (existsSync(patch)) return patch;
    dir = dirname(dir);
  }
  throw Error("Bundled saved-credentials patch is missing");
}
var DeepSeekAdapter = class {
  run(input, cwd, logs, onProgress) {
    const prompt = [`Task: ${input.task}`, `Acceptance criteria:
${input.acceptance_criteria.map((v, i) => `${i + 1}. ${v}`).join("\n")}`, `Mode: ${input.mode}.`, input.mode === "read_only" ? "Read and analyze only. Do not edit any file." : "Modify only files needed in this isolated Git worktree.", `Do not access paths outside the worktree. File deletion ${input.allow_deletion ? "is authorized when needed" : "is not authorized"}. Dependency installation ${input.allow_dependency_install ? "is authorized when needed" : "is not authorized"}. Expensive work ${input.allow_expensive_commands ? "is authorized when needed" : "is not authorized"}. Run focused tests and include exact command and outcome in the final response.`].join("\n\n");
    const events = createWriteStream(logs.events, { flags: "w", mode: 384 });
    const stderr = createWriteStream(logs.stderr, { flags: "w", mode: 384 });
    const args = ["--profile", "headless"];
    if (process.env.BRIDGE_USE_DSH_SAVED_CREDENTIALS === "1") args.push("--patch", savedCredentialsPatch());
    args.push("--json");
    const child = spawn2(process.env.BRIDGE_DSH_COMMAND || "dsh", args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: true, env: { ...process.env } });
    child.stdin.end(prompt);
    let buf = "", errBuf = "", reply = "", error, sawSession = false, sawFinal = false, turnCompleted = false;
    const test_results = [];
    const testCalls = /* @__PURE__ */ new Map();
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let n;
      while ((n = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(n + 1);
        events.write(redact(line) + "\n");
        try {
          const evt = JSON.parse(line);
          if (evt.type === "session") sawSession = true;
          if (evt.type === "final") {
            sawFinal = true;
            reply = redact(String(evt.text ?? ""));
          }
          if (evt.type === "error") error = redact(String(evt.message ?? "Agent error"));
          if (evt.type === "status") {
            if (evt.phase === "turn_end") turnCompleted = evt.reason === "completed" || evt.reason?.kind === "completed";
            onProgress(redact(`${evt.phase}${evt.reason ? `: ${JSON.stringify(evt.reason)}` : ""}`));
          }
          if (evt.type === "tool_call") {
            const call = typeof evt.input?.command === "string" ? evt.input.command : "";
            if (/pytest|unittest|npm test|pnpm test|yarn test|cargo test|go test/i.test(call)) testCalls.set(String(evt.callId), call.slice(0, 1e3));
          }
          if (evt.type === "tool_result" && typeof evt.result === "string" && testCalls.has(String(evt.callId))) test_results.push(redact(`${testCalls.get(String(evt.callId))}
${evt.status ?? ""}: ${evt.result}`.slice(0, 4e3)));
        } catch {
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      errBuf += chunk.toString();
      let n;
      while ((n = errBuf.indexOf("\n")) >= 0) {
        stderr.write(redact(errBuf.slice(0, n)) + "\n");
        errBuf = errBuf.slice(n + 1);
      }
    });
    const done = new Promise((resolve) => {
      child.once("error", (e) => {
        error = redact(e.message);
      });
      child.once("close", (code) => {
        if (buf) events.write(redact(buf));
        if (errBuf) stderr.write(redact(errBuf));
        events.end();
        stderr.end();
        if (code === 0 && (!sawSession || !sawFinal || !turnCompleted)) error = "Harness exited without a complete headless event stream";
        resolve({ code: code ?? 1, reply, test_results, error });
      });
    });
    return { child, done };
  }
};

// src/worker.ts
var [id, parentText] = process.argv.slice(2);
var parent = Number(parentText);
if (!id || !Number.isInteger(parent)) process.exit(2);
var started = Date.now();
var agentPid;
var cancelled = false;
var escalation;
var stopAgent = () => {
  if (agentPid) {
    killGroup(agentPid);
    if (!escalation) escalation = setTimeout(() => {
      if (agentPid) killGroup(agentPid, "SIGKILL");
    }, 1500).unref();
  }
};
process.on("SIGTERM", () => {
  cancelled = true;
  stopAgent();
});
process.on("SIGINT", () => {
  cancelled = true;
  stopAgent();
});
var alive = () => {
  try {
    process.kill(parent, 0);
    return true;
  } catch {
    return false;
  }
};
var watch = setInterval(async () => {
  if (!alive()) {
    cancelled = true;
    stopAgent();
    const r = await get(id);
    if (r && ["pending", "running"].includes(r.status)) {
      r.status = "interrupted";
      r.ended_at = (/* @__PURE__ */ new Date()).toISOString();
      r.error = "MCP server exited";
      await save(r);
    }
  }
}, 1e3);
watch.unref();
async function main() {
  let record = await get(id);
  if (!record) return;
  let root = "", dir = "";
  try {
    const wt = await createWorktree(record.input.workspace, id);
    root = wt.root;
    dir = wt.dir;
    record = await get(id);
    if (record.status === "cancelled") return;
    record.status = "running";
    record.started_at = (/* @__PURE__ */ new Date()).toISOString();
    record.worktree = dir;
    record.latest_progress = "worktree ready";
    await save(record);
    const logs = { events: join4(stateDir(), `${id}.events.jsonl`), stderr: join4(stateDir(), `${id}.stderr.log`) };
    const adapter = new DeepSeekAdapter();
    let lastWrite = 0;
    let progressWrite = Promise.resolve();
    const run = adapter.run(record.input, dir, logs, (progress) => {
      if (Date.now() - lastWrite < 500) return;
      lastWrite = Date.now();
      progressWrite = progressWrite.then(async () => {
        const r = await get(id);
        if (r?.status === "running") {
          r.latest_progress = progress;
          await save(r);
        }
      }).catch(() => {
      });
    });
    agentPid = run.child.pid;
    record.agent_pid = agentPid;
    await save(record);
    if (cancelled) stopAgent();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopAgent();
    }, record.input.timeout * 1e3);
    timer.unref();
    const outcome = await run.done;
    agentPid = void 0;
    clearTimeout(timer);
    if (escalation) clearTimeout(escalation);
    await progressWrite;
    const changes = await collectDiff(dir);
    record = await get(id);
    if (cancelled || record.status === "cancelled" || record.status === "interrupted") return;
    const readonlyViolation = record.input.mode === "read_only" && changes.modified_files.length > 0;
    const success = outcome.code === 0 && !outcome.error && !timedOut && !readonlyViolation;
    record.status = success ? "completed" : "failed";
    record.ended_at = (/* @__PURE__ */ new Date()).toISOString();
    record.duration_ms = Date.now() - started;
    record.error = timedOut ? "Task timed out" : readonlyViolation ? "Read-only task modified files" : outcome.error || (outcome.code !== 0 ? `DeepSeek exited ${outcome.code}` : void 0);
    record.result = { success, final_reply: outcome.reply, modified_files: changes.modified_files, diff: changes.diff, test_results: outcome.test_results, error: record.error, logs, duration_ms: record.duration_ms, base_commit: wt.base, limitations: [] };
    if (changes.diff.length > 2e6) {
      record.result.diff = changes.diff.slice(0, 2e6);
      record.result.limitations?.push("Diff truncated at 2 MB; inspect log or rerun smaller task.");
    }
    await save(record);
  } catch (e) {
    record = await get(id);
    if (record && record.status !== "cancelled" && record.status !== "interrupted") {
      record.status = "failed";
      record.ended_at = (/* @__PURE__ */ new Date()).toISOString();
      record.duration_ms = Date.now() - started;
      record.error = e.message;
      await save(record);
    }
  } finally {
    if (root && dir) {
      try {
        await removeWorktree(root, dir);
      } catch {
      }
    }
    clearInterval(watch);
  }
}
await main();
