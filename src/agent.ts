import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validate} from './security.js';
import {killGroup} from './process.js';
import {agentDir, getAgent, getTurn, getTurns, listAgents, saveAgent, saveTurn, updateAgent} from './agent-store.js';
import type {AgentMode, AgentRecord, AgentTurn} from './agent-types.js';

async function matchesProcess(pid: number, fragment: string): Promise<boolean> {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).includes(fragment); }
  catch { return false; }
}

export async function createDeepSeekAgent(input: {workspace: string; role: string; initial_context?: string; mode: AgentMode}): Promise<AgentRecord> {
  if (!input.role.trim() || input.role.length > 5000) throw Error('role must contain 1–5000 characters');
  if (input.initial_context && input.initial_context.length > 20000) throw Error('initial_context must be at most 20000 characters');
  const workspace = await validate({task: 'Inspect this project', workspace: input.workspace, acceptance_criteria: ['Report findings'], timeout: 60, mode: input.mode});
  const id = randomUUID();
  await mkdir(join(agentDir(), id), {recursive: true, mode: 0o700});
  const now = new Date().toISOString();
  const record: AgentRecord = {agent_id: id, workspace, role: input.role, initial_context: input.initial_context, mode: input.mode, status: 'idle', created_at: now, updated_at: now, turns: 0};
  await saveAgent(record);
  return record;
}

export async function sendDeepSeekMessage(input: {agent_id: string; message: string; timeout_seconds: number; allow_dependency_install?: boolean; allow_expensive_commands?: boolean; allow_deletion?: boolean}): Promise<AgentTurn> {
  if (!input.message.trim() || input.message.length > 20000) throw Error('message must contain 1–20000 characters');
  if (!Number.isInteger(input.timeout_seconds) || input.timeout_seconds < 10 || input.timeout_seconds > 3600) throw Error('timeout_seconds must be 10–3600');
  const prior = await getAgent(input.agent_id);
  if (!prior) throw Error('Unknown agent ID');
  if (prior.status !== 'idle') throw Error(`Agent is ${prior.status}`);
  await validate({task: prior.mode === 'read_only' ? 'Inspect this project' : input.message, workspace: prior.workspace, acceptance_criteria: ['Return evidence'], timeout: input.timeout_seconds, mode: prior.mode, allow_dependency_install: input.allow_dependency_install, allow_expensive_commands: input.allow_expensive_commands, allow_deletion: input.allow_deletion});
  const record = await updateAgent(input.agent_id, current => {
    if (current.status !== 'idle') throw Error(`Agent is ${current.status}`);
    current.status = 'running'; current.turns += 1; current.current_turn = current.turns;
    current.latest_progress = 'queued'; current.latest_error = undefined;
  });
  const turn: AgentTurn = {turn: record.turns, message: input.message, timeout_seconds: input.timeout_seconds, allow_dependency_install: input.allow_dependency_install, allow_expensive_commands: input.allow_expensive_commands, allow_deletion: input.allow_deletion, status: 'running', started_at: new Date().toISOString()};
  await saveTurn(input.agent_id, turn);
  const worker = new URL('./agent-worker.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [worker, input.agent_id, String(turn.turn)], {detached: true, stdio: 'ignore', env: {...process.env}});
  if (!child.pid) {
    turn.status = 'failed'; turn.error = 'Could not start agent worker'; turn.ended_at = new Date().toISOString();
    await saveTurn(input.agent_id, turn);
    await updateAgent(input.agent_id, current => { current.status = 'idle'; current.current_turn = undefined; current.latest_error = turn.error; });
    return turn;
  }
  child.unref();
  await updateAgent(input.agent_id, current => { current.worker_pid = child.pid; });
  return turn;
}

export async function getDeepSeekAgentStatus(id: string): Promise<AgentRecord> {
  const record = await getAgent(id);
  if (!record) throw Error('Unknown agent ID');
  if (record.status === 'running' && record.worker_pid && !(await matchesProcess(record.worker_pid, id))) {
    return markInterrupted(record);
  }
  return record;
}

async function markInterrupted(record: AgentRecord): Promise<AgentRecord> {
  if (record.harness_pid && await matchesProcess(record.harness_pid, 'headless')) killGroup(record.harness_pid);
  const turn = record.current_turn ? await getTurn(record.agent_id, record.current_turn) : undefined;
  if (turn?.status === 'running') {
    turn.status = 'failed'; turn.error = 'Agent worker exited before completing the turn'; turn.ended_at = new Date().toISOString();
    await saveTurn(record.agent_id, turn);
  }
  return updateAgent(record.agent_id, current => {
    if (current.status === 'running') { current.status = 'idle'; current.current_turn = undefined; current.worker_pid = undefined; current.harness_pid = undefined; current.latest_error = turn?.error; }
  });
}

export async function getDeepSeekAgentHistory(id: string, limit = 20): Promise<AgentTurn[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('limit must be 1–100');
  await getDeepSeekAgentStatus(id);
  return getTurns(id, limit);
}

export async function listDeepSeekAgents(): Promise<AgentRecord[]> {
  const records = await listAgents();
  return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function closeDeepSeekAgent(id: string): Promise<AgentRecord> {
  const record = await updateAgent(id, current => { current.status = 'closed'; current.latest_progress = 'closed'; });
  if (record.worker_pid && await matchesProcess(record.worker_pid, id)) {
    try { process.kill(record.worker_pid, 'SIGTERM'); } catch {}
  }
  if (record.harness_pid && await matchesProcess(record.harness_pid, 'headless')) killGroup(record.harness_pid);
  if (record.current_turn) {
    const turn = await getTurn(id, record.current_turn);
    if (turn?.status === 'running') { turn.status = 'cancelled'; turn.ended_at = new Date().toISOString(); turn.error = 'Agent closed by caller'; await saveTurn(id, turn); }
  }
  return updateAgent(id, current => { current.current_turn = undefined; current.worker_pid = undefined; current.harness_pid = undefined; });
}

export async function reconcileDeepSeekAgents(): Promise<void> {
  for (const record of await listAgents()) {
    if (record.status === 'running' && (!record.worker_pid || !(await matchesProcess(record.worker_pid, record.agent_id)))) await markInterrupted(record);
  }
}
