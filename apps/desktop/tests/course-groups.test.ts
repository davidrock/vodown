import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCourse} from '../src/course-groups.ts';

test('keeps modules with identical names separate across Hotmart tracks',()=>{
  const lessons=[
    {id:'a',title:'A',module:'Introdução',moduleIndex:1,index:1,trackId:'t1',trackTitle:'Trilha 1'},
    {id:'b',title:'B',module:'Introdução',moduleIndex:1,index:2,trackId:'t2',trackTitle:'Trilha 2'},
    {id:'c',title:'C',module:'Avançado',moduleIndex:2,index:3,trackId:'t1',trackTitle:'Trilha 1'},
  ];
  const groups=groupCourse(lessons);
  assert.equal(groups.length,2);assert.deepEqual(groups[0].lessons.map(l=>l.id),['a','c']);
  assert.deepEqual(groups[0].modules.map(m=>m.lessons.map(l=>l.id)),[['a'],['c']]);
  assert.deepEqual(groups[1].modules[0].lessons.map(l=>l.id),['b']);
});
