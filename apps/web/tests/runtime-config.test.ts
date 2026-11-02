import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readPublicConfig,configScript} from '../app/runtime-config.ts';

const values={NODE_ENV:'production' as const,VODOWN_PUBLIC_SUPABASE_URL:'https://one.supabase.co',VODOWN_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example',VODOWN_PUBLIC_API_URL:'https://api.example.com'};
test('runtime environments select distinct origins and never return unrelated secrets',()=>{
  const first=readPublicConfig({...values,STRIPE_SECRET:'private-server-secret'});
  const second=readPublicConfig({...values,VODOWN_PUBLIC_SUPABASE_URL:'https://two.supabase.co',VODOWN_PUBLIC_API_URL:'https://second.example.com'});
  assert.notDeepEqual(first,second);
  assert.ok(!configScript(first).includes('private-server-secret'));
  assert.equal(second?.apiUrl,'https://second.example.com');
});
test('missing values, secret keys and insecure URLs are rejected',()=>{
  const role=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  for(const value of [{...values,VODOWN_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_test'}, {...values,VODOWN_PUBLIC_SUPABASE_PUBLISHABLE_KEY:`a.${role}.c`}, {...values,VODOWN_PUBLIC_API_URL:'http://api.example.com'}, {...values,VODOWN_PUBLIC_API_URL:'https://user:pass@api.example.com'}, {...values,VODOWN_PUBLIC_API_URL:''}])assert.throws(()=>readPublicConfig(value));
  assert.equal(readPublicConfig({NODE_ENV:'development'}),null);
  assert.equal(readPublicConfig({...values,NODE_ENV:'development',VODOWN_PUBLIC_API_URL:'http://localhost:5080'})?.apiUrl,'http://localhost:5080');
});
test('configuration cannot terminate its script element',()=>{
  const script=configScript({supabaseUrl:'https://example.com',apiUrl:'https://api.example.com',publishableKey:'</script><script>attack()</script>'});
  assert.ok(!script.includes('</script>'));
  const sandbox={window:{}};vm.runInNewContext(script,sandbox);
  assert.equal((sandbox.window as {__VODOWN_PUBLIC_CONFIG__:{publishableKey:string}}).__VODOWN_PUBLIC_CONFIG__.publishableKey,'</script><script>attack()</script>');
});
