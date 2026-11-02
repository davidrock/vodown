import type {SupabaseClient} from '@supabase/supabase-js';

type Storage = {getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>};
type Pending = {nonce:string;flowId:string;expiresAt:number};
const pendingKey='sb-vodown-desktop-oauth-v1';
const maxAge=10*60*1000;
const genericError='Não foi possível entrar com o Google. Tente novamente.';

export function desktopOAuth({client,storage,open,supabaseUrl,now=Date.now,random=()=>crypto.randomUUID()}: {
  client:SupabaseClient;storage:Storage;open:(url:string)=>Promise<void>;supabaseUrl:string;now?:()=>number;random?:()=>string;
}) {
  // Serialize callbacks: getCurrent and onOpenUrl can report the same link.
  let handling:Promise<unknown>=Promise.resolve();
  async function start() {
    await storage.removeItem(pendingKey);
    const nonce=random();
    if(!/^[a-zA-Z0-9-]{1,128}$/.test(nonce))throw new Error(genericError);
    const redirectTo=`com.vodown.desktop://auth/callback/${nonce}`;
    const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo,skipBrowserRedirect:true}});
    if(error || !data.url || !data.flowId)throw new Error(genericError);
    const authUrl=new URL(data.url), project=new URL(supabaseUrl);
    if(authUrl.origin!==project.origin || authUrl.protocol!=='https:' || authUrl.pathname!=='/auth/v1/authorize' || authUrl.username || authUrl.password || authUrl.hash)throw new Error(genericError);
    const pending:Pending={nonce,flowId:data.flowId,expiresAt:now()+maxAge};
    await storage.setItem(pendingKey,JSON.stringify(pending));
    try {await open(authUrl.href);} catch {await storage.removeItem(pendingKey);throw new Error(genericError);}
  }
  async function consume(raw:string):Promise<boolean> {
    let url:URL;
    try {url=new URL(raw);} catch {return false;}
    if(url.protocol!=='com.vodown.desktop:' || url.hostname!=='auth' || url.username || url.password || url.port || url.hash || !url.pathname.startsWith('/callback/'))return false;
    const value=await storage.getItem(pendingKey);
    if(!value)return false;
    let pending:Pending;
    try {pending=JSON.parse(value) as Pending;} catch {await storage.removeItem(pendingKey);throw new Error(genericError);}
    if(typeof pending.nonce!=='string' || typeof pending.flowId!=='string' || typeof pending.expiresAt!=='number') {await storage.removeItem(pendingKey);throw new Error(genericError);}
    if(url.pathname!==`/callback/${pending.nonce}`)return false;
    // Remove before network access, preventing a duplicate callback or replay.
    await storage.removeItem(pendingKey);
    const codes=url.searchParams.getAll('code');
    if(pending.expiresAt<=now() || url.searchParams.has('error') || codes.length!==1 || !codes[0] || codes[0].length>4096 || url.searchParams.has('sb_flow_id'))throw new Error(genericError);
    const {data,error}=await client.auth.exchangeCodeForSession(codes[0],{flowId:pending.flowId});
    if(error || !data.session?.access_token)throw new Error(genericError);
    return true;
  }
  return {start,handle(raw:string):Promise<boolean> {
    const current=handling.then(()=>consume(raw));
    handling=current.catch(()=>{});
    return current;
  }};
}
