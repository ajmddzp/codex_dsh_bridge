import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {get,save,all} from './store.js';
import {killGroup} from './process.js';
import {validate} from './security.js';
import {command} from './process.js';
import {removeWorktree} from './workspace.js';
import type {TaskInput,TaskRecord} from './types.js';
const configuredConcurrency=Number(process.env.BRIDGE_MAX_CONCURRENT||2);
const MAX_CONCURRENT=Number.isInteger(configuredConcurrency)?Math.max(1,Math.min(8,configuredConcurrency)):2;
async function cleanup(r:TaskRecord){if(!r.worktree)return;const top=await command('git',['rev-parse','--show-toplevel'],r.input.workspace);if(top.code===0)await removeWorktree(top.stdout.trim(),r.worktree);}
export async function reconcile(){for(const r of await all()){if(['pending','running'].includes(r.status)){r.status='interrupted';r.ended_at=new Date().toISOString();r.error='MCP server restarted during task';await save(r);if(r.worker_pid&&await matchesWorker(r.worker_pid,r.task_id)){try{process.kill(r.worker_pid,'SIGTERM');}catch{}}if(r.agent_pid&&await matchesAgent(r.agent_pid))killGroup(r.agent_pid);setTimeout(()=>cleanup(r).catch(()=>{}),2000).unref();}}}
async function matchesWorker(pid:number,id:string){if(process.platform!=='linux')return false;try{return (await readFile(`/proc/${pid}/cmdline`,'utf8')).includes(id);}catch{return false;}}
async function matchesAgent(pid:number){if(process.platform!=='linux')return false;try{return (await readFile(`/proc/${pid}/cmdline`,'utf8')).includes('headless');}catch{return false;}}
export async function submit(input:TaskInput){input.workspace=await validate(input);const active=(await all()).filter(r=>['pending','running'].includes(r.status));if(active.length>=MAX_CONCURRENT)throw Error(`Concurrency limit ${MAX_CONCURRENT} reached`);
 const id=randomUUID();const r:TaskRecord={task_id:id,status:'pending',created_at:new Date().toISOString(),input};await save(r);
 const worker=new URL('./worker.js',import.meta.url).pathname;const child=spawn(process.execPath,[worker,id,String(process.pid)],{detached:true,stdio:'ignore',env:{...process.env}});if(!child.pid){r.status='failed';r.error='Could not spawn worker';await save(r);return r;}r.worker_pid=child.pid;await save(r);child.unref();return r;
}
export async function status(id:string){const r=await get(id);if(!r)throw Error('Unknown task_id');return {task_id:id,status:r.status,created_at:r.created_at,started_at:r.started_at,ended_at:r.ended_at,duration_ms:r.duration_ms??(r.started_at?Date.now()-Date.parse(r.started_at):0),latest_progress:r.latest_progress,error:r.error};}
export async function result(id:string){const r=await get(id);if(!r)throw Error('Unknown task_id');return {task_id:id,status:r.status,result:r.result??null,error:r.error};}
export async function cancel(id:string){const r=await get(id);if(!r)throw Error('Unknown task_id');if(['completed','failed','cancelled','interrupted'].includes(r.status))return {task_id:id,status:r.status};r.status='cancelled';r.ended_at=new Date().toISOString();r.error='Cancelled by caller';await save(r);if(r.worker_pid&&await matchesWorker(r.worker_pid,id)){try{process.kill(r.worker_pid,'SIGTERM');}catch{}}if(r.agent_pid&&await matchesAgent(r.agent_pid))killGroup(r.agent_pid);setTimeout(()=>cleanup(r).catch(()=>{}),2000).unref();return {task_id:id,status:r.status};}
