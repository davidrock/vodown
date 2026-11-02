import test from 'node:test';
import assert from 'node:assert/strict';
import {readCoursePage} from '../lib/scan-read.js';
test('surfaces a module read failure instead of retrying it for minutes',async()=>{
  let reads=0;
  await assert.rejects(()=>readCoursePage(async()=>{reads++;return [{result:{collectionError:'Módulo incompleto'}}];}),/Módulo incompleto/);
  assert.equal(reads,1);
});
test('releases a stalled page read with an actionable timeout',async()=>{
  await assert.rejects(()=>readCoursePage(()=>new Promise(()=>{}),{timeoutMs:10}),/demorou demais/);
});
