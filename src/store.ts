import {mkdir, readFile, writeFile, rename, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import type {TaskRecord} from './types.js';
export const stateDir = () => process.env.BRIDGE_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(),'.local','state'),'codex-deepseek-bridge');
export const taskPath = (id:string) => join(stateDir(),`${id}.json`);
export async function save(record:TaskRecord){ await mkdir(stateDir(),{recursive:true,mode:0o700}); const p=taskPath(record.task_id); const t=`${p}.${process.pid}.tmp`; await writeFile(t,JSON.stringify(record,null,2),{mode:0o600}); await rename(t,p); }
export async function get(id:string):Promise<TaskRecord|undefined>{ if(!/^[a-f0-9-]{36}$/.test(id)) return; try{return JSON.parse(await readFile(taskPath(id),'utf8')) as TaskRecord;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;} }
export async function all(){ await mkdir(stateDir(),{recursive:true,mode:0o700}); const files=await readdir(stateDir()); const result:TaskRecord[]=[];for(const file of files){if(/^[a-f0-9-]{36}\.json$/.test(file)){const rec=await get(file.slice(0,-5));if(rec)result.push(rec);}}return result; }
