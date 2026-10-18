import {join} from 'node:path';
import {get,save,stateDir} from './store.js';
import {createWorktree,collectDiff,removeWorktree} from './workspace.js';
import {DeepSeekAdapter} from './adapter.js';
import type {TaskRecord} from './types.js';
import {killGroup} from './process.js';
const [id,parentText]=process.argv.slice(2);const parent=Number(parentText);
if(!id||!Number.isInteger(parent))process.exit(2);
const started=Date.now();let agentPid:number|undefined;let cancelled=false;let escalation:NodeJS.Timeout|undefined;
const stopAgent=()=>{if(agentPid){killGroup(agentPid);if(!escalation)escalation=setTimeout(()=>{if(agentPid)killGroup(agentPid,'SIGKILL');},1500).unref();}};
process.on('SIGTERM',()=>{cancelled=true;stopAgent();});
process.on('SIGINT',()=>{cancelled=true;stopAgent();});
const alive=()=>{try{process.kill(parent,0);return true;}catch{return false;}};
const watch=setInterval(async()=>{if(!alive()){cancelled=true;stopAgent();const r=await get(id);if(r&&['pending','running'].includes(r.status)){r.status='interrupted';r.ended_at=new Date().toISOString();r.error='MCP server exited';await save(r);}}},1000);
watch.unref();
async function main(){let record=await get(id);if(!record)return;let root='',dir='';
 try{
  const wt=await createWorktree(record.input.workspace,id);root=wt.root;dir=wt.dir;
  record=await get(id) as TaskRecord;if(record.status==='cancelled')return;
  record.status='running';record.started_at=new Date().toISOString();record.worktree=dir;record.latest_progress='worktree ready';await save(record);
  const logs={events:join(stateDir(),`${id}.events.jsonl`),stderr:join(stateDir(),`${id}.stderr.log`)};
  const adapter=new DeepSeekAdapter();let lastWrite=0;let progressWrite=Promise.resolve();
  const run=adapter.run(record.input,dir,logs,progress=>{if(Date.now()-lastWrite<500)return;lastWrite=Date.now();progressWrite=progressWrite.then(async()=>{const r=await get(id);if(r?.status==='running'){r.latest_progress=progress;await save(r);}}).catch(()=>{});});
  agentPid=run.child.pid;record.agent_pid=agentPid;await save(record);if(cancelled)stopAgent();
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;stopAgent();},record.input.timeout*1000);timer.unref();
  const outcome=await run.done;agentPid=undefined;clearTimeout(timer);if(escalation)clearTimeout(escalation);await progressWrite;
  const changes=await collectDiff(dir);
  record=await get(id) as TaskRecord;if(cancelled||record.status==='cancelled'||record.status==='interrupted')return;
  const readonlyViolation=record.input.mode==='read_only'&&changes.modified_files.length>0;
  const success=outcome.code===0&&!outcome.error&&!timedOut&&!readonlyViolation;
  record.status=success?'completed':'failed';record.ended_at=new Date().toISOString();record.duration_ms=Date.now()-started;record.error=timedOut?'Task timed out':readonlyViolation?'Read-only task modified files':outcome.error||(outcome.code!==0?`DeepSeek exited ${outcome.code}`:undefined);
  record.result={success,final_reply:outcome.reply,modified_files:changes.modified_files,diff:changes.diff,test_results:outcome.test_results,error:record.error,logs,duration_ms:record.duration_ms,base_commit:wt.base,limitations:[]};
  if(changes.diff.length>2_000_000){record.result.diff=changes.diff.slice(0,2_000_000);record.result.limitations?.push('Diff truncated at 2 MB; inspect log or rerun smaller task.');}
  await save(record);
 }catch(e){record=await get(id) as TaskRecord;if(record&&record.status!=='cancelled'&&record.status!=='interrupted'){record.status='failed';record.ended_at=new Date().toISOString();record.duration_ms=Date.now()-started;record.error=(e as Error).message;await save(record);}}
 finally{if(root&&dir){try{await removeWorktree(root,dir);}catch{}}clearInterval(watch);}
}
await main();
