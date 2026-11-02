import {readCoursePage} from './lib/scan-read.js';
import {collectHotmartTracks} from './lib/hotmart-tracks.js';
import {downloadSubtitles} from './lib/subtitles.js';
import {autoDiscovery} from './lib/auto-discovery.js';
import {createDesktopBridge} from './lib/desktop-bridge.js';
import {NATIVE_HOST,helloRequest,parseHello} from './lib/native-protocol.js';
import {collectPage} from './lib/collector.js';
import {downloadFilename,subtitleFilename} from './lib/downloads.js';
import {courseScope,sameCourse,safeError,publicState,validateSelection} from './lib/model.js';
import {normalizeSettings} from './lib/settings.js';
import {account} from './lib/account-runtime.js';

let state={inventory:null,busy:false,stage:'Abra um curso da Hotmart, Whop ou Kiwify.',current:null,total:0,finished:0,results:[],logs:[],error:null,engine:true,settings:normalizeSettings(),operation:null,contextKey:null,account:null};
let cancelled=false,offscreenCreating=null,currentDownload=null,lastPublish=0,accountBusy=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const desktopBridge=createDesktopBridge({native:(host,message)=>chrome.runtime.sendNativeMessage(host,message),storage:chrome.storage.session,session:()=>account.bridgeSession(),delay:sleep});
const sendInventory=()=>desktopBridge.publish(state.inventory);
let reconnecting=null;
const pairDesktop=()=>{
  if(!reconnecting)reconnecting=(async()=>{
    let paired=false;try{await desktopBridge.captureRequest();paired=true;}catch{}
    if(paired){await desktopBridge.publish(state.inventory);return {paired:true};}
    return desktopBridge.pair(()=>state.inventory);
  })().then(async result=>{await chrome.storage.local.set({desktopAutoConnect:true});return result;}).finally(()=>{reconnecting=null;});
  return reconnecting;
};
let lastReconnect=0;
async function reconnectDesktop() {
  if(reconnecting || accountBusy || Date.now()-lastReconnect<30000)return;
  const settings=await chrome.storage.local.get('desktopAutoConnect');
  if(!settings.desktopAutoConnect)return;
  lastReconnect=Date.now();
  try{await pairDesktop();}catch{ /* Desktop closed or session absent; retry later. */ }
}
let nativeCaptureBusy=false;
setInterval(async()=>{
  if(nativeCaptureBusy)return;
  nativeCaptureBusy=true;
  try {
    const request=await desktopBridge.captureRequest();
    if(state.busy || !state.inventory || !Array.isArray(request) || request.length<2)return;
    const [id,lessonId,kind,courseKey]=request;
    if(courseKey && courseKey!==state.inventory.key){await desktopBridge.captureResult(id,null,true,'course_changed');return;}
    const lesson=state.inventory.lessons.find((l,index)=>String(l.id||index)===lessonId);
    if(!lesson){await desktopBridge.captureResult(id,null,true,'lesson_not_found');return;}
    if(kind && !['video','video_no_subtitles','materials'].includes(kind)){await desktopBridge.captureResult(id,null,true,'unsupported_capture');return;}
    state.busy=true;state.stage='Capturando aula para o desktop…';cancelled=false;await publish();
    try {const captured=kind==='materials'?{url:JSON.stringify({count:await downloadMaterials(lesson,id)})}:kind==='video_no_subtitles'?await capture(lesson):await captureWithSubtitles(lesson);await desktopBridge.captureResult(id,captured.url);state.stage='Captura enviada. Acompanhe o download no desktop.';}
    catch(error){const message=safeError(error);const code=kind==='materials'?(message.includes('iniciou')?'material_not_started':message.includes('mudou')?'material_changed':message.includes('interrompido')?'material_interrupted':'material_failed'):null;await desktopBridge.captureResult(id,null,true,code);state.stage=message;state.error=message;}
    finally{state.busy=false;await publish();}
  } catch {void reconnectDesktop(); /* No playback URLs enter logs. */ }
  finally {nativeCaptureBusy=false;}
},2000).unref?.();
const boot=(async()=>{
  await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const saved=await chrome.storage.session.get('state');
  if(saved.state){state={...state,...saved.state,busy:false,operation:null};if(saved.state.busy)state.stage='A fila foi interrompida. Busque o curso e tente novamente.';}
  state.accountBusy=false;
  try{state.settings=normalizeSettings((await chrome.storage.local.get('settings')).settings);}catch{state.settings=normalizeSettings();}
  state.account=await account.status();
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[4101,4102],addRules:[
    {id:4101,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'referer',operation:'set',value:'https://whop.com/'}]},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['mux.com'],resourceTypes:['xmlhttprequest','other']}},
    {id:4102,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'referer',operation:'set',value:'https://cf-embed.play.hotmart.com/'}]},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['play.hotmart.com','contentplayer.hotmart.com'],resourceTypes:['xmlhttprequest','other']}},
  ]});
})();

