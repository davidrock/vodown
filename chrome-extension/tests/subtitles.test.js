import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVtt,mergeVtt,renderSubtitles,selectSubtitles,downloadSubtitles} from '../lib/subtitles.js';
import {parsePlaylist} from '../lib/hls.js';
import {subtitleFilename} from '../lib/downloads.js';
import {normalizeSettings} from '../lib/settings.js';

const url='https://stream.mux.com/demo.m3u8?token=private';
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="pt-BR",NAME="Português",URI="subs/list.m3u8?token=private"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="en",NAME="English",URI="en.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=1,SUBTITLES="s"\nvideo.m3u8';
const vtt='WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start\nOlá <b>mundo</b>!\n';

test('HLS retains all subtitle languages and signed URIs separately from audio',()=>{
  const p=parsePlaylist(master,url,'whop');
  assert.equal(p.audio.length,0);assert.equal(p.subtitles.length,2);
  assert.equal(p.subtitles[0].url,'https://stream.mux.com/subs/list.m3u8?token=private');
});

test('VTT keeps timing and text, while SRT removes cue settings and VTT tags',()=>{
  const cues=mergeVtt([{...parseVtt(vtt),start:0}]);
  assert.match(renderSubtitles(cues,'vtt'),/00:00:01\.000 --> 00:00:02\.500 align:start/);
  assert.equal(renderSubtitles(cues,'srt'),'1\n00:00:01,000 --> 00:00:02,500\nOlá mundo!\n');
  assert.throws(()=>parseVtt('not vtt'));
  assert.throws(()=>parseVtt('WEBVTT\n\n00:01.000 --> 00:00.000\nBad'));
  assert.equal(parseVtt('WEBVTT\n\n00:01.000 --> 00:01.000\nBoundary\n').cues.length,0);
});

test('segmented VTT maps local clocks, deduplicates overlapping cues and preserves gaps',()=>{
  const one=parseVtt('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:02.000\nFirst\n');
  const two=parseVtt('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:1800000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nSecond\n');
  const cues=mergeVtt([{...one,start:0},{...one,start:0},{...two,start:10000}]);
  assert.equal(cues.length,2);assert.equal(cues[0].start,1000);assert.equal(cues[1].start,11000);
});

test('MPEGTS wrap keeps subtitle timestamps on the lesson timeline',()=>{
  const wrap=2**33/90;
  const cue={start:1000,end:2000,text:'wrap',settings:''};
  const cues=mergeVtt([{cues:[cue],offset:wrap-5000,start:0},{cues:[cue],offset:5000,start:10000}]);
  assert.equal(cues[1].start,11000);
});

test('one language selects a single track, with exact regions and no all option',()=>{
  const tracks=[{LANGUAGE:'pt-BR',NAME:'Português'},{LANGUAGE:'pt-PT',NAME:'Português PT'},{LANGUAGE:'en',NAME:'English'}];
  assert.equal(selectSubtitles([...tracks,tracks[0]]).length,1);
  assert.equal(selectSubtitles(tracks,'pt').length,1);
  assert.equal(selectSubtitles(tracks,'pt-br').length,1);
  assert.equal(selectSubtitles(tracks,'es').length,0);
  assert.equal(normalizeSettings({subtitleLanguage:' PT '}).subtitleLanguage,'pt');
  assert.throws(()=>normalizeSettings({subtitleLanguage:'../pt'}));
  assert.throws(()=>normalizeSettings({subtitleLanguage:'all'}));
  assert.throws(()=>normalizeSettings({subtitleFormat:'ass'}));
});

test('original language follows default audio, avoiding translated or forced tracks',()=>{
  const tracks=[{LANGUAGE:'pt',DEFAULT:'YES'},{LANGUAGE:'en',FORCED:'YES'},{LANGUAGE:'en'},{LANGUAGE:'es'}];
  assert.equal(selectSubtitles(tracks,'original',[{LANGUAGE:'es'},{LANGUAGE:'en',DEFAULT:'YES'}])[0],tracks[2]);
  assert.equal(selectSubtitles(tracks,'original',[], 'en-US')[0],tracks[2]);
  assert.equal(selectSubtitles(tracks,'original',[{LANGUAGE:'de',DEFAULT:'YES'}]).length,0);
  assert.equal(selectSubtitles(tracks)[0],tracks[0]);
});

