import test from 'node:test';
import assert from 'node:assert/strict';
import {runCourseQueue} from '../src/course-queue.ts';
const lessons=[{id:'a',title:'Aula 1'},{id:'b',title:'Aula 2'},{id:'c',title:'Aula 3'}];
test('downloads sequentially, skips existing files and continues after an individual failure',async()=>{
  const calls:string[]=[];let active=0;
  const result=await runCourseQueue(lessons,{includeMaterials:false,saved:async()=>new Set(['a']),canceled:()=>false,report:()=>{},start:async lesson=>{assert.equal(active,0);active++;calls.push(lesson.id);},wait:async()=>{active--;return {status:calls.at(-1)==='b'?'failed':'completed'};}});
  assert.deepEqual(calls,['b','c']);assert.equal(result.done,3);assert.equal(result.skipped,1);assert.equal(result.failed,1);
});
test('cancellation prevents the next lesson from starting',async()=>{
  const started:string[]=[];let cancel=false;
  const result=await runCourseQueue(lessons,{includeMaterials:false,saved:async()=>new Set(),canceled:()=>cancel,report:()=>{},start:async lesson=>{started.push(lesson.id);},wait:async()=>{cancel=true;return {status:'canceled'};}});
  assert.deepEqual(started,['a']);assert.equal(result.canceled,true);assert.equal(result.done,0);
});
test('an authorization or source change failure aborts the queue',async()=>{
  let starts=0;
  await assert.rejects(()=>runCourseQueue(lessons,{includeMaterials:false,saved:async()=>new Set(),canceled:()=>false,report:()=>{},start:async()=>{starts++;throw new Error('not authorized');},wait:async()=>({status:'completed'})}),/not authorized/);
  assert.equal(starts,1);
});

test('whole course includes materials even when the video already exists; no attachments is not a failure',async()=>{
  const calls:string[]=[];let stage='';
  const result=await runCourseQueue(lessons,{saved:async()=>new Set(['a']),canceled:()=>false,report:()=>{},start:async(lesson,materials)=>{stage=`${lesson.id}:${materials?'materials':'video'}`;calls.push(stage);},wait:async()=>stage==='b:materials'?{status:'failed',errorCode:'no_materials'}:{status:'completed'}});
  assert.deepEqual(calls,['a:materials','b:video','b:materials','c:video','c:materials']);assert.equal(result.done,3);assert.equal(result.failed,0);
});

test('existing videos still receive subtitle and material tasks',async()=>{
  const calls:string[]=[];
  await runCourseQueue([lessons[0]],{includeSubtitles:true,saved:async()=>new Set(['a']),canceled:()=>false,report:()=>{},start:async(lesson,materials,subtitles)=>{calls.push(subtitles?'subtitles':materials?'materials':'video');},wait:async()=>({status:'completed'})});
  assert.deepEqual(calls,['subtitles','materials']);
});

test('subtitle warnings survive successful material tasks in the course summary',async()=>{
  let material=false;const reports:{warnings:string[]}[]=[];
  const result=await runCourseQueue([lessons[0]],{includeSubtitles:true,saved:async()=>new Set(['a']),canceled:()=>false,report:p=>reports.push(p),start:async(_lesson,materials)=>{material=!!materials;},wait:async()=>({status:'completed',warning:material?null:'Legenda HTTP 403'})});
  assert.deepEqual(result.warnings,['Aula 1: Legenda HTTP 403']);
  assert.deepEqual(reports.at(-1)?.warnings,result.warnings);
});
