// Optional real MCP smoke test with local dsh credentials; no bridge API key.
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const run=promisify(execFile);
if(Number(process.versions.node.split('.')[0])<24){console.error('UNVERIFIED: Node.js 24+ is required');process.exit(2);}
delete process.env.DEEPSEEK_API_KEY;
const base=await mkdtemp(join(tmpdir(),'bridge-local-auth-'));const repo=join(base,'repo');
let client;
try{
 await run('git',['init',repo]);await writeFile(join(repo,'README.md'),'The answer is 42.\n');await run('git',['add','.'],{cwd:repo});await run('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','base'],{cwd:repo});
 process.env.BRIDGE_STATE_DIR=join(base,'state');process.env.BRIDGE_ALLOWED_ROOTS=base;process.env.BRIDGE_ACK_HOST_ACCESS='1';process.env.BRIDGE_USE_DSH_SAVED_CREDENTIALS='1';
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve('bundle/server.js')],env:{...process.env}});
 client=new Client({name:'local-auth-smoke',version:'1.0.0'});await client.connect(transport);
 const reply=await client.callTool({name:'delegate_task',arguments:{task:'Read README.md and report the number it calls the answer. Do not edit files.',workspace:repo,acceptance_criteria:['Report the number in README.md'],timeout:90,mode:'read_only'}});
 if(reply.isError)throw Error(reply.content[0].text);
 const id=JSON.parse(reply.content[0].text).task_id;let status;
 for(let i=0;i<95;i++){status=JSON.parse((await client.callTool({name:'get_task_status',arguments:{task_id:id}})).content[0].text);if(['completed','failed','cancelled','interrupted'].includes(status.status))break;await new Promise(done=>setTimeout(done,1000));}
 const outcome=JSON.parse((await client.callTool({name:'get_task_result',arguments:{task_id:id}})).content[0].text);
 const report={task_id:id,status:outcome.status,answer:outcome.result?.final_reply??'',modified_files:outcome.result?.modified_files??[],error:outcome.error??null,used_bridge_key:false,saved_credentials_flag:true};
 console.log(JSON.stringify(report));await writeFile(join(base,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 if(outcome.status!=='completed'||!report.answer.includes('42')||report.modified_files.length)process.exitCode=1;
}finally{await client?.close();console.log(`EVIDENCE ${base}`);}
