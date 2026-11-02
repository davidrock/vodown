import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {persistentAuthStorage} from '../lib/persistent-auth.js';
function area(initial={}) {
  const values={...initial};let restricted=false;
  return {values,get restricted(){return restricted;},async setAccessLevel({accessLevel}){assert.equal(accessLevel,'TRUSTED_CONTEXTS');restricted=true;},async get(key){assert(restricted);return {[key]:values[key]};},async set(data){assert(restricted);Object.assign(values,data);},async remove(key){assert(restricted);delete values[key];}};
}
test('migration survives a browser restart and logout removes both copies',async()=>{
  const key='sb-project-auth-token',local=area(),legacy=area({[key]:'existing-session'});
  let storage=persistentAuthStorage(local,legacy);
  assert.equal(await storage.getItem(key),'existing-session');
  assert.equal(legacy.values[key],undefined);
  const restartedLegacy=area();storage=persistentAuthStorage(local,restartedLegacy);
  assert.equal(await storage.getItem(key),'existing-session');
  await storage.removeItem(key);
  assert.equal(await persistentAuthStorage(local,area()).getItem(key),null);
});
test('failed migration preserves the old session and denied access prevents reads',async()=>{
  const key='sb-project-auth-token',local=area(),legacy=area({[key]:'existing-session'});
  local.set=async()=>{throw Error('disk unavailable');};
  await assert.rejects(()=>persistentAuthStorage(local,legacy).getItem(key));
  assert.equal(legacy.values[key],'existing-session');
  const denied=area();denied.setAccessLevel=async()=>{throw Error('denied');};
  await assert.rejects(()=>persistentAuthStorage(denied,area()).getItem(key));
});
test('real SDK restores and refreshes an expired session after browser restart',async()=>{
  const key='sb-project-auth-token';const local=area();let refreshes=0;
  const session={access_token:'old-access',refresh_token:'old-refresh',expires_at:1,expires_in:3600,token_type:'bearer',user:{id:'user-id',email:'test@example.com',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
  await persistentAuthStorage(local,area()).setItem(key,JSON.stringify(session));
  const client=createClient('https://project.supabase.co','public-fixture',{auth:{storageKey:key,storage:persistentAuthStorage(local,area()),persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,options)=>{
    assert(String(url).includes('grant_type=refresh_token'));
    assert.equal(JSON.parse(options.body).refresh_token,'old-refresh');refreshes++;
    return new Response(JSON.stringify({...session,access_token:'new-access',refresh_token:'new-refresh',expires_at:undefined}),{status:200,headers:{'content-type':'application/json'}});
  }}});
  const {data,error}=await client.auth.getSession();
  assert.equal(error,null);assert.equal(data.session.access_token,'new-access');assert.equal(refreshes,1);
  const restored=JSON.parse(await persistentAuthStorage(local,area()).getItem(key));
  assert.equal(restored.refresh_token,'new-refresh');
  await client.auth.signOut({scope:'local'});
  assert.equal(await persistentAuthStorage(local,area()).getItem(key),null);
});
