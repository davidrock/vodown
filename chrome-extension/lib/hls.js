import {DEFAULT_MAX_INPUT_MIB,MIB} from './settings.js';
export const MAX_INPUT_BYTES = DEFAULT_MAX_INPUT_MIB*MIB;

export class StreamError extends Error {
  constructor(message, {protectedVideo=false, status=0}={}) { super(message); this.protectedVideo=protectedVideo; this.status=status; }
}

export function trustedUrl(raw, platform) {
  const u=new URL(raw);
  const trusted=platform === 'hotmart' ? u.hostname.endsWith('.play.hotmart.com') || u.hostname === 'contentplayer.hotmart.com' : platform==='kiwify' ? u.hostname==='d3pjuhbfoxhm7c.cloudfront.net' : platform==='whop' && u.hostname.endsWith('.mux.com');
  if (u.protocol !== 'https:' || !trusted || u.username || u.password || (u.port && u.port !== '443')) throw new StreamError('O stream usa um servidor não suportado.');
  return u.href;
}

export function attrs(line) {
  const body=line.slice(line.indexOf(':')+1), result={};
  for (const match of body.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) result[match[1]]=match[2].replace(/^"|"$/g,'');
  return result;
}

function encryption(line, base, platform) {
  const a=attrs(line);
  if (a.METHOD === 'NONE') return null;
  if (platform !== 'hotmart' || a.METHOD !== 'AES-128' || (a.KEYFORMAT && a.KEYFORMAT !== 'identity')) throw new StreamError('Vídeo protegido por DRM ou criptografia não suportada.',{protectedVideo:true});
  if (!a.URI) throw new StreamError('A playlist não forneceu a URI de reprodução AES-128.');
  if (a.IV && !/^0x[\da-f]{1,32}$/i.test(a.IV)) throw new StreamError('IV AES-128 inválido.');
  return {uri:trustedUrl(new URL(a.URI,base).href,platform), iv:a.IV || null};
}

export function parsePlaylist(text, base, platform) {
  if (!text.replace(/^\uFEFF/,'').trimStart().startsWith('#EXTM3U')) throw new StreamError('A resposta não é HLS. Reabra a aula e tente novamente.');
  const result={variants:[], audio:[], subtitles:[], segments:[], end:false, duration:0};
  let pending=null, key=null, map=null, sequence=0, duration=0, byteRange=null, lastRange=null;
  for (const raw of text.split(/\r?\n/)) {
    const line=raw.trim(); if (!line) continue;
    if (line.startsWith('#EXT-X-SESSION-KEY:')) { encryption(line,base,platform); continue; }
    if (line.startsWith('#EXT-X-KEY:')) { key=encryption(line,base,platform); continue; }
    if (line.startsWith('#EXT-X-STREAM-INF:')) { pending=attrs(line); continue; }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const a=attrs(line);
      if (a.URI) trustedUrl(new URL(a.URI,base).href,platform);
      if (a.TYPE === 'AUDIO' && a.URI) result.audio.push({...a,url:new URL(a.URI,base).href});
      if (a.TYPE === 'SUBTITLES' && a.URI) result.subtitles.push({...a,url:new URL(a.URI,base).href});
      continue;
    }
    if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { sequence=Number(line.split(':')[1]); if(!Number.isSafeInteger(sequence)||sequence<0)throw new StreamError('Sequência HLS inválida.'); continue; }
    if (line.startsWith('#EXTINF:')) { duration=Number(line.slice(8).split(',')[0]); if(!Number.isFinite(duration)||duration<0)throw new StreamError('Duração HLS inválida.'); continue; }
    if (line.startsWith('#EXT-X-BYTERANGE:')) { byteRange=line.slice(17); continue; }
    if (line.startsWith('#EXT-X-MAP:')) {
      const a=attrs(line); if (!a.URI) throw new StreamError('Cabeçalho MP4 ausente.');
      map={url:trustedUrl(new URL(a.URI,base).href,platform),key:key ? {...key} : null,range:parseRange(a.BYTERANGE,null)};
      if (map.key && !map.key.iv) throw new StreamError('Cabeçalho AES-128 sem IV explícito.');
      continue;
    }
    if (line === '#EXT-X-ENDLIST') {result.end=true; continue;}
    if (line.startsWith('#EXT-X-GAP')) throw new StreamError('A playlist indica um segmento ausente.');
    if (line.startsWith('#')) continue;
    const url=trustedUrl(new URL(line,base).href,platform);
    if (pending) {
      const resolution=pending.RESOLUTION?.split('x').map(Number);
      result.variants.push({url,height:resolution?.[1] || 0, bandwidth:Number(pending['AVERAGE-BANDWIDTH'] || pending.BANDWIDTH) || 0, codecs:pending.CODECS || '',audioGroup:pending.AUDIO || null});
      pending=null;
    } else {
      const range=parseRange(byteRange,lastRange?.url===url ? lastRange.end+1 : null);
      if(key && range)throw new StreamError('HLS AES-128 com intervalos de bytes não é suportado.');
      result.segments.push({url,key:key ? {...key}:null,map,sequence:sequence++,duration,range});
      if(range)lastRange={url,end:range.end};
      result.duration+=duration; duration=0; byteRange=null;
    }
  }
  if (pending) throw new StreamError('Playlist de qualidades incompleta.');
  return result;
}

