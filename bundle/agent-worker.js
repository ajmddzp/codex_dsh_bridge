// src/agent-worker.ts
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// src/agent-store.ts
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/store.ts
import { join } from "node:path";
import { homedir } from "node:os";
var stateDir = () => process.env.BRIDGE_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "codex-deepseek-bridge");

// src/agent-store.ts
var validId = /^[a-f0-9-]{36}$/;
var agentDir = () => join2(stateDir(), "agents");
var agentPath = (id2) => join2(agentDir(), `${id2}.json`);
var turnPath = (id2, turn2) => join2(agentDir(), id2, `${turn2}.json`);
async function getAgent(id2) {
  if (!validId.test(id2)) return;
  try {
    return JSON.parse(await readFile(agentPath(id2), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}
async function saveAgent(record2) {
  await mkdir(agentDir(), { recursive: true, mode: 448 });
  const path = agentPath(record2.agent_id);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record2, null, 2), { mode: 384 });
  await rename(temporary, path);
}
async function updateAgent(id2, mutate) {
  if (!validId.test(id2)) throw Error("Invalid agent ID");
  await mkdir(agentDir(), { recursive: true, mode: 448 });
  const lock = `${agentPath(id2)}.lock`;
  const deadline = Date.now() + 5e3;
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 3e4) await rm(lock, { recursive: true, force: true });
      } catch (staleError) {
        if (staleError.code !== "ENOENT") throw staleError;
      }
      if (Date.now() >= deadline) throw Error("Agent state is busy");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    const record2 = await getAgent(id2);
    if (!record2) throw Error("Unknown agent ID");
    mutate(record2);
    record2.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await saveAgent(record2);
    return record2;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
