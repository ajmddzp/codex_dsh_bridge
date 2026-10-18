#!/usr/bin/env node
let prompt='';process.stdin.on('data',b=>prompt+=b);process.stdin.on('end',async()=>{
 const fs=require('node:fs');const path=require('node:path');
 if(prompt.includes('EMPTY'))process.exit(0);
 if(prompt.includes('LEAK')){console.error(process.env.DEEPSEEK_API_KEY);console.log(JSON.stringify({type:'session',sessionId:'fake'}));console.log(JSON.stringify({type:'status',phase:'turn_end',reason:'completed'}));console.log(JSON.stringify({type:'final',text:process.env.DEEPSEEK_API_KEY}));return;}
 if(prompt.includes('CHECKPATCH')){const ok=process.argv.includes('--patch')&&fs.existsSync(process.argv[process.argv.indexOf('--patch')+1]);console.log(JSON.stringify({type:'session',sessionId:'fake'}));console.log(JSON.stringify({type:'status',phase:'turn_end',reason:'completed'}));console.log(JSON.stringify({type:'final',text:ok?'patch enabled':'patch missing'}));return;}
 console.log(JSON.stringify({type:'session',sessionId:'fake'}));
 console.log(JSON.stringify({type:'status',phase:'turn_start'}));
 console.log(JSON.stringify({type:'tool_call',callId:'test-1',tool:'bash',input:{command:'python3 -m unittest discover -v'}}));
 if(prompt.includes('SLOW')){await new Promise(r=>setTimeout(r,30000));}
 if(prompt.includes('FAIL')){console.log(JSON.stringify({type:'error',message:'mock failure'}));process.exit(1);}
 if(prompt.includes('LOSS')){fs.writeFileSync('loss_to_csv.py','import csv\nimport re\n\ndef parse(text):\n    return [float(x) for x in re.findall(r"loss=([0-9.]+)", text)]\n');}
 if(prompt.includes('UNIT')){fs.writeFileSync('test_module.py','from module import add\n\ndef test_add():\n    assert add(1, 2) == 3\n');}
 if(prompt.includes('FIX')){fs.writeFileSync('module.py','def add(a, b):\n    return a + b\n');}
 console.log(JSON.stringify({type:'tool_result',callId:'test-1',status:'completed',result:'pytest: 1 passed'}));
 console.log(JSON.stringify({type:'status',phase:'turn_end',reason:'completed'}));
 console.log(JSON.stringify({type:'final',text:'Mock agent completed and ran pytest.'}));
});
