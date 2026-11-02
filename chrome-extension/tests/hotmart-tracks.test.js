import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHotmartTracks} from '../lib/hotmart-tracks.js';
import {courseScope} from '../lib/model.js';
const base='https://hotmart.com/pt-BR/club/example/products/123';

test('collects all track lessons in an inactive tab and preserves track identity',async()=>{
  let current=base;const navigations=[],removed=[];
  const tabs={async create(options){assert.equal(options.active,false);return {id:42};},async get(){return {url:current,status:'complete'};},async update(_id,{url}){current=url;navigations.push(url);},async remove(id){removed.push(id);}};
  const inject=async(_id,action)=>{
    if(action==='hotmartTracks')return [{result:{courseTitle:'Curso',tracks:[{id:'one',title:'Primeira',url:base+'/track/one'},{id:'two',title:'Segunda',url:base+'/track/two'}]}}];
    const name=current.endsWith('/one')?'one':'two';
    return [{result:{platform:'hotmart',lessons:[{id:'x',title:name,page_url:base+'/content/'+name,module:'Introdução',module_index:1}]}}];
  };
  const result=await collectHotmartTracks(courseScope(base),{tabs,inject,sleep:async()=>{},cleanUrl:url=>url});
  assert.equal(result.courseTitle,'Curso');assert.equal(result.totalTracks,2);assert.deepEqual(result.failedTracks,[]);
  assert.deepEqual(result.lessons.map(x=>[x.track_id,x.track_title,x.id]),[['one','Primeira',base+'/content/one'],['two','Segunda',base+'/content/two']]);
  assert.equal(navigations.length,2);assert.deepEqual(removed,[42]);
});

test('reports an unreadable track instead of claiming the course is complete',async()=>{
  let current=base;const tabs={create:async()=>({id:2}),get:async()=>({url:current,status:'complete'}),update:async(_id,{url})=>{current=url;},remove:async()=>{}};
  const inject=async(_id,action)=>action==='hotmartTracks'?[{result:{tracks:[{id:'one',title:'Trilha indisponível',url:base+'/track/one'}]}}]:[];
  const result=await collectHotmartTracks(courseScope(base),{tabs,inject,sleep:async()=>{},cleanUrl:url=>url});
  assert.deepEqual(result.failedTracks,['Trilha indisponível']);assert.equal(result.lessons.length,0);
});

test('does not claim completion when the track count is visible but no track cards load',async()=>{
  let removed=false;const tabs={create:async()=>({id:3}),get:async()=>({url:base,status:'complete'}),remove:async()=>{removed=true;}};
  const inject=async()=>[{result:{courseTitle:'Curso',tracks:[],expectedTracks:5}}];
  const result=await collectHotmartTracks(courseScope(base),{tabs,inject,sleep:async()=>{},cleanUrl:url=>url});
  assert.equal(result.totalTracks,5);assert.equal(result.failedTracks.length,1);assert(removed);
});

test('distinguishes the same lesson appearing in multiple tracks',async()=>{
  let current=base;const tabs={create:async()=>({id:4}),get:async()=>({url:current,status:'complete'}),update:async(_id,{url})=>{current=url;},remove:async()=>{}};
  const inject=async(_id,action)=>action==='hotmartTracks'?[{result:{tracks:[{id:'one',title:'A',url:base+'/track/one'},{id:'two',title:'B',url:base+'/track/two'}]}}]:[{result:{platform:'hotmart',lessons:[{title:'Aula',page_url:base+'/content/shared',module:'Módulo'}]}}];
  const result=await collectHotmartTracks(courseScope(base),{tabs,inject,sleep:async()=>{},cleanUrl:url=>url});
  assert.deepEqual(result.lessons.map(l=>l.id),['one:'+base+'/content/shared','two:'+base+'/content/shared']);
});

test('does not attribute a previous page to a newly requested track',async()=>{
  let current=base,next=null,stale=false,readEarly=false;
  const tabs={create:async()=>({id:5}),get:async()=>{if(stale){stale=false;return {url:current,status:'complete'};}if(next){current=next;next=null;}return {url:current,status:'complete'};},update:async(_id,{url})=>{next=url;stale=true;},remove:async()=>{}};
  const inject=async(_id,action)=>{if(action==='hotmartTracks')return [{result:{tracks:[{id:'new',title:'Nova',url:base+'/track/new'}]}}];if(current===base)readEarly=true;return [{result:{platform:'hotmart',lessons:[{title:'Aula',page_url:base+'/content/lesson',module:'Módulo'}]}}];};
  const result=await collectHotmartTracks(courseScope(base),{tabs,inject,sleep:async()=>{},cleanUrl:url=>url});
  assert.equal(readEarly,false);assert.equal(result.lessons[0].track_id,'new');
});