async function saveTurn(id2, turn2) {
  if (!validId.test(id2)) throw Error("Invalid agent ID");
  const directory = join2(agentDir(), id2);
  await mkdir(directory, { recursive: true, mode: 448 });
  const path = turnPath(id2, turn2.turn);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(turn2, null, 2), { mode: 384 });
  await rename(temporary, path);
}
async function getTurn(id2, turn2) {
  if (!validId.test(id2) || !Number.isSafeInteger(turn2) || turn2 < 1) return;
  try {
    return JSON.parse(await readFile(turnPath(id2, turn2), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}

// src/process.ts
function killGroup(pid, signal = "SIGTERM") {
  try {
    process.kill(-pid, signal);
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
}

// src/redact.ts
function redact(value) {
  const key = process.env.DEEPSEEK_API_KEY;
  const withoutEnvKey = key ? value.replaceAll(key, "[REDACTED]") : value;
  return withoutEnvKey.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}

// src/agent-worker.ts
var [id, turnText] = process.argv.slice(2);
var turnNumber = Number(turnText);
if (!id || !/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(turnNumber) || turnNumber < 1) process.exit(2);
var stopped = false;
var harness;
var stop = () => {
  stopped = true;
  if (harness?.pid) killGroup(harness.pid);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
function savedCredentialsPatch() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const path = join3(dir, "config", "saved-credentials.patch.yml");
    if (existsSync(path)) return path;
    dir = dirname(dir);
  }
  throw Error("Bundled saved-credentials patch is missing");
}
function promptFor(record2, turn2) {
  const first = turn2.turn === 1 ? [
    `You are a DeepSeek Harness subagent assigned by Codex. Your continuing role: ${record2.role}`,
    `Initial context supplied by Codex:
${record2.initial_context || "(none)"}`
  ] : [];
  return [
    ...first,
    "You are the continuing DeepSeek Harness subagent for this assignment.",
    `Work in the project at ${record2.workspace}. This is turn ${turn2.turn} of the same assignment.`,
    record2.mode === "read_only" ? "Read and analyze only. Do not modify files or running processes." : "You may edit project files needed for this task. Report what you changed and how you checked it.",
    `File deletion ${turn2.allow_deletion ? "is authorized when needed" : "is not authorized"}. Dependency installation ${turn2.allow_dependency_install ? "is authorized when needed" : "is not authorized"}. Expensive commands such as starting model training ${turn2.allow_expensive_commands ? "are authorized when needed" : "are not authorized"}.`,
    `Codex message:
${turn2.message}`,
    "Return a concise result with evidence, unresolved issues, and any action Codex should take next."
  ].join("\n\n");
}
async function run(record2, turn2) {
  const directory = join3(agentDir(), id);
  const eventsPath = join3(directory, `${turn2.turn}.events.jsonl`);
  const stderrPath = join3(directory, `${turn2.turn}.stderr.log`);
  const events = createWriteStream(eventsPath, { flags: "w", mode: 384 });
  const stderr = createWriteStream(stderrPath, { flags: "w", mode: 384 });
  const args = ["--profile", "headless"];
  if (process.env.BRIDGE_USE_DSH_SAVED_CREDENTIALS === "1") args.push("--patch", savedCredentialsPatch());
  args.push("--json");
  if (record2.session_id) args.push("--session-id", record2.session_id);
  const child = spawn(process.env.BRIDGE_DSH_COMMAND || "dsh", args, {
    cwd: record2.workspace,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: true,
    env: { ...process.env, DSH_PERMISSION_MODE: record2.mode === "read_only" ? "read-only" : "workspace-write" }
  });
  harness = child;
  child.stdin.on("error", () => {
  });
  let spawnError;
  const closed = new Promise((resolve) => {
    child.once("error", (error2) => {
      spawnError = redact(error2.message);
    });
    child.once("close", (code2) => resolve(code2 ?? 1));
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid) killGroup(child.pid);
    setTimeout(() => {
      if (child.pid && child.exitCode === null) killGroup(child.pid, "SIGKILL");
    }, 1500).unref();
  }, turn2.timeout_seconds * 1e3);
  await updateAgent(id, (current) => {
    if (current.current_turn === turn2.turn) {
      current.harness_pid = child.pid;
      current.latest_progress = "Harness running";
    }
  });
  child.stdin.end(promptFor(record2, turn2));
  let reply = "", sessionId = record2.session_id, error;
  let sawSession = false, sawFinal = false, completed = false;
  const output = (async () => {
    for await (const line of createInterface({ input: child.stdout })) {
      events.write(`${redact(line)}
`);
      try {
        const event = JSON.parse(line);
        if (event.type === "session") {
          sawSession = true;
          sessionId = String(event.sessionId ?? "");
          if (sessionId) await updateAgent(id, (current) => {
            if (current.current_turn === turn2.turn) current.session_id = sessionId;
          });
        }
        if (event.type === "final") {
          sawFinal = true;
          reply = redact(String(event.text ?? ""));
        }
        if (event.type === "error") error = redact(String(event.message ?? "Harness error"));
        if (event.type === "status") {
          if (event.phase === "turn_end") completed = event.reason === "completed" || event.reason?.kind === "completed";
          await updateAgent(id, (current) => {
            if (current.current_turn === turn2.turn) current.latest_progress = redact(String(event.phase ?? "running"));
          });
        }
      } catch {
      }
    }
  })();
  child.stderr.on("data", (chunk) => {
    stderr.write(redact(String(chunk)));
  });
  const code = await closed;
  await output;
  clearTimeout(timeout);
  harness = void 0;
  events.end();
  stderr.end();
  if (spawnError) error = spawnError;
  if (timedOut) error = "Harness turn timed out";
  if (!error && (code !== 0 || !sawSession || !sawFinal || !completed)) error = `Harness turn did not complete (exit ${code})`;
  const latest = await getAgent(id);
  if (!latest || latest.status === "closed" || latest.current_turn !== turn2.turn || stopped) return;
  turn2.status = error ? "failed" : "completed";
  turn2.ended_at = (/* @__PURE__ */ new Date()).toISOString();
  turn2.session_id = sessionId;
  turn2.reply = reply.slice(0, 1e5);
  turn2.error = error;
  turn2.events_path = eventsPath;
  turn2.stderr_path = stderrPath;
  await saveTurn(id, turn2);
  await updateAgent(id, (current) => {
    if (current.current_turn !== turn2.turn || current.status === "closed") return;
    current.status = "idle";
    current.current_turn = void 0;
    current.worker_pid = void 0;
    current.harness_pid = void 0;
    current.session_id = sessionId || current.session_id;
    current.latest_reply = turn2.reply;
    current.latest_error = error;
    current.latest_progress = error ? "failed" : "completed";
  });
}
var record = await getAgent(id);
var turn = await getTurn(id, turnNumber);
if (!record || !turn || record.status !== "running" || record.current_turn !== turnNumber) process.exit(0);
run(record, turn).catch(async (error) => {
  stop();
  const latest = await getAgent(id);
  if (latest?.status === "running" && latest.current_turn === turnNumber) {
    turn.status = "failed";
    turn.error = redact(error.message);
    turn.ended_at = (/* @__PURE__ */ new Date()).toISOString();
    await saveTurn(id, turn).catch(() => {
    });
    await updateAgent(id, (current) => {
      if (current.current_turn === turnNumber) {
        current.status = "idle";
        current.current_turn = void 0;
        current.worker_pid = void 0;
        current.harness_pid = void 0;
        current.latest_error = turn.error;
      }
    }).catch(() => {
    });
  }
  process.exitCode = 1;
});
