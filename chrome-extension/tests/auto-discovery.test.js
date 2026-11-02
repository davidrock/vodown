import test from 'node:test';
import assert from 'node:assert/strict';
import {autoDiscovery} from '../lib/auto-discovery.js';
function harness() {
  let id=0,isBusy=false;const tasks=new Map(),scans=[];
  const tabs=new Map([[1,{active:true,url:'https://whop.com/test/app/courses/cors_test/lessons/lesson_1/'}],[2,{active:true,url:'https://example.com/'}],[3,{active:false,url:'https://whop.com/test/app/courses/cors_other/'}]]);
  const discovery=autoDiscovery({tab:async id=>tabs.get(id),scan:async id=>scans.push(id),busy:()=>isBusy,schedule:fn=>{tasks.set(++id,fn);return id;},cancel:id=>tasks.delete(id)});
  return {discovery,scans,tasks,busy:value=>{isBusy=value;},async flush(){const entry=tasks.entries().next().value;if(entry){tasks.delete(entry[0]);await entry[1]();}}};
}
test('finds a course without opening the side panel and coalesces navigation events',async()=>{
  const h=harness();h.discovery.notify(1);h.discovery.notify(1);h.discovery.notify(1);
  assert.equal(h.tasks.size,1);await h.flush();assert.deepEqual(h.scans,[1]);
});
test('ignores unsupported and inactive tabs',async()=>{
  const h=harness();for(const id of [2,3,99]){h.discovery.notify(id);await h.flush();}assert.deepEqual(h.scans,[]);
});
test('defers discovery until an active download finishes',async()=>{
  const h=harness();h.busy(true);h.discovery.notify(1);await h.flush();assert.deepEqual(h.scans,[]);assert.equal(h.tasks.size,1);
  h.busy(false);await h.flush();assert.deepEqual(h.scans,[1]);
});

test('does not lose an active course switch when background tabs also navigate during a scan',async()=>{
  let finish,first=true,id=0;const tasks=new Map(),scans=[];
  const tabs=new Map([[1,{active:true,url:'https://whop.com/test/app/courses/cors_one/'}],[2,{active:false,url:'https://hotmart.com/pt-BR/club/a/products/1'}],[3,{active:false,url:'https://hotmart.com/pt-BR/club/b/products/2'}]]);
  const discovery=autoDiscovery({tab:async id=>tabs.get(id),scan:async id=>{scans.push(id);if(first){first=false;await new Promise(resolve=>{finish=resolve;});}},busy:()=>false,schedule:fn=>{tasks.set(++id,fn);return id;},cancel:id=>tasks.delete(id)});
  const flush=()=>{const entry=tasks.entries().next().value;tasks.delete(entry[0]);return entry[1]();};
  discovery.notify(1);const activeScan=flush();while(!finish)await Promise.resolve();
  tabs.get(1).active=false;tabs.get(2).active=true;discovery.notify(2);discovery.notify(3);
  finish();await activeScan;await flush();assert.deepEqual(scans,[1,2]);
});
