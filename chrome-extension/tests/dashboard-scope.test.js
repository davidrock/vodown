import test from 'node:test';
import assert from 'node:assert/strict';
import {courseScope,sameCourse} from '../lib/model.js';
test('recognizes premium dashboard lessons and separates courses despite query navigation',()=>{
  const base='https://dashboard.kiwify.com/course/premium/2a542dbd-abfc-43b5-88de-df61f2f4869b';
  assert.equal(courseScope(base+'?mod=one&lesson=two').platform,'kiwify');
  assert(sameCourse(base+'?lesson=one',base+'?lesson=two'));
  assert(!sameCourse(base,base.replace('2a542dbd','3a542dbd')));
  assert.throws(()=>courseScope('https://dashboard.kiwify.com/courses'));
  assert.throws(()=>courseScope(base.replace('dashboard.kiwify.com','dashboard.kiwify.com.attacker.test')));
});

test('Hotmart tracks and their lessons belong to the same product without merging products',()=>{
  const course='https://hotmart.com/pt-BR/club/rodolfomunizz/products/5260762';
  const one=course+'/track/ZYOmWN5jed',two=course+'/track/qV73gDGl73';
  assert.equal(courseScope(one).trackId,'ZYOmWN5jed');
  assert.equal(courseScope(one).basePath,'/pt-BR/club/rodolfomunizz/products/5260762');
  assert(sameCourse(one,two));assert(sameCourse(one,course+'/content/lesson'));
  assert(!sameCourse(one,course.replace('5260762','5260763')));
});