test('legacy all and multiple languages migrate to original, with a single explicit format',()=>{
  for(const subtitleLanguages of ['all','pt,en',undefined])assert.equal(normalizeSettings({subtitleLanguages}).subtitleLanguage,'original');
  assert.equal(normalizeSettings({subtitleLanguages:'en',subtitleFormat:'srt'}).subtitleFormat,'srt');
  assert.equal(normalizeSettings({subtitleLanguages:'en'}).subtitleLanguage,'en');
  assert.equal(normalizeSettings({subtitleFormat:'off'}).subtitleFormat,'srt');
  assert.equal(normalizeSettings({subtitleFormat:'both'}).subtitleFormat,'srt');
});

test('caption filenames remain next to the MP4 and sanitize labels',()=>{
  const filename=subtitleFilename({platform:'whop',slug:'demo'},{title:'Aula',index:1},'Cursos',{language:'pt/BR',track:1,format:'srt'});
  assert.equal(filename,'Cursos/Whop/demo/01 - Aulas/001 - Aula.pt-BR.1.srt');
});

test('downloads segmented subtitles and direct VTT without requesting video or audio',async()=>{
  const original=globalThis.fetch,requests=[];
  globalThis.fetch=async raw=>{
    const u=new URL(raw);requests.push(u.pathname);
    const body=u.pathname==='/demo.m3u8'?master:u.pathname==='/subs/list.m3u8'?'#EXTM3U\n#EXTINF:3,\none.vtt\n#EXTINF:3,\ntwo.vtt\n#EXT-X-ENDLIST':u.pathname==='/subs/two.vtt'?vtt.replace('01.000','04.000').replace('02.500','05.500'):vtt;
    return new Response(body);
  };
  try {
    const result=await downloadSubtitles({platform:'whop',url},normalizeSettings({subtitleFormat:'srt',subtitleLanguage:'pt'}),new AbortController().signal);
    assert.equal(result.files.length,1);assert.equal(result.warnings.length,0);
    assert(!requests.some(p=>/video|audio|\.ts/.test(p)));
    assert.match(result.files[0].text,/00:00:04,000/);
    assert.equal(result.files[0].format,'srt');assert(!result.files[0].text.startsWith('WEBVTT'));
    const vttResult=await downloadSubtitles({platform:'whop',url},normalizeSettings({subtitleLanguage:'pt',subtitleFormat:'vtt'}),new AbortController().signal);
    assert.equal(vttResult.files[0].format,'vtt');assert(vttResult.files[0].text.startsWith('WEBVTT'));
    const filtered=await downloadSubtitles({platform:'whop',url},normalizeSettings({subtitleLanguage:'es'}),new AbortController().signal);
    assert.equal(filtered.available,0);assert.equal(filtered.files.length,0);
  }finally{globalThis.fetch=original;}
});

test('failed or untrusted subtitles report a warning without exposing tokens',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async raw=>new Response(new URL(raw).pathname==='/demo.m3u8'?master:vtt,{status:new URL(raw).pathname==='/subs/list.m3u8'?403:200});
  try {
    const result=await downloadSubtitles({platform:'whop',url},normalizeSettings(),new AbortController().signal);
    assert.equal(result.files.length,0);assert.equal(result.warnings.length,1);
    assert(!JSON.stringify(result).includes('private'));
    const bad=await downloadSubtitles({platform:'whop',url,subtitles:[{language:'es',url:'https://evil.invalid/sub.vtt'}]},normalizeSettings({subtitleLanguage:'es'}),new AbortController().signal);
    assert.equal(bad.files.length,0);assert.equal(bad.warnings.length,1);
  }finally{globalThis.fetch=original;}
});