async function publish(){state.version=(state.version||0)+1;const data=structuredClone(publicState(state));await chrome.storage.session.set({state:data});chrome.runtime.sendMessage({target:'panel',action:'state',state:data}).catch(()=>{});}
async function changeAccount(operation) {
  if(state.busy || accountBusy)throw new Error('Aguarde a operação atual terminar antes de trocar de conta.');
  accountBusy=true;state.accountBusy=true;
  try {await publish();state.account=await operation();return state.account;}
  finally {accountBusy=false;state.accountBusy=false;await publish();}
}
function log(text){state.logs.push(String(text));if(state.logs.length>60)state.logs.shift();}
function abortCheck(){if(cancelled)throw new DOMException('Cancelado','AbortError');}
function cleanUrl(raw){const url=new URL(raw);if(url.hostname==='dashboard.kiwify.com'){url.hash='';return url.href;}const club=url.hostname==='members.kiwify.com'?url.searchParams.get('club'):null;url.search='';url.hash='';if(club)url.searchParams.set('club',club);return url.href;}

async function inject(tabId,action,arg={},frameId=null) {
  const frames=frameId===null ? (await chrome.webNavigation.getAllFrames({tabId})).filter(f=>{
    try {const host=new URL(f.url).hostname;return host==='whop.com'||host.endsWith('.whop.com')||host==='hotmart.com'||(host==='members.kiwify.com'||host==='dashboard.kiwify.com')||host.endsWith('.play.hotmart.com');}catch{return false;}
  }).map(f=>f.frameId) : [frameId];
  if(!frames.length)return [];
  return chrome.scripting.executeScript({target:{tabId,frameIds:frames},func:collectPage,args:[action,arg],world:['downloadMaterial','materialChunk'].includes(action)?'MAIN':'ISOLATED'});
}

async function ensureOffscreen() {
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]})).length)return;
  if(!offscreenCreating)offscreenCreating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS','BLOBS'],justification:'Processar HLS e gerar MP4 localmente no Chrome, sem aplicativo externo.'}).finally(()=>{offscreenCreating=null;});
  await offscreenCreating;
}

function clearCourse() {
  state.inventory=null;state.contextKey=null;state.current=null;state.total=0;state.finished=0;state.results=[];state.logs=[];state.error=null;
}

async function activeTab(tabId) {
  const tab=Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.active)throw new Error('Selecione a aba do curso.');
  return tab;
}

async function syncTab(tabId) {
  const tab=await activeTab(tabId);
  if(state.busy)return;
  let scope;
  try{scope=courseScope(tab.url);}catch{clearCourse();state.stage='Abra um curso da Hotmart, Whop ou Kiwify nesta aba.';await publish();return;}
  let previousTrack=null;try{previousTrack=courseScope(state.inventory?.original_url).trackId||null;}catch{}
  if(state.inventory?.key===scope.key && !(scope.platform==='hotmart' && scope.trackId && (!state.inventory.totalTracks||state.inventory.trackDiscoveryIncomplete) && scope.trackId!==previousTrack)) {
    state.inventory={...state.inventory,tabId:tab.id,original_url:cleanUrl(tab.url)};
    state.contextKey=scope.key;await sendInventory().catch(()=>reconnectDesktop());await publish();return;
  }
  await scan(tab.id);
}

