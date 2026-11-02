import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesMaterialDownload,hasCompletedMaterial} from '../lib/material-delivery.js';
test('associates authenticated, popup, blob and data-URI materials without claiming unrelated downloads',()=>{
  const job={origin:'https://dashboard.kiwify.com',name:'Cronograma.png'};
  assert(matchesMaterialDownload({url:'https://assets.example/file',referrer:job.origin+'/course'},job));
  assert(matchesMaterialDownload({url:'blob:https://dashboard.kiwify.com/id'},job));
  assert(matchesMaterialDownload({url:'data:image/png;base64,fixture',filename:'/Downloads/Cronograma.png'},job));
  assert(!matchesMaterialDownload({url:'data:image/png;base64,other',filename:'/Downloads/Outro.png'},job));
  assert(!matchesMaterialDownload({url:'blob:https://unrelated.example/id'},job));
  assert(!matchesMaterialDownload({url:'https://unrelated.example/file',referrer:'https://unrelated.example/'},job));
  assert(matchesMaterialDownload({url:'https://assets.whop.com/file.pdf'},{...job,sourceUrl:'https://assets.whop.com/file.pdf'}));
});

test('skips only completed existing material in the requested course and module',()=>{
 const folder='Vodown/Curso/Módulo/Materiais/Aula';
 assert(hasCompletedMaterial([{state:'complete',exists:true,filename:`/Users/u/Downloads/${folder}/Notas.pdf`}],folder,'Notas.pdf'));
 assert(!hasCompletedMaterial([{state:'complete',exists:false,filename:`/Users/u/Downloads/${folder}/Notas.pdf`}],folder,'Notas.pdf'));
 assert(!hasCompletedMaterial([{state:'complete',exists:true,filename:'/Downloads/Outro/Notas.pdf'}],folder,'Notas.pdf'));
});
