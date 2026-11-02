import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
await mkdir('.local',{recursive:true});
let config;
try {config=JSON.parse(await readFile('.local/vodown-server-secrets.json','utf8'));}
catch(error){
  if(error.code!=='ENOENT')throw error;
  const password=randomBytes(24).toString('hex');
  config={ConnectionStrings:{Vodown:`Host=localhost;Port=55439;Database=vodown;Username=vodown;Password=${password};SSL Mode=Disable`},LocalDevelopment:{PostgresPassword:password}};
  await writeFile('.local/vodown-server-secrets.json',JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});
}
const password=config.LocalDevelopment?.PostgresPassword;
if(!password)throw new Error('Configuração existente preservada. Configure seu banco pelos procedimentos de desenvolvimento.');
const child=spawnSync(process.env.VODOWN_COMPOSE_EXECUTABLE||'docker', [...(process.env.VODOWN_COMPOSE_EXECUTABLE?[]:['compose']),'-p','vodown-development','up','-d','--wait','postgres'],{env:{...process.env,VODOWN_LOCAL_DB_PASSWORD:password},stdio:'inherit'});
if(child.status!==0)process.exit(child.status||1);
console.log('PostgreSQL de desenvolvimento disponível. Aplique as migrations antes de iniciar a API.');
