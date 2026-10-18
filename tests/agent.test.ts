import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {getDeepSeekAgentHistory, getDeepSeekAgentStatus} from '../src/agent.js';

const fake = resolve('tests/fixtures/fake-dsh.cjs');

async function connect(): Promise<{client: Client; transport: StdioClientTransport}> {
  const transport = new StdioClientTransport({command: process.execPath, args: [resolve('bundle/server.js')], env: {...process.env} as Record<string, string>});
  const client = new Client({name: 'agent-test', version: '1.0.0'});
  await client.connect(transport);
  return {client, transport};
}

function data(response: unknown): any {
  return JSON.parse(((response as {content: {text: string}[]}).content)[0].text);
}

async function waitTurn(id: string, number: number): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const history = await getDeepSeekAgentHistory(id);
    if (history.some(turn => turn.turn === number && turn.status !== 'running')) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error(`Agent turn ${number} did not finish`);
}

test('persistent subagent keeps cwd, Harness session, context and history across MCP restarts', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'bridge-agent-test-'));
  const workspace = join(temp, 'project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'train.log'), 'step=1 loss=1\n');
  process.env.BRIDGE_STATE_DIR = join(temp, 'state');
  process.env.BRIDGE_ALLOWED_ROOTS = temp;
  process.env.BRIDGE_ACK_HOST_ACCESS = '1';
  process.env.BRIDGE_DSH_COMMAND = fake;
  process.env.FAKE_MONITOR_TRACE = join(temp, 'trace.jsonl');
  let first: Client | undefined;
  let second: Client | undefined;
  let id: string | undefined;
  try {
    ({client: first} = await connect());
    const created = await first.callTool({name: 'create_deepseek_agent', arguments: {workspace, role: 'Help Codex supervise model training', initial_context: 'Watch loss and report anomalies', mode: 'read_only'}});
    assert.equal(created.isError, undefined);
    id = data(created).agent_id;
    assert.equal((await getDeepSeekAgentStatus(id!)).status, 'idle');
    const submitted = await first.callTool({name: 'send_deepseek_message', arguments: {agent_id: id, message: 'AGENT_SLOW: Inspect train.log and report the current trend', timeout_seconds: 20}});
    assert.equal(submitted.isError, undefined);
    const overlapping = await first.callTool({name: 'send_deepseek_message', arguments: {agent_id: id, message: 'Do another turn concurrently', timeout_seconds: 20}});
    assert.equal(overlapping.isError, true);
    await first.close(); first = undefined;
    await waitTurn(id!, 1);
    assert.equal((await getDeepSeekAgentStatus(id!)).session_id, 'agent-session');

    await writeFile(join(workspace, 'train.log'), 'step=1 loss=1\nstep=2 loss=9\n');
    ({client: second} = await connect());
    const followup = await second.callTool({name: 'send_deepseek_message', arguments: {agent_id: id, message: 'New log line: loss=9. Reassess using prior context.', timeout_seconds: 20}});
    assert.equal(followup.isError, undefined);
    await waitTurn(id!, 2);
    const history = data(await second.callTool({name: 'get_deepseek_agent_history', arguments: {agent_id: id}}));
    assert.equal(history.length, 2);
    assert.equal(history[0].status, 'completed');
    assert.equal(history[1].status, 'completed');
    assert.match(history[1].reply, /Loss increased/);
    const trace = (await readFile(process.env.FAKE_MONITOR_TRACE!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(trace.length, 2);
    assert.equal(trace[0].cwd, workspace);
    assert.equal(trace[1].cwd, workspace);
    assert.ok(!trace[0].args.includes('--session-id'));
    assert.equal(trace[1].args[trace[1].args.indexOf('--session-id') + 1], 'agent-session');
    assert.match(trace[0].prompt, /Watch loss and report anomalies/);
    assert.doesNotMatch(trace[1].prompt, /Initial context supplied/);
    assert.equal(await readFile(join(workspace, 'train.log'), 'utf8'), 'step=1 loss=1\nstep=2 loss=9\n');
    const active = await second.callTool({name: 'send_deepseek_message', arguments: {agent_id: id, message: 'AGENT_SLOW: one last check', timeout_seconds: 20}});
    assert.equal(active.isError, undefined);
    const closed = await second.callTool({name: 'close_deepseek_agent', arguments: {agent_id: id}});
    assert.equal(data(closed).status, 'closed');
    assert.equal(data(closed).current_turn, undefined);
    assert.equal((await getDeepSeekAgentHistory(id!)).at(-1)?.status, 'cancelled');
    const rejected = await second.callTool({name: 'send_deepseek_message', arguments: {agent_id: id, message: 'One more check', timeout_seconds: 20}});
    assert.equal(rejected.isError, true);
  } finally {
    await first?.close().catch(() => {});
    await second?.close().catch(() => {});
    if (id && (await getDeepSeekAgentStatus(id).catch(() => undefined))?.status !== 'closed') {
      const {closeDeepSeekAgent} = await import('../src/agent.js');
      await closeDeepSeekAgent(id).catch(() => {});
    }
    await rm(temp, {recursive: true, force: true});
  }
});
