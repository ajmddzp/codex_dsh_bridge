// Optional, billable end-to-end acceptance. Uses the configured dsh credentials.
// Retains the temporary workspaces and redacted logs for Codex review.
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const run=promisify(execFile);
if(Number(process.versions.node.split('.')[0])<24){console.error('UNVERIFIED: DeepSeek Harness CLI requires Node.js 24+');process.exit(2);}
const base=await mkdtemp(join(tmpdir(),'bridge-real-'));const repo=join(base,'repo');
const report={workspace:base,started_at:new Date().toISOString(),tool_names:[],scenarios:[]};
const git=async(args,cwd)=>run('git',args,{cwd});
try{
 await git(['init',repo]);await git(['config','user.email','bridge@example.invalid'],repo);await git(['config','user.name','Bridge Test'],repo);
 await writeFile(join(repo,'module.py'),'def add(a, b):\n    return a - b\n');
 await writeFile(join(repo,'stats.py'),'def mean(values):\n    values = list(values)\n    if not values:\n        raise ValueError("empty values")\n    return sum(values) / len(values)\n');
 await writeFile(join(repo,'train.log'),'epoch=1 loss=0.8\nepoch=2 loss=0.4\n');
 await writeFile(join(repo,'.gitignore'),'__pycache__/\n*.pyc\ntrain.csv\n');
 await git(['add','.'],repo);await git(['commit','-m','base'],repo);
 process.env.BRIDGE_STATE_DIR=join(base,'state');process.env.BRIDGE_ALLOWED_ROOTS=base;process.env.BRIDGE_ACK_HOST_ACCESS='1';
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve('bundle/server.js')],env:{...process.env}});
 const client=new Client({name:'codex-deepseek-acceptance',version:'1.0.0'});
 await client.connect(transport);
 try{
  const tools=await client.listTools();report.tool_names=tools.tools.map(t=>t.name).sort();
  console.log('MCP tools:',report.tool_names.join(', '));
  const cases=[
   {name:'A',task:'Write a Python script that parses epoch and loss from train.log and exports a CSV file. Add a unittest test that checks the two numeric rows. Run python3 -m unittest discover -v. Do not install dependencies.',acceptance_criteria:['CSV parser and test are added','Unittest command is run and result is recorded']},
   {name:'B',task:'Add meaningful unittest tests for stats.py mean(), including normal values and the empty-input error. Run python3 -m unittest discover -v. Do not change stats.py or install dependencies.',acceptance_criteria:['New unit tests exercise normal and error cases','Unittest result is recorded']},
   {name:'C',task:'Find and fix the arithmetic bug in module.py add(). Add or run a focused unittest proving add(1, 2) == 3. Run python3 -m unittest discover -v. Do not install dependencies.',acceptance_criteria:['Patch changes the faulty behavior','Focused unittest passes and result is recorded']}
  ];
  for(const spec of cases){
   console.log(`START ${spec.name}`);
   const reply=await client.callTool({name:'delegate_task',arguments:{task:spec.task,workspace:repo,acceptance_criteria:spec.acceptance_criteria,timeout:300,mode:'write'}});
   if(reply.isError)throw Error(`delegate_task ${spec.name}: ${reply.content?.[0]?.text}`);
   const submitted=JSON.parse(reply.content[0].text);const id=submitted.task_id;
   let state;const deadline=Date.now()+315000;
   while(Date.now()<deadline){const response=await client.callTool({name:'get_task_status',arguments:{task_id:id}});state=JSON.parse(response.content[0].text);if(['completed','failed','cancelled','interrupted'].includes(state.status))break;await new Promise(done=>setTimeout(done,2000));}
   if(!state||!['completed','failed','cancelled','interrupted'].includes(state.status)){await client.callTool({name:'cancel_task',arguments:{task_id:id}});throw Error(`${spec.name} exceeded polling deadline`);}
   const response=await client.callTool({name:'get_task_result',arguments:{task_id:id}});const outcome=JSON.parse(response.content[0].text);
   const item={scenario:spec.name,task_id:id,status:outcome.status,error:outcome.error,modified_files:outcome.result?.modified_files??[],diff:outcome.result?.diff??'',test_results:outcome.result?.test_results??[],final_reply:outcome.result?.final_reply??'',logs:outcome.result?.logs??null,duration_ms:outcome.result?.duration_ms??null};
   report.scenarios.push(item);
   console.log(`RESULT ${spec.name}: ${item.status}; files=${item.modified_files.join(',')}; test_events=${item.test_results.length}; error=${item.error??'none'}`);
   if(item.status!=='completed'||!item.diff||!item.test_results.length)process.exitCode=1;
   await writeFile(join(base,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  }
 }finally{await client.close();}
}finally{report.ended_at=new Date().toISOString();await writeFile(join(base,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(`EVIDENCE ${base}`);}
