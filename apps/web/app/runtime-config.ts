export type PublicConfig = {supabaseUrl:string;publishableKey:string;apiUrl:string};

function origin(raw:string, development:boolean):string {
  const url=new URL(raw);
  const local=['localhost','127.0.0.1'].includes(url.hostname);
  if(url.username || url.password || url.pathname!=='/' || url.search || url.hash || !(url.protocol==='https:' || development && local && url.protocol==='http:'))throw new Error('Configuração pública inválida.');
  return url.origin;
}
function publicKey(value:string):boolean {
  if(value.startsWith('sb_publishable_'))return true;
  try {return JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString()).role==='anon';} catch {return false;}
}
export function readPublicConfig(env:NodeJS.ProcessEnv):PublicConfig|null {
  // Dynamic lookup avoids Next.js replacing NEXT_PUBLIC values at build time.
  const get=(name:string)=>env[`VODOWN_PUBLIC_${name}`] || env[`NEXT_PUBLIC_${name}`] || '';
  const supabase=get('SUPABASE_URL'),key=get('SUPABASE_PUBLISHABLE_KEY'),api=get('API_URL');
  if(!supabase && !key && !api && env.NODE_ENV!=='production')return null;
  if(!supabase || !key || !api || !publicKey(key))throw new Error('Configuração pública incompleta ou inválida.');
  const development=env.NODE_ENV!=='production';
  try{return {supabaseUrl:origin(supabase,development),publishableKey:key,apiUrl:origin(api,development)};}
  catch {throw new Error('Configuração pública incompleta ou inválida.');}
}

export function configScript(config:PublicConfig|null):string {
  // JSON is data inside a script element, so it must not be able to close it.
  return `window.__VODOWN_PUBLIC_CONFIG__=${JSON.stringify(config).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')};`;
}
