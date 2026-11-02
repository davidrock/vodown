import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {desktopOAuth} from '../src/oauth-flow.ts';

const nonce='33b60ef4-f28c-48df-9851-93e500867231';
function setup() {
  const values=new Map<string,string>();
  const storage={async getItem(key:string){return values.get(key)??null;},async setItem(key:string,value:string){values.set(key,value);},async removeItem(key:string){values.delete(key);}};
  let opened='',now=1000;
  const calls:string[]=[];
  const client={auth:{
    async signInWithOAuth(options:{options:{redirectTo:string}}){calls.push('start');return {data:{url:'https://example.supabase.co/auth/v1/authorize?provider=google',flowId:'matching-flow'},error:null};},
    async exchangeCodeForSession(code:string,options:{flowId:string}){calls.push(`${code}:${options.flowId}`);return {data:{session:{access_token:'secret'}},error:null};},
  }} as unknown as SupabaseClient;
  const flow=desktopOAuth({client,storage,supabaseUrl:'https://example.supabase.co',open:async url=>{opened=url;},now:()=>now,random:()=>nonce});
  return {flow,storage,calls,opened:()=>opened,advance:(ms:number)=>{now+=ms;}};
}
test('only the matching initiated callback exchanges exactly once, including duplicates',async()=>{
  const f=setup();await f.flow.start();assert.match(f.opened(),/^https:\/\/example\.supabase\.co\/auth\/v1\/authorize/);
  assert.equal(await f.flow.handle('https://attacker.invalid/callback?code=secret'),false);
  assert.equal(await f.flow.handle('com.vodown.desktop://auth/callback/wrong?code=secret'),false);
  const url=`com.vodown.desktop://auth/callback/${nonce}?code=oauth-code`;
  assert.deepEqual(await Promise.all([f.flow.handle(url),f.flow.handle(url)]),[true,false]);
  assert.deepEqual(f.calls,['start','oauth-code:matching-flow']);
});
test('expired, canceled and duplicated-code callbacks do not exchange',async()=>{
  for(const scenario of ['expired','cancel','duplicate']) {
    const f=setup();await f.flow.start();if(scenario==='expired')f.advance(10*60*1000);
    const query=scenario==='cancel'?'error=access_denied':scenario==='duplicate'?'code=one&code=two':'code=one';
    await assert.rejects(f.flow.handle(`com.vodown.desktop://auth/callback/${nonce}?${query}`));
    assert.deepEqual(f.calls,['start']);
  }
});
test('pending flow survives controller recreation, but fails closed when browser opening fails',async()=>{
  const f=setup();await f.flow.start();
  const mock={auth:{async exchangeCodeForSession(code:string,options:{flowId:string}){assert.equal(code,'code');assert.equal(options.flowId,'matching-flow');return {data:{session:{access_token:'token'}},error:null};}}} as unknown as SupabaseClient;
  const restarted=desktopOAuth({client:mock,storage:f.storage,open:async()=>{},supabaseUrl:'https://example.supabase.co',now:()=>1000});
  assert.equal(await restarted.handle(`com.vodown.desktop://auth/callback/${nonce}?code=code`),true);
  const failing=setup();
  const client={auth:{async signInWithOAuth(){return {data:{url:'https://example.supabase.co/auth/v1/authorize',flowId:'flow'},error:null};}}} as unknown as SupabaseClient;
  const failed=desktopOAuth({client,storage:failing.storage,supabaseUrl:'https://example.supabase.co',open:async()=>{throw Error('cannot open');},random:()=>nonce,now:()=>1000});
  await assert.rejects(failed.start());
  assert.equal(await failed.handle(`com.vodown.desktop://auth/callback/${nonce}?code=code`),false);
});
test('real Supabase SDK uses the original PKCE verifier and exchanges the code',async()=>{
  const values=new Map<string,string>();
  const storage={async getItem(key:string){return values.get(key)??null;},async setItem(key:string,value:string){values.set(key,value);},async removeItem(key:string){values.delete(key);}};
  const fakeFetch:typeof fetch=async(input,init)=>{
    if(!String(input).includes('/auth/v1/token'))throw new Error('Unexpected endpoint');
    const body=JSON.parse(String(init?.body));assert.equal(body.auth_code,'test-code');assert.ok(body.code_verifier);
    return new Response(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:{id:'test-user',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=createClient('https://example.supabase.co','public-key',{auth:{flowType:'pkce',storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fakeFetch}});
  let destination='';
  const first=desktopOAuth({client,storage,supabaseUrl:'https://example.supabase.co',open:async url=>{destination=url;},random:()=>nonce,now:()=>1000});
  await first.start();
  const redirect=new URL(destination).searchParams.get('redirect_to');
  assert.equal(redirect,`com.vodown.desktop://auth/callback/${nonce}`);
  const restarted=desktopOAuth({client,storage,supabaseUrl:'https://example.supabase.co',open:async()=>{},now:()=>1000});
  assert.equal(await restarted.handle(`${redirect}?code=test-code`),true);
});