async function scan(tabId) {
  if(state.busy)throw new Error('Pare a fila antes de buscar outro curso.');
  const tab=await activeTab(tabId);
  if(state.busy)throw new Error('Já existe uma operação em andamento.');
  if(!tab?.url)throw new Error('Selecione a aba do curso.');
  const scope=courseScope(tab.url), original=tab.url;
  clearCourse();state.contextKey=scope.key;state.operation={kind:'scan',key:scope.key,tabId:tab.id};
  cancelled=false;state.busy=true;state.stage='Buscando as aulas…';await publish();
  try {
    let expected=null, courseTitle=null, found=null;
    const trackInventory=scope.platform==='hotmart'?await collectHotmartTracks(scope,{tabs:chrome.tabs,inject,sleep,cleanUrl}):null;
    if(trackInventory?.lessons.length){found={frameId:0,result:{platform:'hotmart',...trackInventory}};courseTitle=trackInventory.courseTitle;}
    for(let attempt=0;!found && attempt<20;attempt++) {
      abortCheck();
      if(!sameCourse((await chrome.tabs.get(tab.id)).url,original))throw new Error('A aba mudou de curso durante a busca.');
      let results;
      try{results=await readCoursePage(()=>inject(tab.id,'prepare',{deadline:Date.now()+14000}));}
      catch(error){if(/frame.*removed|frame.*not found|no frame|document.*unloaded|cannot access contents/i.test(String(error.message))){await sleep(500);continue;}throw error;}
      abortCheck();
      courseTitle ||= results.find(r=>r.result?.courseTitle && !r.result?.lessons)?.result.courseTitle||null;
      const navigation=results.find(r=>r.result?.navigating)?.result;
      if(navigation){expected=navigation.expectedCount;courseTitle=navigation.courseTitle;await sleep(700);continue;}
      found=results.find(r=>r.result?.lessons?.length && r.result.platform===scope.platform);
      if(found)break;
      await sleep(500);
    }
    if(!found)throw new Error('Lista de aulas não encontrada. Abra uma aula de vídeo no curso e tente novamente.');
    if(!sameCourse((await chrome.tabs.get(tab.id)).url,original))throw new Error('A aba mudou de curso durante a busca.');
    const lessons=found.result.lessons.map(x=>({...x,page_url:scope.platform==='hotmart'?cleanUrl(x.page_url):cleanUrl((scope.platform==='whop'?tab.url:x.page_url))}));
    if(expected && lessons.length!==expected)throw new Error(`A lista está incompleta: ${lessons.length} aulas, esperado ${expected}.`);
    if(scope.platform!=='whop' && lessons.some(x=>!sameCourse(x.page_url,original)))throw new Error('A lista contém links de outro curso.');
    state.inventory={...scope,tabId:tab.id,ownerFrameId:found.frameId,title:courseTitle || found.result.courseTitle || scope.slug,page_url:cleanUrl(original),original_url:cleanUrl(original),lessons,failedTracks:trackInventory?.failedTracks||[],totalTracks:trackInventory?.totalTracks||0,trackDiscoveryIncomplete:!!(trackInventory?.failedTracks?.length || scope.platform==='hotmart' && scope.trackId && !trackInventory)};
    await sendInventory().catch(()=>reconnectDesktop());
    state.stage=state.inventory.trackDiscoveryIncomplete?`${lessons.length} aulas encontradas; algumas trilhas não puderam ser carregadas.`:`${lessons.length} aulas encontradas.`;log(state.stage);
  } catch(error){if(error.diagnostic)await desktopBridge.reportDiagnostic(error.diagnostic).catch(()=>{});state.error=cancelled?null:safeError(error);state.stage=cancelled?'Busca cancelada. Atualize as aulas para tentar novamente.':state.error;throw error;}
  finally {state.busy=false;state.operation=null;await publish();}
}