export function parseRange(value, previousEnd) {
  if (!value) return null;
  const match=value.match(/^(\d+)(?:@(\d+))?$/);
  if(!match)throw new StreamError('Intervalo de bytes inválido.');
  const size=Number(match[1]), start=match[2]===undefined ? previousEnd : Number(match[2]);
  if(!Number.isSafeInteger(size)||size<=0||!Number.isSafeInteger(start)||start<0)throw new StreamError('Intervalo de bytes sem posição inicial válida.');
  return {start,end:start+size-1};
}

export function chooseVariant(variants, quality, duration, maxInputBytes=MAX_INPUT_BYTES) {
  const supported=variants.filter(v=>!v.codecs || /avc1|avc3|h264/i.test(v.codecs));
  if(!supported.length)throw new StreamError('Nenhuma qualidade H.264 compatível foi oferecida.');
  const sorted=supported.sort((a,b)=>b.height-a.height || b.bandwidth-a.bandwidth);
  if(quality==='auto') {
    return sorted.find(v=>v.height<=1080 && (!duration || !v.bandwidth || v.bandwidth*duration/8 < maxInputBytes*0.8)) || sorted.at(-1);
  }
  return sorted.find(v=>v.height<=Number(quality)) || sorted.at(-1);
}

export function ivBytes(iv, sequence) {
  const hex=iv ? iv.replace(/^0x/i,'').padStart(32,'0') : BigInt(sequence).toString(16).padStart(32,'0');
  if(!/^[\da-f]{32}$/i.test(hex))throw new StreamError('IV AES-128 inválido.');
  return Uint8Array.from(hex.match(/../g),v=>parseInt(v,16));
}

export async function decryptSegment(bytes, keyBytes, key, sequence) {
  if(keyBytes.byteLength!==16)throw new StreamError('O servidor não forneceu uma chave HLS AES-128 válida.');
  const imported=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-CBC'},false,['decrypt']);
  try {return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv:ivBytes(key.iv,sequence)},imported,bytes));}
  catch {throw new StreamError('Falha ao processar o segmento AES-128 autorizado.');}
}

export async function resource(url, platform, signal, maxBytes, range=null) {
  trustedUrl(url,platform);
  for(let attempt=0;attempt<3;attempt++) {
    const controller=new AbortController(); const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted)abort();
    const timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(url,{credentials:'include',signal:controller.signal,headers:range ? {Range:`bytes=${range.start}-${range.end}`} : {}});
      trustedUrl(response.url || url,platform);
      if(!response.ok)throw new StreamError(`O servidor recusou a reprodução (HTTP ${response.status}).`,{status:response.status});
      const length=Number(response.headers.get('content-length'));
      if(length>maxBytes)throw new StreamError('O download ultrapassa o limite de tamanho. Aumente o limite por aula ou escolha uma qualidade menor.');
      const reader=response.body.getReader(), chunks=[]; let size=0;
      while(true){const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>maxBytes){await reader.cancel();throw new StreamError('O download ultrapassa o limite de tamanho. Aumente o limite por aula ou escolha uma qualidade menor.');}chunks.push(value);}
      const data=new Uint8Array(size); let offset=0; for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
      if(range && response.status!==206){if(data.length<=range.end)throw new StreamError('Servidor ignorou o intervalo de bytes.');return data.slice(range.start,range.end+1);}
      return data;
    } catch(error) {
      if(signal?.aborted)throw new DOMException('Cancelado','AbortError');
      if(error.protectedVideo || error.status===401 || error.status===403 || attempt===2 || (error instanceof StreamError && error.status!==429 && error.status<500))throw error;
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
}

