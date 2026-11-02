import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
const manifest=JSON.parse(await readFile('chrome-extension/manifest.json','utf8'));
const override=process.argv.find(value=>value.startsWith('--extension-id='))?.split('=')[1];
const extensionId=override || (manifest.key ? [...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join(''):null);
if(!extensionId || !/^[a-p]{32}$/.test(extensionId))throw new Error('Informe --extension-id=<ID exibido em chrome://extensions>.');
if(process.platform!=='darwin')throw new Error('Este registro de desenvolvimento está disponível no macOS.');
const binary=resolve('apps/desktop/src-tauri/target/debug/vodown-native-host');
await access(binary);
const value={name:'com.vodown.desktop',description:'Vodown desktop bridge',path:binary,type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]};
const directory=process.argv.includes('--install') ? join(homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts') : resolve('.local/native-messaging');
await mkdir(directory,{recursive:true});
const target=join(directory,'com.vodown.desktop.json');
// Preserve an unrelated installation rather than silently replacing it.
try {const old=JSON.parse(await readFile(target,'utf8'));if(old.path!==binary)throw new Error('Já existe outra instalação do host. Remova-a pelo instalador correspondente antes de registrar esta cópia.');} catch(error) {if(error.code!=='ENOENT')throw error;}
await writeFile(target,JSON.stringify(value,null,2)+'\n',{mode:0o600});
console.log(`Host: ${target}\nExtensão permitida: ${extensionId}`);
