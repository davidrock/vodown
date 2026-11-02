import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {exchangeRecoveryCode,passwordError} from '../app/auth/recovery-flow.ts';

function client(event: string, error: Error|null = null) {
  let handler:((event:string,session:{user:{id:string}})=>void)|undefined;
  let unsubscribed=false;
  const mock={auth:{
    onAuthStateChange(callback:typeof handler){handler=callback;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};},
    async exchangeCodeForSession(code:string,options?:{flowId:string}) {
      assert.equal(code,'one-use-code');assert.deepEqual(options,{flowId:'flow-id'});
      if(error)return {data:{session:null},error};
      const session={user:{id:'person-1'}};handler?.(event,session);return {data:{session},error:null};
    },
  }};
  return {client:mock as unknown as SupabaseClient,unsubscribed:()=>unsubscribed};
}
test('only a recovery grant enables the password form and unsubscribes',async()=>{
  const mock=client('PASSWORD_RECOVERY');
  assert.equal(await exchangeRecoveryCode(mock.client,'one-use-code','flow-id'),'person-1');
  assert.equal(mock.unsubscribed(),true);
});
test('login grants and expired or reused codes cannot enable recovery',async()=>{
  for(const mock of [client('SIGNED_IN'),client('PASSWORD_RECOVERY',new Error('expired'))]){
    await assert.rejects(exchangeRecoveryCode(mock.client,'one-use-code','flow-id'));
    assert.equal(mock.unsubscribed(),true);
  }
});
test('password rules validate length and confirmation',()=>{
  assert.ok(passwordError('short','short'));
  assert.ok(passwordError('password123','password456'));
  assert.equal(passwordError('password123','password123'),null);
});
test('Supabase PKCE recovery emits the event before exchange returns',async()=>{
  const storage=new Map<string,string>();
  const fakeFetch: typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/recover'))return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
    if(url.pathname.endsWith('/token')){
      const body=JSON.parse(String(init?.body));
      assert.equal(body.auth_code,'fixture-code');assert.ok(body.code_verifier);
      const session={access_token:'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.',refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user:{id:'test-user',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
      return new Response(JSON.stringify(session),{status:200,headers:{'Content-Type':'application/json'}});
    }
    throw new Error(`Unexpected URL: ${url.pathname}`);
  };
  const client=createClient('https://example.supabase.co','test-key',{
    auth:{flowType:'pkce',detectSessionInUrl:false,autoRefreshToken:false,persistSession:true,
      storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}}},
    global:{fetch:fakeFetch},
  });
  try {
    const {error}=await client.auth.resetPasswordForEmail('test@example.com',{redirectTo:'https://vodown.example/redefinir-senha'});
    assert.equal(error,null);
    assert.equal(await exchangeRecoveryCode(client,'fixture-code'),'test-user');
    await assert.rejects(exchangeRecoveryCode(client,'fixture-code'));
  } finally {await client.auth.signOut({scope:'local'});}
});