export async function planHls(lesson, quality, signal, maxInputBytes=MAX_INPUT_BYTES) {
  if(lesson.drm || lesson.encryption)throw new StreamError('Vídeo protegido por DRM.',{protectedVideo:true});
  const platform=lesson.platform;
  const read=async url=>parsePlaylist(new TextDecoder().decode(await resource(url,platform,signal,2_000_000)),url,platform);
  const root=await read(lesson.url);
  let variant=null, video=root, audio=null;
  if(root.variants.length) {
    variant=chooseVariant(root.variants,quality,lesson.duration,maxInputBytes);
    video=await read(variant.url);
    if(variant.audioGroup) {
      const group=root.audio.filter(a=>a['GROUP-ID']===variant.audioGroup);
      const chosen=group.find(a=>a.DEFAULT==='YES') || group[0];
      if(chosen)audio=await read(chosen.url);
    }
  }
  for(const track of [video,audio].filter(Boolean)) {
    if(!track.segments.length || track.variants.length)throw new StreamError('A playlist não contém segmentos de vídeo suportados.');
    if(!track.end && (!lesson.duration || Math.abs(track.duration-lesson.duration)>3))throw new StreamError('Transmissões ao vivo ou playlists incompletas não são suportadas.');
    if(lesson.duration && Math.abs(track.duration-lesson.duration)>3)throw new StreamError('A duração da playlist não confere com a aula.');
  }
  return {video,audio,height:variant?.height || null,duration:video.duration,segments:video.segments.length+(audio?.segments.length||0)};
}

export async function downloadTracks(plan, lesson, signal, onProgress, maxInputBytes=MAX_INPUT_BYTES) {
  const budget={used:0}, keys=new Map(), outputs=[];
  let finished=0;
  const getBytes=async item=> {
    let bytes=await resource(item.url,lesson.platform,signal,Math.min(maxInputBytes-budget.used,16*1024*1024),item.range);
    if(item.key) {
      if(!keys.has(item.key.uri))keys.set(item.key.uri,resource(item.key.uri,lesson.platform,signal,1024));
      bytes=await decryptSegment(bytes,await keys.get(item.key.uri),item.key,item.sequence || 0);
    }
    budget.used+=bytes.length;
    if(budget.used>maxInputBytes)throw new StreamError(`Esta aula ultrapassa o limite de ${Math.round(maxInputBytes/MIB)} MB definido. Aumente o limite ou escolha uma qualidade menor.`);
    return bytes;
  };
  for(const track of [plan.video,plan.audio].filter(Boolean)) {
    const pieces=[]; let previousMap=null;
    // Bounded batches keep at most four in-flight fragments, preserving playback order.
    for(let i=0;i<track.segments.length;i+=4) {
      if(signal.aborted)throw new DOMException('Cancelado','AbortError');
      const batch=track.segments.slice(i,i+4);
      const bytes=await Promise.all(batch.map(async item=>({item,data:await getBytes(item)})));
      for(const {item,data} of bytes) {
        const mapKey=item.map ? JSON.stringify(item.map) : null;
        if(mapKey && mapKey!==previousMap){pieces.push(await getBytes(item.map));previousMap=mapKey;}
        pieces.push(data); finished++; onProgress?.({stage:'Baixando segmentos',percent:Math.round(finished/plan.segments*100),bytes:budget.used});
      }
    }
    const total=pieces.reduce((sum,b)=>sum+b.length,0), output=new Uint8Array(total); let offset=0;
    for(const piece of pieces){output.set(piece,offset);offset+=piece.length;}
    pieces.length=0; outputs.push(output);
  }
  keys.clear(); return outputs;
}
