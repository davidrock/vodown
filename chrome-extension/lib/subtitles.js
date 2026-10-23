import {parsePlaylist,resource,StreamError,trustedUrl} from './hls.js';
import {safeError} from './model.js';

const MAX_TEXT=8*1024*1024;
const clock='(?:\\d{2,}:)?\\d{2}:\\d{2}\\.\\d{3}';
const timing=new RegExp(`^(${clock})\\s+-->\\s+(${clock})(.*)$`);
const millis=value=>value.split(':').reduce((n,part)=>n*60+Number(part),0)*1000;
const stamp=(value,separator='.')=>{
  const n=Math.max(0,Math.round(value));
  return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')}${separator}${String(n%1000).padStart(3,'0')}`;
};

export function parseVtt(text) {
  const normalized=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized))throw new StreamError('A faixa não contém legendas WebVTT válidas.');
  const blocks=normalized.split(/\n[ \t]*\n/),header=blocks.shift();
  const map=header.match(/X-TIMESTAMP-MAP=([^\n]+)/)?.[1];
  let offset=null;
  if(map) {
    const local=map.match(new RegExp(`LOCAL:(${clock})`))?.[1],mpeg=map.match(/MPEGTS:(\d+)/)?.[1];
    if(!local||!mpeg||!Number.isSafeInteger(Number(mpeg)))throw new StreamError('Mapa de tempo da legenda inválido.');
    offset=Number(mpeg)/90-millis(local);
  }
  const cues=[];
  for(const block of blocks) {
    const lines=block.trim().split('\n');
    if(!lines[0]||/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0]))continue;
    const i=lines[0].includes('-->')?0:1,match=lines[i]?.match(timing);
    if(!match)throw new StreamError('Uma entrada da legenda tem marcação de tempo inválida.');
    const start=millis(match[1]),end=millis(match[2]),body=lines.slice(i+1).join('\n');
    if(!Number.isFinite(start)||end<start)throw new StreamError('Uma entrada da legenda está incompleta.');
    // Mux may emit zero-duration cues at segmentation boundaries; they cannot display.
    if(end===start||!body)continue;
    cues.push({start,end,settings:match[3],text:body});
  }
  return {cues,offset};
}

export function mergeVtt(parts) {
  // Map each MPEGTS clock to the first segment's timeline, including 33-bit wrap.
  const first=parts.find(p=>p.offset!==null),origin=first?first.offset-(first.start||0):0,wrap=2**33/90;
  const cues=[],seen=new Set();
  for(const part of parts) {
    let shift=part.offset===null?0:part.offset-origin;
    if(part.offset!==null)shift+=Math.round(((part.start||0)-shift)/wrap)*wrap;
    for(const cue of part.cues) {
      const item={...cue,start:Math.round(cue.start+shift),end:Math.round(cue.end+shift)};
      const key=`${item.start}:${item.end}:${item.text}:${item.settings}`;
      if(!seen.has(key)&&item.end>0){seen.add(key);cues.push(item);}
    }
  }
  return cues.sort((a,b)=>a.start-b.start||a.end-b.end);
}

export function renderSubtitles(cues,format) {
  if(!['vtt','srt'].includes(format))throw new StreamError('Formato de legenda inválido.');
  const text=cues.map((cue,i)=>{
    const body=format==='srt'?cue.text.replace(/<[^>]*>/g,''):cue.text;
    return `${i+1}\n${stamp(cue.start,format==='srt'?',':'.')} --> ${stamp(cue.end,format==='srt'?',':'.')}${format==='vtt'?cue.settings||'':''}\n${body}\n`;
  }).join('\n');
  return (format==='vtt'?'WEBVTT\n\n':'')+text;
}

export function selectSubtitles(tracks,language='original',audio=[],originalLanguage=null) {
  const code=track=>(track.LANGUAGE||track.language||'und').toLowerCase();
  const full=tracks.filter(t=>t.FORCED!=='YES');
  const offered=full.length?full:tracks;
  const match=(items,wanted)=>items.find(t=>code(t)===wanted)||items.find(t=>code(t).split('-')[0]===wanted);
  let chosen;
  if(language==='original') {
    const original=String(originalLanguage||audio.find(t=>t.DEFAULT==='YES')?.LANGUAGE||audio[0]?.LANGUAGE||'').toLowerCase();
    if(original&&!['und','zxx'].includes(original))return [match(offered,original)||match(offered,original.split('-')[0])].filter(Boolean);
    // Prefer a single default track when the player does not identify the audio language.
    chosen=offered.find(t=>/\boriginal\b/i.test(t.NAME||t.label||''))||offered.find(t=>t.DEFAULT==='YES')||offered[0];
  }else chosen=match(offered,language.toLowerCase());
  return chosen?[chosen]:[];
}

export async function downloadSubtitles(lesson,settings,signal) {
  if(lesson.platform!=='whop')return {files:[],warnings:[],available:0};
  if(lesson.drm||lesson.encryption)throw new StreamError('Vídeo protegido por DRM.',{protectedVideo:true});
  const read=async url=>new TextDecoder('utf-8',{fatal:true}).decode(await resource(url,'whop',signal,MAX_TEXT));
  const root=parsePlaylist(await read(lesson.url),lesson.url,'whop');
  const offered=[...root.subtitles,...(lesson.subtitles||[])];
  if(!['srt','vtt'].includes(settings.subtitleFormat))throw new StreamError('Escolha SRT ou VTT para as legendas.');
  const tracks=selectSubtitles(offered,settings.subtitleLanguage,root.audio,lesson.originalLanguage);
  if(tracks.length>50)throw new StreamError('O player ofereceu faixas de legenda demais.');
  const files=[],warnings=[];
  for(const track of tracks) {
    const index=offered.indexOf(track);
    const label=track.LANGUAGE||track.language||track.NAME||track.label||'und';
    try {
      trustedUrl(track.url,'whop');
      const source=await read(track.url),parts=[];
      if(source.replace(/^\uFEFF/,'').trimStart().startsWith('#EXTM3U')) {
        const playlist=parsePlaylist(source,track.url,'whop');
        if(!playlist.end||playlist.variants.length||playlist.segments.length>3000||!playlist.segments.length)throw new StreamError('Playlist de legenda incompleta ou não suportada.');
        let size=0,start=0;
        for(const segment of playlist.segments) {
          if(segment.key||segment.map||segment.range)throw new StreamError('A faixa de legenda usa proteção ou um formato não suportado.');
          const text=await read(segment.url);size+=new TextEncoder().encode(text).length;
          if(size>MAX_TEXT)throw new StreamError('A legenda ultrapassa o limite de 8 MB.');
          parts.push({...parseVtt(text),start});start+=segment.duration*1000;
        }
      } else parts.push({...parseVtt(source),start:0});
      const cues=mergeVtt(parts);
      if(!cues.length)throw new StreamError('A faixa de legenda está vazia.');
      const format=settings.subtitleFormat;
      files.push({language:label,track:index+1,format,text:renderSubtitles(cues,format)});
    }catch(error) {
      if(signal.aborted)throw new DOMException('Cancelado','AbortError');
      warnings.push(safeError(`Legenda ${label}: ${error.status?`HTTP ${error.status}`:safeError(error)}`));
    }
  }
  return {files,warnings,available:tracks.length};
}
