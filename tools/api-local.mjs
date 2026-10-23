import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const config=JSON.parse(await readFile('.local/vodown-server-secrets.json','utf8'));
const env={...process.env,DOTNET_CLI_HOME:resolve('.local/dotnet')};
function flatten(value,prefix='') {
  for(const [key,item] of Object.entries(value)) {
    const name=prefix?`${prefix}__${key}`:key;
    if(item && typeof item==='object')flatten(item,name); else env[name]=String(item);
  }
}
flatten(config);
const args=process.argv.slice(2);
const command=args.length?args:['run','--project','apps/api/Vodown.API','--no-launch-profile','--urls','http://localhost:5080'];
env.ASPNETCORE_ENVIRONMENT='Development';
const child=spawn('dotnet',command,{env,stdio:'inherit',shell:false});
child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