async function openLesson(item) {
  const inventory=state.inventory,tab=await chrome.tabs.get(inventory.tabId);
  if(!sameCourse(tab.url,inventory.page_url))throw new Error('A aba mudou de curso. Busque as aulas novamente.');
  if(inventory.platform==='kiwify' && new URL(inventory.page_url).hostname==='dashboard.kiwify.com'){const opened=await inject(inventory.tabId,'openKiwify',item);if(!opened.some(x=>x.result?.opened))throw new Error('Não foi possível abrir esta aula da Kiwify.');}
  else if(inventory.platform!=='whop')await chrome.tabs.update(inventory.tabId,{url:item.page_url});
  else {
    const opened=await inject(inventory.tabId,'openWhop',item);
    if(!opened.some(x=>x.result?.opened))throw new Error('Não foi encontrado o botão desta aula.');
  }
  await sleep(700);
}
async function capture(item) {
  await openLesson(item);
  const inventory=state.inventory;
  let lastError=null;
  for(let attempt=0;attempt<80;attempt++) {
    abortCheck();
    try {
      const results=await inject(inventory.tabId,'capture',item);
      const blocked=results.find(r=>r.result?.protected || r.result?.unsupported)?.result;
      if(blocked){const error=new Error(blocked.reason);error.protectedVideo=!!blocked.protected;error.unsupported=!!blocked.unsupported;throw error;}
      const found=results.find(r=>r.result?.url && r.result.platform===inventory.platform);
      if(found)return {...item,...found.result,platform:inventory.platform,page_url:found.result.page_url || item.page_url};
    } catch(error){if(error.protectedVideo||error.unsupported)throw error;lastError=error;}
    await sleep(250);
  }
  throw new Error(lastError ? safeError(lastError) : 'O player não carregou a aula esperada.');
}

async function captureWithSubtitles(lesson) {
  const captured=await capture(lesson);
  let captions={files:[],warnings:[],available:0};
  try{captions=await downloadSubtitles(captured,{...state.settings,subtitleFormat:state.settings.subtitleFormat||'srt'},AbortSignal.timeout(45000));}catch(error){captions.warnings=[error.name==='TimeoutError'?'Tempo esgotado ao capturar a legenda. Tente novamente.':safeError(error)];}
  const files=captions.files.filter(file=>new TextEncoder().encode(file.text).length<=350000);
  const payload={url:captured.url,subtitles:files,subtitleWarning:captions.warnings.length>0||files.length!==captions.files.length,subtitleMessage:captions.warnings.map(safeError).join(" ").slice(0,1000),subtitleAvailable:captions.available};
  if(new TextEncoder().encode(JSON.stringify(payload)).length>450000){payload.subtitles=[];payload.subtitleWarning=true;}
  return {url:JSON.stringify(payload)};
}
async function downloadMaterials(item,captureId) {
  await openLesson(item);
  let found=null;
  for(let attempt=0;attempt<20;attempt++) {
    const results=await inject(state.inventory.tabId,'materials',item);
    found=results.find(x=>x.result?.materials)?.result.materials;
    if(found?.length)break;
    await sleep(500);
  }
  let count=0;
  for(const material of found||[]) {
    abortCheck();
    if(await desktopBridge.materialExists(String(item.id),material.name)){count++;continue;}
    const clicks=await inject(state.inventory.tabId,'downloadMaterial',{...item,materialIndex:material.index,name:material.name});
    const capturedMaterial=clicks.find(x=>x.result?.downloadUrl);
    const url=capturedMaterial?.result.downloadUrl;
    if(!url)throw new Error('A plataforma não forneceu o arquivo do material.');
    const status=await desktopBridge.materialWrite('material_begin',captureId,{materialName:material.name});
    if(status==='material_skipped'){count++;continue;}
    let offset=0;
    const send=async bytes=>{for(let i=0;i<bytes.length;i+=32768){if(!await desktopBridge.captureRequest())throw new Error('Cancelado');const data=Array.from(bytes.subarray(i,i+32768));await desktopBridge.materialWrite('material_chunk',captureId,{offset,data});offset+=data.length;}};
    if(url.startsWith('blob:')||url.startsWith('data:')) {
      while(true){
        const results=await inject(state.inventory.tabId,'materialChunk',{url,offset},capturedMaterial.frameId);
        const chunk=results.find(r=>r.result?.data)?.result;
        if(!chunk)throw new Error('Não foi possível ler o arquivo entregue pela plataforma.');
        await send(new Uint8Array(chunk.data));if(chunk.done)break;
      }
    } else {
      const response=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(600000)});
      if(!response.ok||!response.body)throw new Error('A plataforma recusou o arquivo do material.');
      const reader=response.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;await send(value);}}finally{await reader.cancel().catch(()=>{});}
    }
    await desktopBridge.materialWrite('material_end',captureId,{size:offset});count++;
  }
  return count;
}

