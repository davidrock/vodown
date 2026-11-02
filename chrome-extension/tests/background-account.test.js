import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('background never captures a lesson when the server denies the action or its next lesson',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vodown-worker-'));
  const origin='https://whop.com/demo/app/courses/cors_123/lessons/lesson_1';
  const sessionState={inventory:{platform:'whop',key:'whop:cors_123',tabId:1,page_url:origin,original_url:origin,lessons:[{id:'lesson_1',title:'Aula'}]},busy:false,stage:'Pronto',settings:{},logs:[],results:[],version:0};
  const storage={state:sessionState};let listener,authorizationCount=0,scriptExecutions=0,mode='reject-action',finishOAuth;
  const previousChrome=globalThis.chrome,previousFetch=globalThis.fetch;
  try {
    await mkdir(join(directory,'vendor/supabase'),{recursive:true});
    await cp('chrome-extension/background.js',join(directory,'background.js'));
    await cp('chrome-extension/lib',join(directory,'lib'),{recursive:true});
    await cp('chrome-extension/vendor/supabase/client.js',join(directory,'vendor/supabase/client.js'));
    await writeFile(join(directory,'package.json'),'{"type":"module"}');
    await writeFile(join(directory,'vendor/supabase/config.js'),"export const supabaseUrl='https://example.supabase.co',publishableKey='test-public-key',apiUrl='https://api.example';");
    globalThis.chrome={
      storage:{session:{async setAccessLevel(){},async get(k){return {[k]:storage[k]};},async set(v){Object.assign(storage,structuredClone(v));},async remove(k){delete storage[k];}},local:{async setAccessLevel(){},async get(k){return {[k]:storage[k]};},async set(v){Object.assign(storage,structuredClone(v));},async remove(k){delete storage[k];}}},
      sidePanel:{async setPanelBehavior(){}},declarativeNetRequest:{async updateSessionRules(){}},
      runtime:{id:'fixture',getURL:name=>`chrome-extension://fixture/${name}`,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){},async getContexts(){return [];}},
      tabs:{async get(){return {id:1,active:true,url:origin};}},
      offscreen:{async createDocument(){}},scripting:{async executeScript(){scriptExecutions++;return [];}},webNavigation:{async getAllFrames(){return [{url:origin,frameId:0}];}},
      identity:{getRedirectURL:path=>`https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/${path}`,launchWebAuthFlow:()=>new Promise(resolve=>{finishOAuth=resolve;})},
    };
    globalThis.fetch=async(url,options={})=>{
      const value=String(url);
      if(value.includes('/auth/v1/token'))return new Response(JSON.stringify({access_token:'private-token',refresh_token:'refresh-token',expires_in:3600,token_type:'bearer',user:{id:'account-1',email:'user@example.com',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}}),{status:200,headers:{'Content-Type':'application/json'}});
      if(value.endsWith('/entitlements'))return new Response('{"plan":"free"}',{status:200,headers:{'Content-Type':'application/json'}});
      if(value.endsWith('/download-authorizations')){
        authorizationCount++;
        const allowed=mode==='reject-lesson' && authorizationCount===1;
        return new Response(JSON.stringify({allowed}),{status:allowed?200:403,headers:{'Content-Type':'application/json'}});
      }
      throw Error('Unexpected URL');
    };
    await import(pathToFileURL(join(directory,'background.js')).href);
    const send=(action,data={})=>new Promise((resolve,reject)=>{
      const returned=listener({target:'background',action,...data},{id:'fixture',url:'chrome-extension://fixture/sidepanel.html'},result=>result?.ok?resolve(result.result):reject(Error(result?.error)));
      if(!returned)reject(Error('Message rejected'));
    });
    const account=await send('signIn',{email:'user@example.com',password:'fixture-password'});
    assert.equal(account.email,'user@example.com');
    assert.ok(!JSON.stringify(await send('state')).includes('private-token'));
    for(mode of ['reject-action','reject-lesson']) {
      authorizationCount=0;
      await send('run',{mode:'download',ids:['lesson_1'],tabId:1,courseKey:'whop:cors_123'});
      for(let retry=0;retry<100 && (await send('state')).busy;retry++)await new Promise(resolve=>setTimeout(resolve,5));
      const state=await send('state');
      assert.equal(state.busy,false);assert.match(state.error,/plano/);
      assert.equal(authorizationCount,mode==='reject-action'?1:2);
      assert.equal(scriptExecutions,0);
    }
    const pending=send('signInGoogle');
    for(let retry=0;retry<100 && !finishOAuth;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof finishOAuth,'function');
    assert.equal((await send('state')).accountBusy,true);
    await assert.rejects(send('signOut'),/Aguarde/);
    await assert.rejects(send('run',{mode:'download',ids:['lesson_1'],tabId:1,courseKey:'whop:cors_123'}),/Aguarde/);
    finishOAuth(undefined);
    await assert.rejects(pending,/Google/);
    assert.equal((await send('state')).accountBusy,false);
    assert.equal(scriptExecutions,0);
  } finally {
    globalThis.chrome=previousChrome;globalThis.fetch=previousFetch;
    await rm(directory,{recursive:true,force:true});
  }
});
