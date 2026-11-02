import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPage} from '../lib/collector.js';

test('Kiwify dashboard opens collapsed modules before collecting their lessons',async()=>{
  const previous={document:globalThis.document,location:globalThis.location};
  try {
    const groups=[];
    for(const [name,titles,expanded] of [['Armário Cápsula',['Aula 1','Aula 2'],false],['Looks',['Aula 3'],true]]){
      const group={expanded,rows:[],querySelector:selector=>selector==='input[type="checkbox"]'&&group.expanded?{}:null};
      const header={innerText:`${name} 0/${titles.length}`,parentElement:group,querySelector:selector=>selector==='svg'?{}:null,querySelectorAll:()=>[],getClientRects:()=>[{}],click:()=>{group.expanded=!group.expanded;}};
      group.firstElementChild=header;
      for(const title of titles){const row={parentElement:{parentElement:{parentElement:group}},querySelectorAll:()=>[{}],querySelector:selector=>selector==='.line-clamp'?{textContent:title}:null,getClientRects:()=>[{}]};group.rows.push(row);}
      groups.push(group);
    }
    globalThis.location={hostname:'dashboard.kiwify.com',pathname:'/course/premium/2a542dbd-abfc-43b5-88de-df61f2f4869b',href:'https://dashboard.kiwify.com/course/premium/2a542dbd-abfc-43b5-88de-df61f2f4869b'};
    globalThis.document={title:'Curso',querySelectorAll:selector=>selector==='div.cursor-pointer'?groups.map(g=>g.firstElementChild):selector==='div.cursor-pointer.p-3'?groups.flatMap(g=>g.expanded?g.rows:[]):[],querySelector:()=>null};
    const result=await collectPage('prepare');
    assert.equal(groups[0].expanded,true);
    assert.deepEqual(result.lessons.map(l=>[l.module,l.title,l.id]),[['Armário Cápsula','Aula 1','kiwify:1:1'],['Armário Cápsula','Aula 2','kiwify:1:2'],['Looks','Aula 3','kiwify:2:1']]);
  }finally{Object.assign(globalThis,previous);}
});

test('Hotmart collects only tracks belonging to the current product and removes duplicates',async()=>{
  const previous={document:globalThis.document,location:globalThis.location};
  try{
    const base='https://hotmart.com/pt-BR/club/course/products/123';
    globalThis.location={hostname:'hotmart.com',origin:'https://hotmart.com',pathname:'/pt-BR/club/course/products/123',href:base};
    const anchor=(href,title)=>({innerText:title,getAttribute:name=>name==='href'?href:null,querySelector:()=>null});
    globalThis.document={title:'Curso',querySelector:()=>({innerText:'Curso'}),querySelectorAll:selector=>selector==='a[href]'?[anchor(base+'/track/one','Primeira'),anchor(base+'/track/one?x=1','Primeira'),anchor(base+'/track/two','Segunda'),anchor('https://other.test/pt-BR/club/course/products/123/track/other','Externa')]:[]};
    const result=await collectPage('hotmartTracks');
    assert.deepEqual(result.tracks.map(t=>[t.id,t.title]),[['one','Primeira'],['two','Segunda']]);
  }finally{Object.assign(globalThis,previous);}
});

test('Kiwify returns an actionable module error when its read deadline expires',async()=>{
  const previous={document:globalThis.document,location:globalThis.location};
  try{
    const group={querySelector:()=>null};
    const header={innerText:'Módulo fechado 0/2',parentElement:group,querySelector:()=>null,querySelectorAll:()=>[],getClientRects:()=>[{}],getAttribute:()=> 'false',click(){}};
    globalThis.location={hostname:'dashboard.kiwify.com',href:'https://dashboard.kiwify.com/course/premium/4d707ed6-4638-43e9-970b-15be7af9b37e'};
    globalThis.document={querySelectorAll:selector=>selector==='div.cursor-pointer'?[header]:[],querySelector:()=>null};
    const result=await collectPage('prepare',{deadline:Date.now()-1});
    assert.match(result.collectionError,/demorou demais/);
  }finally{Object.assign(globalThis,previous);}
});

test('Kiwify assigns variant lesson cards by DOM order when headers and lessons have different wrappers',async()=>{
  const previous={document:globalThis.document,location:globalThis.location};
  try{
    const nodes=[];const compare=function(other){return this.position<other.position?4:2;};
    for(const [name,position] of [['Bem Vindo',0],['Módulo 2',2]]){
      const h={position,innerText:`${name} 0/1`,parentElement:{},compareDocumentPosition:compare,querySelector:()=>null,querySelectorAll:()=>[],getClientRects:()=>[{}],getAttribute:()=> 'true',click(){throw Error('Should already be open');}};
      const r={position:position+1,compareDocumentPosition:compare,querySelectorAll:()=>[{}],querySelector:selector=>selector==='[class*="line-clamp"]'?{textContent:`Aula ${position+1}`}:null,getClientRects:()=>[{}]};nodes.push(h,r);
    }
    globalThis.location={hostname:'dashboard.kiwify.com',href:'https://dashboard.kiwify.com/course/premium/4d707ed6-4638-43e9-970b-15be7af9b37e'};
    globalThis.document={title:'Curso',querySelector:()=>null,querySelectorAll:selector=>selector==='div.cursor-pointer'?nodes:[]};
    const result=await collectPage('prepare');
    assert.equal(result.collectionError,undefined);
    assert.deepEqual(result.lessons.map(l=>[l.module,l.title]),[['Bem Vindo','Aula 1'],['Módulo 2','Aula 3']]);
  }finally{Object.assign(globalThis,previous);}
});

test('Kiwify reads ml-2 lesson titles and ignores a hidden responsive duplicate of Bem Vindo',async()=>{
  const previous={document:globalThis.document,location:globalThis.location};
  try{
    const compare=function(other){return this.position<other.position?4:2;};
    const header={position:0,innerText:'Bem Vindo 2/2',compareDocumentPosition:compare,querySelector:()=>null,querySelectorAll:()=>[],getClientRects:()=>[{}],getAttribute:()=> 'true',click(){throw Error('Already open');}};
    const hiddenHeader={...header,position:-1,getClientRects:()=>[],click(){throw Error('Hidden header must not be opened');}};
    const rows=['Bem Vindo','Apresentação'].map((title,index)=>({position:index+1,compareDocumentPosition:compare,querySelectorAll:()=>[{}],querySelector:selector=>selector==='.ml-2'?{textContent:title}:null,getClientRects:()=>[{}]}));
    globalThis.location={hostname:'dashboard.kiwify.com',href:'https://dashboard.kiwify.com/course/premium/4d707ed6-4638-43e9-970b-15be7af9b37e'};
    globalThis.document={title:'Curso',querySelector:()=>null,querySelectorAll:selector=>selector==='div.cursor-pointer'?[hiddenHeader,header,...rows]:[]};
    const result=await collectPage('prepare');
    assert.equal(result.collectionError,undefined);
    assert.deepEqual(result.lessons.map(l=>[l.module,l.title]),[['Bem Vindo','Bem Vindo'],['Bem Vindo','Apresentação']]);
  }finally{Object.assign(globalThis,previous);}
});