async function waitDownload(id) {
  const [initial]=await chrome.downloads.search({id});if(initial?.state==='complete')return;
  return new Promise((resolve,reject)=>{
    const listener=delta=>{if(delta.id!==id)return;if(delta.state?.current==='complete'){cleanup();resolve();}if(delta.state?.current==='interrupted'){cleanup();reject(new Error('O Chrome interrompeu o salvamento do arquivo.'));}};
    const timer=setTimeout(()=>{cleanup();reject(new Error('O Chrome não confirmou o salvamento do MP4.'));},120000);
    function cleanup(){clearTimeout(timer);chrome.downloads.onChanged.removeListener(listener);}
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({id}).then(([entry])=>{if(entry?.state==='complete'){cleanup();resolve();}if(entry?.state==='interrupted'){cleanup();reject(new Error('O salvamento foi interrompido.'));}});
  });
}

async function saveSubtitles(captions,inventory,item,settings,key) {
  if(!captions)return {count:0,warnings:[]};
  const warnings=[...captions.warnings];let count=0;
  for(const file of captions.files) {
    abortCheck();
    const filename=subtitleFilename(inventory,item,settings.downloadFolder,file);
    const completed=(await chrome.storage.local.get('completed')).completed||{};
    const old=completed[key]?.subtitles?.[filename];
    if(old!==undefined) {
      const [entry]=await chrome.downloads.search({id:old});
      if(entry?.state==='complete'&&entry.exists){count++;continue;}
    }
    try {
      const id=await chrome.downloads.download({url:file.blobUrl,filename,saveAs:false,conflictAction:'uniquify'});
      currentDownload=id;await waitDownload(id);currentDownload=null;abortCheck();
      const fresh=(await chrome.storage.local.get('completed')).completed||{};
      fresh[key]={...fresh[key],title:item.title,subtitles:{...fresh[key]?.subtitles,[filename]:id}};
      await chrome.storage.local.set({completed:fresh});count++;
    }catch(error){currentDownload=null;abortCheck();warnings.push(`Não foi possível salvar uma legenda: ${safeError(error)}`);}
  }
  return {count,warnings};
}

