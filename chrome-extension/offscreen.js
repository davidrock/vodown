import {FFmpeg} from './vendor/ffmpeg/classes.js';
import {planHls, downloadTracks} from './lib/hls.js';
import {safeError} from './lib/model.js';
import {inputBudget} from './lib/settings.js';
import {downloadSubtitles} from './lib/subtitles.js';

let active=null;
const blobs=new Map();
const progress = data => chrome.runtime.sendMessage({target:'background',action:'progress',...data}).catch(()=>{});

function keepBlob(jobId,blob) {
  const url=URL.createObjectURL(blob);
  blobs.set(jobId,[...(blobs.get(jobId)||[]),url]);
  return url;
}

async function subtitles(message,signal) {
  try {
    const result=await downloadSubtitles(message.lesson,message.settings,signal);
    return {...result,files:result.files.map(({text,...file})=>({...file,blobUrl:keepBlob(message.jobId,new Blob([text],{type:file.format==='vtt'?'text/vtt;charset=utf-8':'application/x-subrip;charset=utf-8'}))}))};
  } catch(error) {
    if(signal.aborted||error.protectedVideo)throw error;
    return {files:[],available:0,warnings:[`Legendas: ${safeError(error)}`]};
  }
}

async function loadEngine(job) {
  const ffmpeg=new FFmpeg();job.ffmpeg=ffmpeg;
  await ffmpeg.load({classWorkerURL:chrome.runtime.getURL('vendor/ffmpeg/worker.js'),coreURL:chrome.runtime.getURL('vendor/core/ffmpeg-core.js'),wasmURL:chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm')});
  if(job.controller.signal.aborted){ffmpeg.terminate();throw new DOMException('Cancelado','AbortError');}
  return ffmpeg;
}

async function checkVideo(ffmpeg, expected) {
  const code=await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration,format_name:stream=codec_type,width,height','-of','json','output.mp4','-o','probe.json']);
  // core 0.12.10 may report -1 because its ffprobe wrapper does not set Module.ret.
  // A fresh instance has no old probe.json; require complete valid metadata below.
  if(code!==0 && code!==-1)throw new Error('O MP4 não passou na validação.');
  const data=JSON.parse(await ffmpeg.readFile('probe.json','utf8'));
  const video=data.streams?.find(s=>s.codec_type==='video');
  const audio=data.streams?.some(s=>s.codec_type==='audio');
  const duration=Number(data.format?.duration);
  if(!video?.width||!audio||!Number.isFinite(duration)||duration<=0||!data.format?.format_name?.includes('mp4'))throw new Error('O arquivo não contém vídeo e áudio em MP4 válidos.');
  if(expected && Math.abs(duration-expected)>3)throw new Error('O MP4 gerado tem duração diferente da aula.');
  return {duration,width:video.width,height:video.height};
}

async function process(message) {
  if(active)throw new Error('Já existe uma aula em processamento.');
  const job={controller:new AbortController(),ffmpeg:null,stage:'Conferindo a playlist'};active=job;
  const heartbeat=setInterval(()=>progress({stage:job.stage}),5000);
  try {
    if(message.mode==='subtitles') {
      job.stage='Baixando legendas';progress({stage:job.stage});
      return {subtitles:await subtitles(message,job.controller.signal)};
    }
    const maxInputBytes=inputBudget(message.settings);
    const plan=await planHls(message.lesson,message.quality,job.controller.signal,maxInputBytes);
    if(message.mode==='validate')return {validated:true,height:plan.height,duration:plan.duration,segments:plan.segments};
    job.stage='Preparando o processamento no Chrome';progress({stage:job.stage});
    const ffmpeg=await loadEngine(job);
    job.stage='Baixando segmentos';progress({stage:job.stage});
    const tracks=await downloadTracks(plan,message.lesson,job.controller.signal,data=>progress(data),maxInputBytes);
    await ffmpeg.writeFile('video.bin',tracks[0]);tracks[0]=null;
    const audio=tracks.length>1;
    if(audio){await ffmpeg.writeFile('audio.bin',tracks[1]);tracks[1]=null;}
    job.stage='Gerando MP4';progress({stage:job.stage,height:plan.height});
    const code=await ffmpeg.exec(['-fflags','+genpts','-i','video.bin',...(audio ? ['-i','audio.bin']:[]),'-map','0:v:0','-map',audio?'1:a:0':'0:a:0','-c','copy','-movflags','+faststart','output.mp4']);
    if(code!==0)throw new Error('Não foi possível reunir vídeo e áudio em MP4.');
    const bytes=await ffmpeg.readFile('output.mp4');
    if(bytes.length<1024)throw new Error('O MP4 gerado está vazio.');
    const blob=new Blob([bytes],{type:'video/mp4'});
    // Release input buffers and the first WASM heap before probing the output.
    // The bundled FFmpeg core needs a fresh instance for ffprobe after exec.
    ffmpeg.terminate();
    job.stage='Conferindo o arquivo';progress({stage:job.stage});
    const probe=await loadEngine(job);
    await probe.writeFile('output.mp4',bytes);
    const metadata=await checkVideo(probe,message.lesson.duration || plan.duration);
    if(job.controller.signal.aborted)throw new DOMException('Cancelado','AbortError');
    const blobUrl=keepBlob(message.jobId,blob);
    const captions=message.lesson.platform==='whop'&&message.includeSubtitles===true?await subtitles(message,job.controller.signal):null;
    return {blobUrl,bytes:blob.size,...metadata,subtitles:captions};
  } finally {clearInterval(heartbeat);job.controller.abort();job.ffmpeg?.terminate();active=null;}
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||message.target!=='offscreen')return false;
  if(message.action==='cancel'){active?.controller.abort();active?.ffmpeg?.terminate();respond({ok:true});return false;}
  if(message.action==='release'){for(const url of blobs.get(message.jobId)||[])URL.revokeObjectURL(url);blobs.delete(message.jobId);respond({ok:true});return false;}
  if(message.action!=='process')return false;
  process(message).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:safeError(error),protectedVideo:!!error.protectedVideo,status:error.status||0,cancelled:error.name==='AbortError'}));
  return true;
});
