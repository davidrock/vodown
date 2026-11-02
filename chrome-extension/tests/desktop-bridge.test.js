import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../lib/desktop-bridge.js';
const inventory={title:'Curso',platform:'whop',lessons:[{id:'lesson',title:'Aula',page_url:'https://private.example/secret'}]};
function setup({mutate=false,rotate=false,wrongReply=false,deny=false}={}) {
  const saved={},messages=[];let count=0,sessionCalls=0;
  const bridge=createDesktopBridge({random:()=>`request-${++count}`,delay:async()=>{},session:async()=>{sessionCalls++;return {accessToken:rotate&&sessionCalls>1?'refreshed-token':'original-token',userId:mutate&&sessionCalls>1?'account-b':'account-a'};},storage:{get:async()=>saved,set:async value=>Object.assign(saved,value)},native:async(host,request)=>{
    messages.push(request);
    return {version:1,requestId:wrongReply?'unrelated':request.requestId,type:request.type,code:request.type==='pair'?'pair_pending':request.type==='pair_status'?'paired':deny?'pair_required':'inventory_received',pairToken:'a'.repeat(64)};
  }});
  return {bridge,saved,messages};
}
test('pairs then sends only inventory metadata with the connection credential',async()=>{
  const {bridge,saved,messages}=setup();
  assert.deepEqual(await bridge.pair(()=>inventory),{paired:true});
  assert.equal(saved.nativePairToken,'a'.repeat(64));
  const sent=messages.at(-1);
  assert.deepEqual(sent.inventory,{capabilities:['video','materials','subtitles'],courseKey:'Curso',title:'Curso',platform:'whop',trackDiscoveryIncomplete:false,failedTracks:[],totalTracks:0,lessons:[{id:'lesson',title:'Aula',module:'Aulas',moduleIndex:1,index:1,trackId:'',trackTitle:'',trackIndex:0}]});
  assert.equal(sent.accessToken,undefined);
  assert.equal(sent.pairToken,'a'.repeat(64));
});
test('rejects unrelated responses and account changes before saving pairing',async()=>{
  for(const options of [{wrongReply:true},{mutate:true}]) {
    const {bridge,saved,messages}=setup(options);
    await assert.rejects(()=>bridge.pair(()=>inventory));
    assert.equal(saved.nativePairToken,undefined);
    assert(!messages.some(message=>message.type==='inventory'));
  }
});
test('does not report inventory delivery after revocation',async()=>{
  const {bridge}=setup({deny:true});
  await assert.rejects(()=>bridge.pair(()=>inventory),/Reconecte/);
});

test('token renewal preserves pairing for the same account',async()=>{
  const {bridge,saved,messages}=setup({rotate:true});
  assert.deepEqual(await bridge.pair(()=>inventory),{paired:true});
  assert.equal(saved.nativePairToken,'a'.repeat(64));
  assert.equal(messages[0].accessToken,'original-token');
  assert.equal(messages.at(-1).type,'inventory');
});

test('missing pairing credential triggers reconnection instead of silently discarding the course',async()=>{
  const {bridge}=setup();
  await assert.rejects(()=>bridge.publish(inventory),/Reconexão necessária/);
});
