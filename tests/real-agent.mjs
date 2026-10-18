import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'bridge-real-agent-'));
const workspace = join(temp, 'project');
const {mkdir} = await import('node:fs/promises');
await mkdir(workspace);
await writeFile(join(workspace, 'metrics.log'), 'step=1 loss=1.0\n');
const env = {
  ...process.env,
  BRIDGE_STATE_DIR: join(temp, 'state'),
  BRIDGE_ALLOWED_ROOTS: temp,
  BRIDGE_ACK_HOST_ACCESS: '1',
  BRIDGE_DSH_COMMAND: process.env.BRIDGE_DSH_COMMAND || 'dsh',
  BRIDGE_USE_DSH_SAVED_CREDENTIALS: '1',
};
const transport = new StdioClientTransport({command: process.execPath, args: [process.env.BRIDGE_SERVER_PATH || resolve('bundle/server.js')], env});
const client = new Client({name: 'real-agent-smoke', version: '1.0.0'});
const extract = response => JSON.parse(response.content[0].text);
let id;
try {
  await client.connect(transport);
  const created = await client.callTool({name: 'create_deepseek_agent', arguments: {workspace, role: 'Help Codex examine an existing training run; do not start or change it', initial_context: 'The project codename is ORBIT-7. This is a continuity check.', mode: 'read_only'}});
  if (created.isError) throw Error(JSON.stringify(extract(created)));
  id = extract(created).agent_id;
  async function turn(message) {
    const submitted = await client.callTool({name: 'send_deepseek_message', arguments: {agent_id: id, message, timeout_seconds: 120}});
    if (submitted.isError) throw Error(JSON.stringify(extract(submitted)));
    const target = extract(submitted).turn;
    const deadline = Date.now() + 130000;
    while (Date.now() < deadline) {
      const history = extract(await client.callTool({name: 'get_deepseek_agent_history', arguments: {agent_id: id, limit: 2}}));
      const result = history.find(item => item.turn === target);
      if (result?.status !== 'running' && result) {
        if (result.status !== 'completed') throw Error(JSON.stringify(result));
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Real DSH turn did not finish');
  }
  const first = await turn('Read metrics.log and briefly state the observed loss.');
  await writeFile(join(workspace, 'metrics.log'), 'step=1 loss=1.0\nstep=2 loss=0.8\n');
  const second = await turn('Read the updated metrics.log. What was the project codename from our earlier context?');
  if (!first.session_id || first.session_id !== second.session_id) throw Error('Harness session was not reused');
  if (!/ORBIT-7/i.test(second.reply || '')) throw Error(`Follow-up did not recall context: ${second.reply}`);
  console.log(JSON.stringify({ok: true, agent_id: id, session_reused: true, first_reply: first.reply, second_reply: second.reply}, null, 2));
} finally {
  if (id) await client.callTool({name: 'close_deepseek_agent', arguments: {agent_id: id}}).catch(() => {});
  await client.close().catch(() => {});
  await rm(temp, {recursive: true, force: true});
}
