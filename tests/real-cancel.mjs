// Optional, billable real-process cancellation acceptance.
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const run=promisify(execFile);
if(Number(process.versions.node.split('.')[0])<24){console.error('UNVERIFIED: requires Node.js 24+');process.exit(2);}
const base=await mkdtemp(join(tmpdir(),'bridge-cancel-'));const repo=join(base,'repo');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let client;
try{
 await run('git',['init',repo]);await writeFile(join(repo,'README.md'),'Cancellation test\n');await run('git',['add','.'],{cwd:repo});await run('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','base'],{cwd:repo});
 process.env.BRIDGE_STATE_DIR=join(base,'state');process.env.BRIDGE_ALLOWED_ROOTS=base;process.env.BRIDGE_ACK_HOST_ACCESS='1';
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve('bundle/server.js')],env:{...process.env}});
 client=new Client({name:'real-cancel-test',version:'1.0.0'});await client.connect(transport);
 const request=await client.callTool({name:'delegate_task',arguments:{task:'Run a shell command that sleeps for 60 seconds, then report that it finished. Do not edit files.',workspace:repo,acceptance_criteria:['The sleep command finishes before the final answer'],timeout:90,mode:'read_only'}});
 if(request.isError)throw Error(request.content[0].text);
 const id=JSON.parse(request.content[0].text).task_id;let record;
 for(let i=0;i<100;i++){record=JSON.parse(await readFile(join(base,'state',`${id}.json`),'utf8'));if(record.status==='running'&&record.agent_pid)break;await sleep(100);}
 if(!record?.agent_pid)throw Error('Agent process did not start');
 await sleep(1000);
 const response=await client.callTool({name:'cancel_task',arguments:{task_id:id}});const cancelled=JSON.parse(response.content[0].text);
 if(cancelled.status!=='cancelled')throw Error(`Unexpected cancellation status: ${cancelled.status}`);
 await sleep(2500);
 const state=JSON.parse((await client.callTool({name:'get_task_status',arguments:{task_id:id}})).content[0].text);
 const worktrees=(await run('git',['worktree','list','--porcelain'],{cwd:repo})).stdout.match(/^worktree /gm)||[];
 let agentAlive=false;try{process.kill(record.agent_pid,0);agentAlive=true;}catch{}
 const report={task_id:id,status:state.status,agent_process_exited:!agentAlive,worktree_cleaned:worktrees.length===1,duration_ms:state.duration_ms};
 console.log(JSON.stringify(report));await writeFile(join(base,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 if(state.status!=='cancelled'||agentAlive||worktrees.length!==1)process.exitCode=1;
}finally{await client?.close();console.log(`EVIDENCE ${base}`);}
