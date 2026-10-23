import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {parsePlaylist,chooseVariant,trustedUrl,ivBytes,decryptSegment,parseRange,downloadTracks} from '../lib/hls.js';
import {courseScope,sameCourse,validateSelection,publicState,safeError,stateForCourse} from '../lib/model.js';
import {downloadFilename} from '../lib/downloads.js';
import {DEFAULT_DOWNLOAD_FOLDER,DEFAULT_VIDEO_QUALITY,normalizeDownloadFolder,normalizeSettings,inputBudget,MIB} from '../lib/settings.js';
globalThis.crypto ??= webcrypto;
const hot='https://vod-akm.play.hotmart.com/video/demo/hls/master.m3u8?hdnts=private';
const key='https://contentplayer.hotmart.com/video/demo/key.key';

test('master picks the matching separate audio group and ignores seek previews',()=>{
  const p=parsePlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Português, original",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"\nvideo.m3u8\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=123,URI="missing.m3u8"',hot,'hotmart');
  assert.equal(p.variants.length,1);assert.equal(p.variants[0].audioGroup,'a');assert.equal(p.audio[0].NAME,'Português, original');assert.equal(p.segments.length,0);
});
test('Hotmart AES-128 is allowed and session keys do not become media segments',()=>{
  const p=parsePlaylist(`#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="${key}"\n#EXT-X-KEY:METHOD=AES-128,URI="${key}"\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:2.0,\nseg.ts\n#EXT-X-ENDLIST`,hot,'hotmart');
  assert.equal(p.duration,2);assert.equal(p.segments[0].key.uri,key);assert.equal(p.segments[0].sequence,42);assert.equal(p.end,true);
});
test('DRM key formats and methods are refused',()=>{
  for(const line of [`#EXT-X-KEY:METHOD=SAMPLE-AES,URI="${key}"`,`#EXT-X-SESSION-KEY:METHOD=AES-128,KEYFORMAT="com.apple.streamingkeydelivery",URI="${key}"`])assert.throws(()=>parsePlaylist('#EXTM3U\n'+line,hot,'hotmart'),e=>e.protectedVideo===true);
  assert.throws(()=>parsePlaylist(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://stream.mux.com/key"`,'https://stream.mux.com/demo.m3u8','whop'),e=>e.protectedVideo===true);
});
test('URL allowlists reject lookalikes, insecure protocols and credentials',()=>{
  for(const url of ['https://vod-akm.play.hotmart.com.evil.invalid/a','http://vod-akm.play.hotmart.com/a','https://user:pass@vod-akm.play.hotmart.com/a'])assert.throws(()=>trustedUrl(url,'hotmart'));
  assert.throws(()=>parsePlaylist('#EXTM3U\n#EXTINF:2,\nhttps://evil.invalid/seg.ts',hot,'hotmart'));
});
test('AES CBC uses sequence IV and removes standard HLS padding',async()=>{
  const raw=Uint8Array.from({length:16},(_,i)=>i),plain=new TextEncoder().encode('authorized fixture segment');
  const k=await crypto.subtle.importKey('raw',raw,'AES-CBC',false,['encrypt']);
  const encrypted=await crypto.subtle.encrypt({name:'AES-CBC',iv:ivBytes(null,42)},k,plain);
  assert.deepEqual(await decryptSegment(encrypted,raw,{iv:null},42),plain);
  assert.equal(ivBytes(null,42)[15],42);assert.throws(()=>ivBytes('0xfffffffffffffffffffffffffffffffff',0));
});
test('byte ranges and init maps retain offsets and reject undefined continuation',()=>{
  const p=parsePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="10@0"\n#EXT-X-BYTERANGE:20@10\n#EXTINF:2,\nfile.mp4\n#EXT-X-BYTERANGE:20\n#EXTINF:2,\nfile.mp4\n#EXT-X-ENDLIST',hot,'hotmart');
  assert.deepEqual(p.segments[1].range,{start:30,end:49});assert.equal(p.segments[0].map.range.end,9);assert.throws(()=>parseRange('20',null));
});
test('automatic quality adapts long lessons without transcoding',()=>{
  const list=[{height:1080,bandwidth:3000000},{height:720,bandwidth:900000},{height:360,bandwidth:200000}];
  assert.equal(chooseVariant(list,'auto',1800).height,720);assert.equal(chooseVariant(list,'1080',1800).height,1080);
  assert.equal(chooseVariant(list,'auto',1800,inputBudget({maxInputMiB:1000})).height,1080);
  assert.equal(chooseVariant(list,'auto',1800,inputBudget({maxInputMiB:100})).height,360);
});

test('per-lesson limit accepts persisted preferences and refuses invalid numbers',()=>{
  assert.deepEqual(normalizeSettings(),{maxInputMiB:300,videoQuality:DEFAULT_VIDEO_QUALITY,downloadFolder:DEFAULT_DOWNLOAD_FOLDER,subtitleFormat:'srt',subtitleLanguage:'original'});
  assert.equal(inputBudget({maxInputMiB:'750'}),750*MIB);
  for(const n of [0,49,1501,Infinity,NaN,300.5,''])assert.throws(()=>normalizeSettings({maxInputMiB:n}));
});

test('settings accept a quality and a safe subfolder of Chrome Downloads',()=>{
  assert.deepEqual(normalizeSettings({maxInputMiB:750,videoQuality:'720',downloadFolder:'Cursos\\Offline/'}),{maxInputMiB:750,videoQuality:'720',downloadFolder:'Cursos/Offline',subtitleFormat:'srt',subtitleLanguage:'original'});
  for(const folder of ['', '../Cursos', '/Cursos', 'Cursos/../Privado', 'Cursos:privados'])assert.throws(()=>normalizeDownloadFolder(folder));
  assert.throws(()=>normalizeSettings({videoQuality:'1440'}));
});

test('download filenames stay under the selected Chrome Downloads subfolder',()=>{
  const name=downloadFilename({platform:'hotmart',slug:'curso/demo'},{module_index:2,module:'Módulo: inicial',index:3,title:'Aula / teste'},'Cursos/Offline');
  assert.equal(name,'Cursos/Offline/Hotmart/curso-demo/02 - Módulo- inicial/003 - Aula - teste.mp4');
});

test('download enforces the supplied combined audio and video budget',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(new Uint8Array(400));
  const track={segments:[{url:'https://stream.mux.com/segment.ts',duration:1}]};
  const plan={video:track,audio:track,segments:2};
  try {
    await assert.rejects(downloadTracks(plan,{platform:'whop'},new AbortController().signal,null,600),/limite/);
    const tracks=await downloadTracks(plan,{platform:'whop'},new AbortController().signal,null,900);
    assert.equal(tracks.reduce((n,t)=>n+t.length,0),800);
  }finally{globalThis.fetch=original;}
});

test('panel hides another course and its results while preserving queue cancellation',()=>{
  const hotScope=courseScope('https://hotmart.com/pt-br/club/one/products/123');
  const other=courseScope('https://hotmart.com/pt-br/club/one/products/456');
  const state={inventory:{...hotScope,lessons:[{title:'Private previous lesson'}]},busy:true,operation:{key:hotScope.key,kind:'download'},current:'Previous',results:[{title:'Previous'}],logs:['Previous'],error:'Previous',total:9,finished:2,settings:{maxInputMiB:750,videoQuality:'auto',downloadFolder:'Cursos'}};
  for(const scope of [other,null]) {
    const view=stateForCourse(state,scope);
    assert.equal(view.inventory,null);assert.equal(view.current,null);assert.equal(view.results.length,0);assert.equal(view.logs.length,0);assert.equal(view.error,null);assert.equal(view.busy,true);assert.equal(view.settings.maxInputMiB,750);
  }
  assert.equal(stateForCourse(state,hotScope),state);
});
test('course scopes accept unrelated accounts and courses without hardcoded IDs',()=>{
  const whop='https://whop.com/ecomparadise-pro/exp_KonHrRHXqBBimy/app/courses/cors_2QlPwjJrsJXbjrRbaV4Cnz/lessons/lesn_4bmVM8RDwDWSy94PcOefJ7/';
  assert.equal(courseScope(whop).platform,'whop');assert(sameCourse(whop,whop.replace('lesn_4bmVM8RDwDWSy94PcOefJ7','lesn_another')));
  assert.equal(courseScope('https://hotmart.com/en/club/another/products/987/content/a').slug,'another');
  assert(sameCourse('https://hotmart.com/pt-BR/club/another/products/987','https://hotmart.com/pt-br/club/another/products/987/content/a'));
  assert(!sameCourse('https://hotmart.com/en/club/another/products/987','https://hotmart.com/en/club/another/products/988'));
});

test('Kiwify scopes preserve course and club identity across modules and lessons',()=>{
  const course='11111111-1111-4111-8111-111111111111', module='22222222-2222-4222-8222-222222222222', lesson='33333333-3333-4333-8333-333333333333';
  const url=`https://members.kiwify.com/${course}/${module}/${lesson}?club=demo`;
  assert.equal(courseScope(url).platform,'kiwify');
  assert(sameCourse(url,url.replace(module,lesson).replace(`/${lesson}?`,`/${module}?`)));
  assert(!sameCourse(url,url.replace('club=demo','club=other')));
  assert(!sameCourse(url,url.replace(course,module)));
  assert.throws(()=>courseScope(url.replace('members.kiwify.com','members.kiwify.com.evil.invalid')));
  assert(downloadFilename(courseScope(url),{index:1,title:'Aula'},'Cursos').startsWith('Cursos/Kiwify/'));
});

test('Kiwify HLS accepts the observed CDN and refuses encryption and other CDNs',()=>{
  const url='https://d3pjuhbfoxhm7c.cloudfront.net/demo/master.m3u8';
  const playlist=parsePlaylist('#EXTM3U\n#EXTINF:6,\nvideo.ts\n#EXT-X-ENDLIST',url,'kiwify');
  assert.equal(playlist.duration,6);assert(playlist.end);
  for(const host of ['other.cloudfront.net','d3pjuhbfoxhm7c.cloudfront.net.evil.invalid','stream.mux.com'])assert.throws(()=>trustedUrl(`https://${host}/x`,'kiwify'));
  assert.throws(()=>parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"',url,'kiwify'),e=>e.protectedVideo===true);
});
test('validation is limited to one selected lesson and cannot start a full course',()=>{
  const inv={lessons:[{id:'1'},{id:'2'}]};assert.equal(validateSelection(inv,['1','2'],'validate').length,1);assert.equal(validateSelection(inv,['1','2'],'download').length,2);assert.throws(()=>validateSelection(inv,['3'],'download'));
});
test('public state and errors omit playback tokens',()=>{
  const state={inventory:null,busy:false,logs:[],playbackUrl:'https://stream.mux.com/demo?token=private',secret:'private'};
  assert(!JSON.stringify(publicState(state)).includes('private'));assert(!safeError('HTTP error https://stream.mux.com/demo?token=private').includes('private'));
});
