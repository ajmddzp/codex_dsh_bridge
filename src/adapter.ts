import {spawn, type ChildProcess} from 'node:child_process';
import {createWriteStream,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TaskInput} from './types.js';
import {redact} from './redact.js';
function savedCredentialsPatch(){let dir=dirname(fileURLToPath(import.meta.url));for(let i=0;i<4;i++){const patch=join(dir,'config','saved-credentials.patch.yml');if(existsSync(patch))return patch;dir=dirname(dir);}throw Error('Bundled saved-credentials patch is missing');}
export interface AgentRun {child:ChildProcess; done:Promise<{code:number;reply:string;test_results:string[];error?:string}>;}
export interface AgentAdapter {run(input:TaskInput,cwd:string,logs:{events:string;stderr:string},onProgress:(s:string)=>void):AgentRun;}
export class DeepSeekAdapter implements AgentAdapter {
 run(input:TaskInput,cwd:string,logs:{events:string;stderr:string},onProgress:(s:string)=>void):AgentRun{
  const prompt=[`Task: ${input.task}`,`Acceptance criteria:\n${input.acceptance_criteria.map((v,i)=>`${i+1}. ${v}`).join('\n')}`,`Mode: ${input.mode}.`,input.mode==='read_only'?'Read and analyze only. Do not edit any file.':'Modify only files needed in this isolated Git worktree.',`Do not access paths outside the worktree. File deletion ${input.allow_deletion?'is authorized when needed':'is not authorized'}. Dependency installation ${input.allow_dependency_install?'is authorized when needed':'is not authorized'}. Expensive work ${input.allow_expensive_commands?'is authorized when needed':'is not authorized'}. Run focused tests and include exact command and outcome in the final response.`].join('\n\n');
  const events=createWriteStream(logs.events,{flags:'w',mode:0o600});const stderr=createWriteStream(logs.stderr,{flags:'w',mode:0o600});
  const args=['--profile','headless'];
  if(process.env.BRIDGE_USE_DSH_SAVED_CREDENTIALS==='1')args.push('--patch',savedCredentialsPatch());
  args.push('--json');
  const child=spawn(process.env.BRIDGE_DSH_COMMAND||'dsh',args,{cwd,stdio:['pipe','pipe','pipe'],shell:false,detached:true,env:{...process.env}});
  child.stdin.end(prompt);
  let buf='',errBuf='',reply='',error:string|undefined,sawSession=false,sawFinal=false,turnCompleted=false;const test_results:string[]=[];const testCalls=new Map<string,string>();
  child.stdout.on('data',(chunk:Buffer)=>{buf+=chunk.toString();let n;while((n=buf.indexOf('\n'))>=0){const line=buf.slice(0,n);buf=buf.slice(n+1);events.write(redact(line)+'\n');try{const evt=JSON.parse(line);if(evt.type==='session')sawSession=true;if(evt.type==='final'){sawFinal=true;reply=redact(String(evt.text??''));}if(evt.type==='error')error=redact(String(evt.message??'Agent error'));if(evt.type==='status'){if(evt.phase==='turn_end')turnCompleted=evt.reason==='completed'||evt.reason?.kind==='completed';onProgress(redact(`${evt.phase}${evt.reason?`: ${JSON.stringify(evt.reason)}`:''}`));}if(evt.type==='tool_call'){const call=typeof evt.input?.command==='string'?evt.input.command:'';if(/pytest|unittest|npm test|pnpm test|yarn test|cargo test|go test/i.test(call))testCalls.set(String(evt.callId),call.slice(0,1000));}if(evt.type==='tool_result'&&typeof evt.result==='string'&&testCalls.has(String(evt.callId)))test_results.push(redact(`${testCalls.get(String(evt.callId))}\n${evt.status??''}: ${evt.result}`.slice(0,4000)));}catch{}}});
  child.stderr.on('data',(chunk:Buffer)=>{errBuf+=chunk.toString();let n;while((n=errBuf.indexOf('\n'))>=0){stderr.write(redact(errBuf.slice(0,n))+'\n');errBuf=errBuf.slice(n+1);}});
  const done=new Promise<{code:number;reply:string;test_results:string[];error?:string}>(resolve=>{child.once('error',e=>{error=redact(e.message);});child.once('close',code=>{if(buf)events.write(redact(buf));if(errBuf)stderr.write(redact(errBuf));events.end();stderr.end();if(code===0&&(!sawSession||!sawFinal||!turnCompleted))error='Harness exited without a complete headless event stream';resolve({code:code??1,reply,test_results,error});});});
  return {child,done};
 }
}