async function run(mode,ids,quality='auto',tabId=null,courseKey=null,includeSubtitles=false) {
  if(state.busy)throw new Error('Já existe uma operação em andamento.');
  if(!['download','validate','subtitles'].includes(mode))throw new Error('Operação inválida.');
  const selected=validateSelection(state.inventory,ids,mode),inventory=state.inventory;
  if(mode==='subtitles'&&inventory.platform!=='whop')throw new Error('O download de legendas está disponível para a Whop.');
  if(courseKey!==inventory.key||tabId!==inventory.tabId)throw new Error('O curso mudou. Aguarde a atualização da lista.');
  const settings={...state.settings};
  const withSubtitles=includeSubtitles===true&&inventory.platform==='whop';
  state.busy=true;state.error=null;state.total=selected.length;state.finished=0;state.results=[];cancelled=false;
  state.operation={kind:mode,key:inventory.key,tabId:inventory.tabId};
  let managed=null;
  await publish();
  try {
    await account.authorize(selected.length);
    const tab=await activeTab(tabId);
    if(!sameCourse(tab.url,inventory.page_url))throw new Error('A aba mudou de curso. Aguarde a atualização da lista.');
    await ensureOffscreen();
    for(const item of selected) {
      await account.authorize(1);
      abortCheck();state.current=item.title;state.stage='Abrindo a aula';await publish();
      const key=`${inventory.key}:${item.id}`, stored=await chrome.storage.local.get('completed');
      const previous=stored.completed?.[key];
      let videoSaved=false;
      if(mode==='download' && previous?.downloadId!==undefined) {
        const [entry]=await chrome.downloads.search({id:previous.downloadId});
        videoSaved=entry?.state==='complete'&&entry.exists;
        if(videoSaved&&!withSubtitles){state.results.push({title:item.title,status:'saved'});state.finished++;log(`Já salva: ${item.title}`);await publish();continue;}
      }
      const jobId=crypto.randomUUID();
      try {
        let result,lesson;
        for(let attempt=0;attempt<2;attempt++) {
          lesson=await capture(item);managed=(await chrome.tabs.get(inventory.tabId)).url;abortCheck();
          result=await chrome.runtime.sendMessage({target:'offscreen',action:'process',mode:videoSaved?'subtitles':mode,jobId,lesson,quality:settings.videoQuality,settings,includeSubtitles:withSubtitles});
          if(result.ok)break;
          if(result.cancelled||cancelled)throw new DOMException('Cancelado','AbortError');
          if(result.protectedVideo || ![401,403].includes(result.status) || attempt===1){const error=new Error(result.error);error.protectedVideo=!!result.protectedVideo;throw error;}
          log('Atualizando a URL de reprodução…');
          if(inventory.platform==='whop'){await chrome.tabs.reload(inventory.tabId);await sleep(1000);}
        }
        abortCheck();
        if(mode==='download'&&!videoSaved) {
          state.stage='Salvando MP4';await publish();
          const downloadId=await chrome.downloads.download({url:result.result.blobUrl,filename:downloadFilename(inventory,item,settings.downloadFolder),saveAs:false,conflictAction:'uniquify'});
          currentDownload=downloadId;await waitDownload(downloadId);currentDownload=null;
          const completed=(await chrome.storage.local.get('completed')).completed || {};
          completed[key]={...completed[key],downloadId,title:item.title};await chrome.storage.local.set({completed});
          log(`MP4 salvo: ${item.title}`);
        }
        if(mode==='validate') {state.results.push({title:item.title,status:'validated',height:result.result.height});log(`Validada: ${item.title} — ${result.result.height || 'qualidade original'}p`);}
        else {
          const captions=result.result.subtitles;
          const saved=await saveSubtitles(captions,inventory,item,settings,key);
          saved.warnings.forEach(w=>log(safeError(w)));
          const status=mode==='subtitles'?(saved.warnings.length?'partial':saved.count?'subtitles':'noSubtitles'):videoSaved?'saved':'done';
          const reason=saved.warnings.length?'Uma ou mais legendas falharam; consulte os detalhes.':captions&&!captions.available?'Nenhuma legenda disponível nos idiomas escolhidos.':null;
          state.results.push({title:item.title,status,height:result.result.height,subtitleCount:saved.count,warning:!!saved.warnings.length,reason});
          if(captions)log(`${item.title}: ${saved.count} arquivo(s) de legenda disponível(is) na pasta de destino.`);
        }
      } catch(error) {
        if(cancelled||error.name==='AbortError')throw error;
        state.results.push({title:item.title,status:error.protectedVideo?'protected':'failed',reason:safeError(error)});log(`${item.title}: ${safeError(error)}`);
      } finally {await chrome.runtime.sendMessage({target:'offscreen',action:'release',jobId}).catch(()=>{});}
      state.finished++;await publish();
    }
    const failed=state.results.filter(x=>['failed','protected','partial'].includes(x.status)||x.warning).length;
    state.stage=failed ? `Concluído com avisos em ${failed} aula(s). Consulte os detalhes.` : mode==='validate'?'Validação concluída. Nenhum vídeo foi baixado.':mode==='subtitles'?'Legendas concluídas. Nenhum vídeo foi baixado.':'Downloads concluídos.';
  } catch(error) {state.stage=cancelled?'Fila interrompida.':safeError(error);if(!cancelled)state.error=safeError(error);}
  finally {
    if(managed){try{const tab=await chrome.tabs.get(inventory.tabId);if(tab.url===managed && sameCourse(tab.url,inventory.original_url))await chrome.tabs.update(inventory.tabId,{url:inventory.original_url});}catch{}}
    state.busy=false;state.operation=null;state.current=null;currentDownload=null;await publish();
  }
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || message.target!=='background')return false;
  const isPanel=sender.url===chrome.runtime.getURL('sidepanel.html');
  const isEngine=sender.url===chrome.runtime.getURL('offscreen.html');
  if(!isPanel && !(isEngine && message.action==='progress'))return false;
  (async()=>{
    await boot;
    if(message.action==='state')return publicState(state);
    if(message.action==='pairDesktop')return pairDesktop();
    if(message.action==='desktopStatus'){
      const request=helloRequest(crypto.randomUUID());
      const status=parseHello(await chrome.runtime.sendNativeMessage(NATIVE_HOST,request),request.requestId);
      let paired=false;
      if(status.connected){try{await desktopBridge.captureRequest();paired=true;}catch{ /* Host is reachable but no valid pairing is present. */ }}
      return {...status,paired};
    }
    if(message.action==='signIn'){
      return changeAccount(()=>account.signIn(message.email,message.password));
    }
    if(message.action==='signInGoogle')return changeAccount(()=>account.signInGoogle());
    if(message.action==='signOut'){
      return changeAccount(async()=>{await account.signOut();await chrome.storage.session.remove('nativePairToken');return account.status();});
    }
    if(message.action==='refreshAccount'){if(accountBusy)throw new Error('Aguarde o login terminar.');state.account=await account.status();await publish();return state.account;}
    if(message.action==='progress') {
      if(state.busy){state.stage=message.stage+(Number.isFinite(message.percent)?` — ${message.percent}%`:'');if(Date.now()-lastPublish>500){lastPublish=Date.now();await publish();}}
      return {};
    }
    if(message.action==='syncTab'){await syncTab(message.tabId);return publicState(state);}
    if(message.action==='scan'){await scan(message.tabId);return publicState(state);}
    if(message.action==='settings') {
      if(state.busy)throw new Error('Aguarde a operação terminar antes de alterar as configurações.');
      const settings=normalizeSettings(message.settings);
      await chrome.storage.local.set({settings});state.settings=settings;await publish();return settings;
    }
    if(message.action==='run'){if(accountBusy)throw new Error('Aguarde o login terminar.');run(message.mode,message.ids,null,message.tabId,message.courseKey,message.includeSubtitles).catch(async error=>{state.error=safeError(error);await publish();});return {};}
    if(message.action==='cancel'){cancelled=true;state.stage='Parando…';await chrome.runtime.sendMessage({target:'offscreen',action:'cancel'}).catch(()=>{});if(currentDownload!==null)await chrome.downloads.cancel(currentDownload).catch(()=>{});await publish();return {};}
    if(message.action==='showDownloads'){await chrome.downloads.showDefaultFolder();return {};}
    throw new Error('Comando desconhecido.');
  })().then(result=>respond({ok:true,result}),error=>respond({ok:false,error:safeError(error)}));
  return true;
});

const discovery=autoDiscovery({tab:id=>chrome.tabs.get(id),scan:syncTab,busy:()=>state.busy||accountBusy,ready:boot});
chrome.tabs.onActivated?.addListener(({tabId})=>discovery.notify(tabId));
chrome.tabs.onUpdated?.addListener((tabId,change)=>{if(change.status==='complete'||change.url)discovery.notify(tabId);});
chrome.webNavigation.onHistoryStateUpdated?.addListener(({tabId,frameId})=>{if(frameId===0)discovery.notify(tabId);});
chrome.webNavigation.onCompleted?.addListener(({tabId,frameId})=>{if(frameId===0)discovery.notify(tabId);});
async function discoverCurrentTab() {
  try{await boot;const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(tab)discovery.notify(tab.id);}catch{}
}
chrome.runtime.onStartup?.addListener(()=>{void discoverCurrentTab();});
chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='vodown-discovery')void discoverCurrentTab();});
void chrome.alarms?.create('vodown-discovery',{periodInMinutes:1});
void discoverCurrentTab();
