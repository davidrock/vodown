import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePart,materialFolder} from '../lib/downloads.js';
test('keeps course, module and lesson names while preventing traversal and Windows reserved names',()=>{
  assert.equal(materialFolder({title:'Curso de Música'},{module:'Módulo 2 — Acordes',title:'Aula 1'}),'Vodown/Curso de Música/Módulo 2 — Acordes/Materiais/Aula 1');
  assert.equal(nativePart('../Aula: "Teste"'),'-Aula- -Teste-');
  assert.equal(nativePart('CON.txt'),'_CON.txt');
  assert.equal(nativePart('..'),'Sem nome');
  assert.equal(nativePart('SENHOR TU ÉS BOM.pdf'),'SENHOR TU ÉS BOM.pdf');
});
