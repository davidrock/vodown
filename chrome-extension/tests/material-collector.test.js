import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPage} from '../lib/collector.js';
test('collects and invokes attachment download controls on supported lesson pages without capturing video',async()=>{
  const oldDocument=globalThis.document,oldLocation=globalThis.location;
  try {
    for(const host of ['hotmart.com','members.kiwify.com','whop.com']) {
      let clicks=0;
      const button={innerText:'Download',getAttribute:()=>null,closest:()=>null,parentElement:{parentElement:{innerText:'SENHOR TU ÉS BOM.pdf\nPDF - 410 KB\nDownload'}},tagName:'A',href:'https://assets.example/file.pdf',click:()=>clicks++};
      globalThis.location={hostname:host,href:`https://${host}/course/lesson`,origin:`https://${host}`,pathname:'/course/lesson'};
      globalThis.document={querySelectorAll:selector=>(selector==='button'||selector==='button,[role="button"]')?[button]:[],querySelector:()=>null};
      const found=await collectPage('materials');
      assert.deepEqual(found,{materials:[{index:0,name:'SENHOR TU ÉS BOM.pdf'}]});
      assert.equal(clicks,0);
      assert.deepEqual(await collectPage('downloadMaterial',{materialIndex:0,name:'SENHOR TU ÉS BOM.pdf'}),{clicked:true,downloadUrl:'https://assets.example/file.pdf'});
      assert.equal(clicks,0);
      await assert.rejects(()=>collectPage('downloadMaterial',{materialIndex:0,name:'Outro arquivo.pdf'}),/mudou/);
      assert.equal(clicks,0);
    }
  } finally {globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('recognizes file-card buttons and role=button PNG attachments from the observed platforms',async()=>{
  const oldDocument=globalThis.document,oldLocation=globalThis.location;
  try {
    for(const [host,name] of [['whop.com','Understanding Your Product.pdf'],['dashboard.kiwify.com','O Seu Cronograma Definitivo Para os Próximos Anos.png']]) {
      let clicks=0;
      const span={textContent:name};
      const card={innerText:host==='whop.com'?name:`PNG\n${name}\n1.59 MB`,getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[span],parentElement:{parentElement:{innerText:'ANEXOS'}},tagName:'A',href:'https://assets.example/file.pdf',click:()=>clicks++};
      globalThis.location={hostname:host,href:`https://${host}/course/lesson`,origin:`https://${host}`,pathname:'/course/lesson'};
      globalThis.document={querySelectorAll:selector=>selector==='button,[role="button"]'?[card]:[],querySelector:()=>null};
      assert.deepEqual(await collectPage('materials'),{materials:[{index:0,name}]});
      await collectPage('downloadMaterial',{materialIndex:0,name});assert.equal(clicks,0);
    }
  } finally{globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('captures the platform file target without depending on browser popup activation and restores window.open',async()=>{
  const previous={document:globalThis.document,location:globalThis.location,window:globalThis.window};
  try {
    const originalOpen=()=>{throw new Error('A popup should not be required for the requested attachment');};
    globalThis.window={open:originalOpen};globalThis.location={hostname:'whop.com',href:'https://whop.com/course/lesson',origin:'https://whop.com',pathname:'/course/lesson'};
    const card={tagName:'BUTTON',innerText:'Notes.pdf',getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[{textContent:'Notes.pdf'}],parentElement:{parentElement:{innerText:'Notes.pdf'}},click:()=>globalThis.window.open('https://assets.whop.com/download/asset-id?signature=transient')};
    globalThis.document={querySelectorAll:selector=>selector==='button,[role="button"]'?[card]:[],querySelector:()=>null};
    const result=await collectPage('downloadMaterial',{materialIndex:0,name:'Notes.pdf'});
    assert.deepEqual(result,{clicked:true,downloadUrl:'https://assets.whop.com/download/asset-id?signature=transient'});
    assert.equal(globalThis.window.open,originalOpen);
  } finally{Object.assign(globalThis,previous);}
});

test('captures a synthetic attachment link and restores the page handlers',async()=>{
  const previous={document:globalThis.document,location:globalThis.location,window:globalThis.window};
  try {
    let browserDownloads=0;
    function Anchor(){this.href='blob:https://dashboard.kiwify.com/fixture';}
    Anchor.prototype.click=function(){browserDownloads++;};
    Anchor.prototype.getAttribute=name=>name==='download'?'material.png':null;
    Anchor.prototype.hasAttribute=name=>name==='download';
    const original=Anchor.prototype.click;
    globalThis.location={hostname:'dashboard.kiwify.com',href:'https://dashboard.kiwify.com/course',origin:'https://dashboard.kiwify.com',pathname:'/course'};
    globalThis.window={open:()=>null,HTMLAnchorElement:Anchor};
    const button={tagName:'BUTTON',innerText:'material.png',getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[{textContent:'material.png'}],parentElement:{parentElement:{innerText:'material.png'}},click:()=>new Anchor().click()};
    globalThis.document={querySelectorAll:selector=>selector==='button,[role="button"]'?[button]:[],querySelector:()=>null};
    const result=await collectPage('downloadMaterial',{materialIndex:0,name:'material.png'});
    assert.equal(result.downloadUrl,'blob:https://dashboard.kiwify.com/fixture');
    assert.equal(browserDownloads,0);assert.equal(Anchor.prototype.click,original);
  } finally {Object.assign(globalThis,previous);}
});

test('captures a file assigned to an initially blank popup without opening a browser window',async()=>{
  const previous={document:globalThis.document,location:globalThis.location,window:globalThis.window};
  try {
    let opened=0;globalThis.window={open:()=>opened++};
    globalThis.location={hostname:'whop.com',href:'https://whop.com/course/lesson',origin:'https://whop.com',pathname:'/course/lesson'};
    const card={tagName:'BUTTON',innerText:'Notes.pdf',getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[{textContent:'Notes.pdf'}],parentElement:{parentElement:{innerText:'Notes.pdf'}},click:()=>{const popup=window.open('about:blank');popup.location.href='https://assets.whop.com/download/123';}};
    globalThis.document={querySelectorAll:selector=>selector==='button,[role="button"]'?[card]:[],querySelector:()=>null};
    const result=await collectPage('downloadMaterial',{materialIndex:0,name:'Notes.pdf'});
    assert.equal(result.downloadUrl,'https://assets.whop.com/download/123');assert.equal(opened,0);
  }finally{Object.assign(globalThis,previous);}
});

test('reads platform blob bytes in bounded chunks for native transfer',async()=>{
  const previous={location:globalThis.location,fetch:globalThis.fetch};
  try{
    const bytes=new Uint8Array(32775).fill(7);bytes[32774]=9;
    globalThis.location={hostname:'dashboard.kiwify.com',href:'https://dashboard.kiwify.com/course',origin:'https://dashboard.kiwify.com'};
    globalThis.fetch=async()=>new Response(new Blob([bytes]));
    const one=await collectPage('materialChunk',{url:'blob:https://dashboard.kiwify.com/file',offset:0});
    const two=await collectPage('materialChunk',{url:'blob:https://dashboard.kiwify.com/file',offset:32768});
    assert.equal(one.data.length,32768);assert.equal(one.done,false);assert.deepEqual(two,{data:[7,7,7,7,7,7,9],done:true});
    await assert.rejects(()=>collectPage('materialChunk',{url:'blob:https://other.invalid/file',offset:0}),/Origem/);
  }finally{Object.assign(globalThis,previous);}
});
