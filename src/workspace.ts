import {join} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {command} from './process.js';
import {stateDir} from './store.js';
export async function createWorktree(workspace:string,id:string){
 const top=await command('git',['rev-parse','--show-toplevel'],workspace);if(top.code!==0)throw Error('workspace must be inside a Git repository');
 const root=top.stdout.trim();const commit=await command('git',['rev-parse','HEAD'],root);if(commit.code!==0)throw Error('repository needs at least one commit');
 const dir=join(stateDir(),'worktrees',id);await mkdir(join(stateDir(),'worktrees'),{recursive:true,mode:0o700});
 const r=await command('git',['worktree','add','--detach',dir,commit.stdout.trim()],root);if(r.code!==0)throw Error(`git worktree add failed: ${r.stderr.trim()}`);
 return {dir,root,base:commit.stdout.trim()};
}
export async function collectDiff(dir:string){
 const untracked=await command('git',['ls-files','--others','--exclude-standard','-z'],dir);
 if(untracked.code!==0)throw Error(untracked.stderr);
 const files=untracked.stdout.split('\0').filter(Boolean);
 if(files.length){const add=await command('git',['add','-N','--',...files],dir);if(add.code!==0)throw Error(add.stderr);}
 const diff=await command('git',['diff','--binary','HEAD'],dir);
 const names=await command('git',['diff','--name-only','-z','HEAD'],dir);
 if(diff.code!==0||names.code!==0)throw Error(diff.stderr||names.stderr);
 return {diff:diff.stdout,modified_files:names.stdout.split('\0').filter(Boolean)};
}
export async function removeWorktree(root:string,dir:string){const r=await command('git',['worktree','remove','--force',dir],root);if(r.code!==0){await rm(dir,{recursive:true,force:true});await command('git',['worktree','prune'],root);}}
