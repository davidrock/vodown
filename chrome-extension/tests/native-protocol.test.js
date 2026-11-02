import test from 'node:test';
import assert from 'node:assert/strict';
import {helloRequest,parseHello} from '../lib/native-protocol.js';

test('hello is versioned and matches the expected reply',()=>{
  const request=helloRequest('lesson_123');
  assert.deepEqual(request,{version:1,requestId:'lesson_123',type:'hello'});
  assert.deepEqual(parseHello({version:1,requestId:'lesson_123',type:'hello',code:'desktop_not_connected',capabilities:['handshake']},request.requestId),{connected:false,reason:'desktop_not_connected'});
});
test('invalid IDs and mismatched or unauthenticated replies cannot imply a connection',()=>{
  for(const value of ['', 'url?token=abc', 'a'.repeat(129)])assert.throws(()=>helloRequest(value));
  for(const reply of [null,{version:2,requestId:'a',type:'hello'}, {version:1,requestId:'b',type:'hello'}, {version:1,requestId:'a',type:'hello',code:'ok',capabilities:['handshake']}])assert.throws(()=>parseHello(reply,'a'));
});
