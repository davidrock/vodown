import {build} from 'vite';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';

const bundleOnly=process.argv.includes('--bundle-only');
const url=bundleOnly?'':process.env.VODOWN_EXTENSION_SUPABASE_URL || '';
const key=bundleOnly?'':process.env.VODOWN_EXTENSION_SUPABASE_PUBLISHABLE_KEY || '';
const api=bundleOnly?'':process.env.VODOWN_EXTENSION_API_URL || '';
if((url||key||api) && !(url&&key&&api))throw new Error('Configure todas as três variáveis públicas da extensão.');
if(key && !key.startsWith('sb_publishable_')){
  let role;
  try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{}
  if(role!=='anon')throw new Error('A extensão aceita apenas chave publicável ou anon, nunca secret/service_role.');
}
const manifest=JSON.parse(await readFile('chrome-extension/manifest.json','utf8'));
for(const [name,value] of [['Supabase',url],['API',api]]) if(value){
  const parsed=new URL(value);
  if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||!(parsed.protocol==='https:' || parsed.protocol==='http:' && ['localhost','127.0.0.1'].includes(parsed.hostname)))throw new Error(`${name}: use somente uma origem HTTPS ou localhost de desenvolvimento.`);
  const permission=`${parsed.protocol}//${parsed.hostname}/*`;
  if(!manifest.host_permissions.includes(permission))throw new Error(`${name}: adicione ${permission} às permissões do manifesto antes de empacotar.`);
}
await mkdir('chrome-extension/vendor/supabase',{recursive:true});
await build({configFile:false,logLevel:'warn',build:{lib:{entry:'tools/extension-supabase-entry.js',formats:['es'],fileName:()=> 'client.js'},outDir:'chrome-extension/vendor/supabase',emptyOutDir:false,minify:true,rollupOptions:{output:{inlineDynamicImports:true}}}});
await copyFile('node_modules/@supabase/supabase-js/LICENSE','chrome-extension/vendor/supabase/LICENSE');
if(!bundleOnly)await writeFile('chrome-extension/vendor/supabase/config.js',`// Public build configuration; no service-role key or server secrets.\nexport const supabaseUrl=${JSON.stringify(url.replace(/\/$/,''))};\nexport const publishableKey=${JSON.stringify(key)};\nexport const apiUrl=${JSON.stringify(api.replace(/\/$/,''))};\n`);
console.log(bundleOnly?'Cliente da extensão gerado sem alterar a configuração.':url?'Extensão configurada para os serviços públicos informados.':'Extensão preparada sem configuração de conta; downloads permanecem bloqueados.');
