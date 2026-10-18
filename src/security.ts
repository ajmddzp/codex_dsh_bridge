import {realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import type {TaskInput} from './types.js';
export async function validate(input:TaskInput){
 if(!input.task.trim()||input.task.length>20000)throw Error('task must contain 1–20000 characters');
 if(!Array.isArray(input.acceptance_criteria)||!input.acceptance_criteria.length||input.acceptance_criteria.some(x=>!x.trim()))throw Error('acceptance_criteria must be a nonempty list');
 if(!Number.isInteger(input.timeout)||input.timeout<10||input.timeout>3600)throw Error('timeout must be 10–3600 seconds');
 if(!isAbsolute(input.workspace))throw Error('workspace must be an absolute path');
 const roots=(process.env.BRIDGE_ALLOWED_ROOTS||'').split(':').filter(Boolean);
 if(!roots.length)throw Error('BRIDGE_ALLOWED_ROOTS is required; configure allowed workspace roots');
 const ws=await realpath(resolve(input.workspace));if(!(await stat(ws)).isDirectory())throw Error('workspace is not a directory');
 let allowed=false;for(const root of roots){const rr=await realpath(resolve(root));const rel=relative(rr,ws);if(rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))allowed=true;}
 if(!allowed)throw Error('workspace is outside BRIDGE_ALLOWED_ROOTS');
 if(process.env.BRIDGE_ACK_HOST_ACCESS!=='1')throw Error('Local Harness is not OS-sandboxed; set BRIDGE_ACK_HOST_ACCESS=1 after reviewing the security notes');
 const danger=/\b(rm\s+-[rRfF]*r|sudo|mkfs|dd\s+if=|shutdown|reboot|userdel|chmod\s+-R|chown\s+-R)\b/i;
 if(danger.test(input.task))throw Error('Task contains a blocked high-risk command; rewrite the task');
 if(/\b(npm install|pip install|apt install|pnpm install|yarn add)\b/i.test(input.task)&&!input.allow_dependency_install)throw Error('Dependency installation needs allow_dependency_install');
 if(/\b(train(?:ing)?(?:\s+(?:a|the|this))?\s+(?:model|network|run)|gpu|cuda)\b/i.test(input.task)&&!input.allow_expensive_commands)throw Error('High-cost work needs allow_expensive_commands');
 if(/\b(delete|remove files|删除文件|清空目录)\b/i.test(input.task)&&!input.allow_deletion)throw Error('Deletion needs allow_deletion');
 return ws;
}
