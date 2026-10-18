import {spawn, type ChildProcess} from 'node:child_process';
import {createWriteStream, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {agentDir, getAgent, getTurn, saveTurn, updateAgent} from './agent-store.js';
import {killGroup} from './process.js';
import {redact} from './redact.js';
import type {AgentRecord, AgentTurn} from './agent-types.js';

const [id, turnText] = process.argv.slice(2);
const turnNumber = Number(turnText);
if (!id || !/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(turnNumber) || turnNumber < 1) process.exit(2);

let stopped = false;
let harness: ChildProcess | undefined;
const stop = () => { stopped = true; if (harness?.pid) killGroup(harness.pid); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function savedCredentialsPatch(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const path = join(dir, 'config', 'saved-credentials.patch.yml');
    if (existsSync(path)) return path;
    dir = dirname(dir);
  }
  throw Error('Bundled saved-credentials patch is missing');
}

function promptFor(record: AgentRecord, turn: AgentTurn): string {
  const first = turn.turn === 1 ? [
    `You are a DeepSeek Harness subagent assigned by Codex. Your continuing role: ${record.role}`,
    `Initial context supplied by Codex:\n${record.initial_context || '(none)'}`,
  ] : [];
  return [...first,
    'You are the continuing DeepSeek Harness subagent for this assignment.',
    `Work in the project at ${record.workspace}. This is turn ${turn.turn} of the same assignment.`,
    record.mode === 'read_only' ? 'Read and analyze only. Do not modify files or running processes.' : 'You may edit project files needed for this task. Report what you changed and how you checked it.',
    `File deletion ${turn.allow_deletion ? 'is authorized when needed' : 'is not authorized'}. Dependency installation ${turn.allow_dependency_install ? 'is authorized when needed' : 'is not authorized'}. Expensive commands such as starting model training ${turn.allow_expensive_commands ? 'are authorized when needed' : 'are not authorized'}.`,
    `Codex message:\n${turn.message}`,
    'Return a concise result with evidence, unresolved issues, and any action Codex should take next.',
  ].join('\n\n');
}

async function run(record: AgentRecord, turn: AgentTurn): Promise<void> {
  const directory = join(agentDir(), id);
  const eventsPath = join(directory, `${turn.turn}.events.jsonl`);
  const stderrPath = join(directory, `${turn.turn}.stderr.log`);
  const events = createWriteStream(eventsPath, {flags: 'w', mode: 0o600});
  const stderr = createWriteStream(stderrPath, {flags: 'w', mode: 0o600});
  const args = ['--profile', 'headless'];
  if (process.env.BRIDGE_USE_DSH_SAVED_CREDENTIALS === '1') args.push('--patch', savedCredentialsPatch());
  args.push('--json');
  if (record.session_id) args.push('--session-id', record.session_id);
  const child = spawn(process.env.BRIDGE_DSH_COMMAND || 'dsh', args, {
    cwd: record.workspace, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: true,
    env: {...process.env, DSH_PERMISSION_MODE: record.mode === 'read_only' ? 'read-only' : 'workspace-write'},
  });
  harness = child;
  child.stdin.on('error', () => {});
  let spawnError: string | undefined;
  const closed = new Promise<number>(resolve => {
    child.once('error', error => { spawnError = redact(error.message); });
    child.once('close', code => resolve(code ?? 1));
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid) killGroup(child.pid);
    setTimeout(() => { if (child.pid && child.exitCode === null) killGroup(child.pid, 'SIGKILL'); }, 1500).unref();
  }, turn.timeout_seconds * 1000);
  await updateAgent(id, current => { if (current.current_turn === turn.turn) { current.harness_pid = child.pid; current.latest_progress = 'Harness running'; } });
  child.stdin.end(promptFor(record, turn));
  let reply = '', sessionId = record.session_id, error: string | undefined;
  let sawSession = false, sawFinal = false, completed = false;
  const output = (async () => {
    for await (const line of createInterface({input: child.stdout})) {
      events.write(`${redact(line)}\n`);
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'session') {
          sawSession = true;
          sessionId = String(event.sessionId ?? '');
          if (sessionId) await updateAgent(id, current => { if (current.current_turn === turn.turn) current.session_id = sessionId; });
        }
        if (event.type === 'final') { sawFinal = true; reply = redact(String(event.text ?? '')); }
        if (event.type === 'error') error = redact(String(event.message ?? 'Harness error'));
        if (event.type === 'status') {
          if (event.phase === 'turn_end') completed = event.reason === 'completed' || (event.reason as {kind?: string} | undefined)?.kind === 'completed';
          await updateAgent(id, current => { if (current.current_turn === turn.turn) current.latest_progress = redact(String(event.phase ?? 'running')); });
        }
      } catch {}
    }
  })();
  child.stderr.on('data', chunk => { stderr.write(redact(String(chunk))); });
  const code = await closed;
  await output;
  clearTimeout(timeout);
  harness = undefined;
  events.end(); stderr.end();
  if (spawnError) error = spawnError;
  if (timedOut) error = 'Harness turn timed out';
  if (!error && (code !== 0 || !sawSession || !sawFinal || !completed)) error = `Harness turn did not complete (exit ${code})`;
  const latest = await getAgent(id);
  if (!latest || latest.status === 'closed' || latest.current_turn !== turn.turn || stopped) return;
  turn.status = error ? 'failed' : 'completed';
  turn.ended_at = new Date().toISOString();
  turn.session_id = sessionId;
  turn.reply = reply.slice(0, 100000);
  turn.error = error;
  turn.events_path = eventsPath;
  turn.stderr_path = stderrPath;
  await saveTurn(id, turn);
  await updateAgent(id, current => {
    if (current.current_turn !== turn.turn || current.status === 'closed') return;
    current.status = 'idle'; current.current_turn = undefined; current.worker_pid = undefined; current.harness_pid = undefined;
    current.session_id = sessionId || current.session_id;
    current.latest_reply = turn.reply; current.latest_error = error;
    current.latest_progress = error ? 'failed' : 'completed';
  });
}

const record = await getAgent(id);
const turn = await getTurn(id, turnNumber);
if (!record || !turn || record.status !== 'running' || record.current_turn !== turnNumber) process.exit(0);
run(record, turn).catch(async error => {
  stop();
  const latest = await getAgent(id);
  if (latest?.status === 'running' && latest.current_turn === turnNumber) {
    turn.status = 'failed'; turn.error = redact((error as Error).message); turn.ended_at = new Date().toISOString();
    await saveTurn(id, turn).catch(() => {});
    await updateAgent(id, current => { if (current.current_turn === turnNumber) { current.status = 'idle'; current.current_turn = undefined; current.worker_pid = undefined; current.harness_pid = undefined; current.latest_error = turn.error; } }).catch(() => {});
  }
  process.exitCode = 1;
});
