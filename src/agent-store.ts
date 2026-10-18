import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {stateDir} from './store.js';
import type {AgentRecord, AgentTurn} from './agent-types.js';

const validId = /^[a-f0-9-]{36}$/;
export const agentDir = () => join(stateDir(), 'agents');
export const agentPath = (id: string) => join(agentDir(), `${id}.json`);
export const turnPath = (id: string, turn: number) => join(agentDir(), id, `${turn}.json`);

export async function getAgent(id: string): Promise<AgentRecord | undefined> {
  if (!validId.test(id)) return;
  try { return JSON.parse(await readFile(agentPath(id), 'utf8')) as AgentRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}

export async function saveAgent(record: AgentRecord): Promise<void> {
  await mkdir(agentDir(), {recursive: true, mode: 0o700});
  const path = agentPath(record.agent_id);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2), {mode: 0o600});
  await rename(temporary, path);
}

export async function updateAgent(id: string, mutate: (record: AgentRecord) => void): Promise<AgentRecord> {
  if (!validId.test(id)) throw Error('Invalid agent ID');
  await mkdir(agentDir(), {recursive: true, mode: 0o700});
  const lock = `${agentPath(id)}.lock`;
  const deadline = Date.now() + 5000;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 30000) await rm(lock, {recursive: true, force: true}); }
      catch (staleError) { if ((staleError as NodeJS.ErrnoException).code !== 'ENOENT') throw staleError; }
      if (Date.now() >= deadline) throw Error('Agent state is busy');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    const record = await getAgent(id);
    if (!record) throw Error('Unknown agent ID');
    mutate(record);
    record.updated_at = new Date().toISOString();
    await saveAgent(record);
    return record;
  } finally { await rm(lock, {recursive: true, force: true}); }
}

export async function listAgents(): Promise<AgentRecord[]> {
  await mkdir(agentDir(), {recursive: true, mode: 0o700});
  const names = await readdir(agentDir());
  const records = await Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => getAgent(name.slice(0, -5))));
  return records.filter((record): record is AgentRecord => record !== undefined);
}

export async function saveTurn(id: string, turn: AgentTurn): Promise<void> {
  if (!validId.test(id)) throw Error('Invalid agent ID');
  const directory = join(agentDir(), id);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const path = turnPath(id, turn.turn);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(turn, null, 2), {mode: 0o600});
  await rename(temporary, path);
}

export async function getTurn(id: string, turn: number): Promise<AgentTurn | undefined> {
  if (!validId.test(id) || !Number.isSafeInteger(turn) || turn < 1) return;
  try { return JSON.parse(await readFile(turnPath(id, turn), 'utf8')) as AgentTurn; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}

export async function getTurns(id: string, limit: number): Promise<AgentTurn[]> {
  const record = await getAgent(id);
  if (!record) throw Error('Unknown agent ID');
  const start = Math.max(1, record.turns - limit + 1);
  const result = await Promise.all(Array.from({length: record.turns - start + 1}, (_, i) => getTurn(id, start + i)));
  return result.filter((turn): turn is AgentTurn => turn !== undefined);
}
