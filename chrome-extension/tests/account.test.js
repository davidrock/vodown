import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService,sessionStorageAdapter} from '../lib/account.js';
import {createClient} from '@supabase/supabase-js';

function fixture({session=true,status=200,response={allowed:true,plan:'free'}}={}) {
  let current=session ? {access_token:'secret-token',user:{email:'user@example.com'}} : null;
  const calls=[];
  const client={auth:{
    async getSession(){return {data:{session:current},error:null};},
    async signInWithPassword({email}){current={access_token:'secret-token',user:{email}};return {error:null};},
    async signOut(){current=null;return {error:null};},
  }};
  const request=async(url,options)=>{calls.push({url,options});return {status,ok:status>=200&&status<300,json:async()=>response};};
  return {service:createAccountService({client,apiUrl:'https://api.example',request}),calls};
}
test('session storage survives worker recreation and can be removed',async()=>{
  const values={};const storage={get:async k=>({[k]:values[k]}),set:async data=>Object.assign(values,data),remove:async k=>delete values[k]};
  await sessionStorageAdapter(storage).setItem('auth','sensitive');
  assert.equal(await sessionStorageAdapter(storage).getItem('auth'),'sensitive');
  await sessionStorageAdapter(storage).removeItem('auth');assert.equal(await sessionStorageAdapter(storage).getItem('auth'),null);
});
test('authorization sends server-derived selection and token, rejecting denial',async()=>{
  const {service,calls}=fixture();await service.authorize(2);
  assert.equal(calls[0].url,'https://api.example/v1/me/download-authorizations');
  assert.deepEqual(JSON.parse(calls[0].options.body),{client:'extension',lessonCount:2});
  assert.equal(calls[0].options.headers.Authorization,'Bearer secret-token');
  for(const scenario of [{status:401},{status:403},{status:500},{response:{allowed:false}}])await assert.rejects(fixture(scenario).service.authorize(1));
  await assert.rejects(fixture({session:false}).service.authorize(1));
  await assert.rejects(fixture().service.authorize(0));
});
test('failed network does not grant access or reveal credentials',async()=>{
  const {service}=fixture();
  const client={auth:{getSession:async()=>({data:{session:{access_token:'secret-token'}},error:null})}};
  const offline=createAccountService({client,apiUrl:'https://api.example',request:async()=>{throw new Error('secret-token');}});
  await assert.rejects(offline.authorize(1),error=>!error.message.includes('secret-token'));
  assert.equal((await service.status()).plan,'free');
  assert.equal((await fixture({status:500}).service.status()).plan,null);
});
test('unconfigured builds fail closed, and sign-out removes the session',async()=>{
  const unconfigured=createAccountService({client:null,apiUrl:''});
  await assert.rejects(unconfigured.authorize(1));await assert.rejects(unconfigured.signIn('a','b'));
  const {service}=fixture();await service.signOut();await assert.rejects(service.authorize(1));
});
test('real Supabase client restores the session in a new worker and enforces FREE remotely',async()=>{
  const values={};const storage={get:async k=>({[k]:values[k]}),set:async data=>Object.assign(values,data),remove:async k=>delete values[k]};
  const fetchAuth=async(url,options)=>{
    if(String(url).includes('/auth/v1/logout'))return new Response(null,{status:204});
    if(!String(url).includes('/auth/v1/token'))throw new Error('Unexpected auth endpoint');
    const body=JSON.parse(options.body);assert.equal(body.email,'user@example.com');
    return new Response(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:{id:'test-user',email:'user@example.com',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const makeClient=()=>createClient('https://example.supabase.co','public-test-key',{auth:{storage:sessionStorageAdapter(storage),persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetchAuth}});
  let allowed=true;
  const api=async(_url,options)=>{
    if(options.method==='POST')allowed=JSON.parse(options.body).lessonCount===1;
    return {status:allowed?200:403,ok:allowed,json:async()=>({allowed,plan:'free'})};
  };
  const first=createAccountService({client:makeClient(),apiUrl:'https://api.example',request:api});
  await first.signIn('user@example.com','password');
  const restarted=createAccountService({client:makeClient(),apiUrl:'https://api.example',request:api});
  assert.equal((await restarted.status()).email,'user@example.com');
  await restarted.authorize(1);
  await assert.rejects(restarted.authorize(2),/plano/);
  await restarted.signOut();await assert.rejects(restarted.authorize(1),/Entre/);
});
test('Google uses Supabase PKCE and exchanges the code from Chrome’s exact redirect',async()=>{
  const values={};const storage={get:async k=>({[k]:values[k]}),set:async data=>Object.assign(values,data),remove:async k=>delete values[k]};
  const fetchAuth=async(url,options)=>{
    assert.ok(String(url).includes('/auth/v1/token'));
    const body=JSON.parse(options.body);assert.equal(body.auth_code,'oauth-code');assert.ok(body.code_verifier);
    return new Response(JSON.stringify({access_token:'google-access',refresh_token:'google-refresh',expires_in:3600,token_type:'bearer',user:{id:'google-user',email:'user@example.com',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const sdk=createClient('https://example.supabase.co','test-key',{auth:{flowType:'pkce',storage:sessionStorageAdapter(storage),persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetchAuth}});
  const identity={getRedirectURL:path=>`https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/${path}`,async launchWebAuthFlow({url,interactive}){
    const auth=new URL(url);assert.equal(auth.origin,'https://example.supabase.co');
    assert.equal(auth.searchParams.get('provider'),'google');assert.equal(auth.searchParams.get('code_challenge_method'),'s256');assert.ok(auth.searchParams.get('code_challenge'));
    assert.equal(interactive,true);return 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oauth?code=oauth-code';
  }};
  const service=createAccountService({client:sdk,apiUrl:'https://api.example',supabaseUrl:'https://example.supabase.co',identity,request:async()=>({ok:true,status:200,json:async()=>({plan:'free'})})});
  assert.equal((await service.signInGoogle()).email,'user@example.com');
  assert.equal((await service.status()).plan,'free');
});
test('Google rejects canceled, forged and malformed callbacks before exchanging',async()=>{
  let exchanges=0;
  const client={auth:{async signInWithOAuth(){return {data:{url:'https://example.supabase.co/auth/v1/authorize?provider=google',flowId:'expected-flow'},error:null};},async exchangeCodeForSession(){exchanges++;return {data:{session:{}},error:null};}}};
  for(const returned of [undefined,'https://attacker.invalid/oauth?code=secret','https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/other?code=secret','https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oauth?code=one&code=two','https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oauth?code=secret&sb_flow_id=wrong','https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oauth?error=access_denied']) {
    const identity={getRedirectURL:()=> 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oauth',launchWebAuthFlow:async()=>returned};
    const service=createAccountService({client,apiUrl:'https://api.example',supabaseUrl:'https://example.supabase.co',identity});
    await assert.rejects(service.signInGoogle(),error=>!error.message.includes('secret'));
  }
  assert.equal(exchanges,0);
});
