import {collectPage} from './lib/collector.js';
import {downloadFilename,subtitleFilename} from './lib/downloads.js';
import {courseScope,sameCourse,safeError,publicState,validateSelection} from './lib/model.js';
import {normalizeSettings} from './lib/settings.js';

let state={inventory:null,busy:false,stage:'Abra um curso da Hotmart, Whop ou Kiwify.',current:null,total:0,finished:0,results:[],logs:[],error:null,engine:true,settings:normalizeSettings(),operation:null,contextKey:null};
let cancelled=false,offscreenCreating=null,currentDownload=null,lastPublish=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const boot=(async()=>{
  const saved=await chrome.storage.session.get('state');
  if(saved.state){state={...state,...saved.state,busy:false,operation:null};if(saved.state.busy)state.stage='A fila foi interrompida. Busque o curso e tente novamente.';}
  try{state.settings=normalizeSettings((await chrome.storage.local.get('settings')).settings);}catch{state.settings=normalizeSettings();}
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[4101,4102],addRules:[
    {id:4101,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'referer',operation:'set',value:'https://whop.com/'}]},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['mux.com'],resourceTypes:['xmlhttprequest','other']}},
    {id:4102,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'referer',operation:'set',value:'https://cf-embed.play.hotmart.com/'}]},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['play.hotmart.com','contentplayer.hotmart.com'],resourceTypes:['xmlhttprequest','other']}},
  ]});
})();

async function publish(){state.version=(state.version||0)+1;const data=structuredClone(publicState(state));await chrome.storage.session.set({state:data});chrome.runtime.sendMessage({target:'panel',action:'state',state:data}).catch(()=>{});}
function log(text){state.logs.push(String(text));if(state.logs.length>60)state.logs.shift();}
function abortCheck(){if(cancelled)throw new DOMException('Cancelado','AbortError');}
function cleanUrl(raw){const url=new URL(raw);const club=url.hostname==='members.kiwify.com'?url.searchParams.get('club'):null;url.search='';url.hash='';if(club)url.searchParams.set('club',club);return url.href;}

async function inject(tabId,action,arg={},frameId=null) {
  const frames=frameId===null ? (await chrome.webNavigation.getAllFrames({tabId})).filter(f=>{
    try {const host=new URL(f.url).hostname;return host==='whop.com'||host.endsWith('.whop.com')||host==='hotmart.com'||host==='members.kiwify.com'||host.endsWith('.play.hotmart.com');}catch{return false;}
  }).map(f=>f.frameId) : [frameId];
  if(!frames.length)return [];
  return chrome.scripting.executeScript({target:{tabId,frameIds:frames},func:collectPage,args:[action,arg]});
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
  if(state.inventory?.key===scope.key) {
    state.inventory={...state.inventory,tabId:tab.id,original_url:cleanUrl(tab.url)};
    state.contextKey=scope.key;await publish();return;
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
  state.busy=true;state.stage='Buscando as aulas…';await publish();
  try {
    let expected=null, courseTitle=null, found=null;
    for(let attempt=0;attempt<20;attempt++) {
      if(!sameCourse((await chrome.tabs.get(tab.id)).url,original))throw new Error('A aba mudou de curso durante a busca.');
      const results=await inject(tab.id,'prepare');
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
    state.inventory={...scope,tabId:tab.id,ownerFrameId:found.frameId,title:courseTitle || found.result.courseTitle || scope.slug,page_url:cleanUrl(original),original_url:cleanUrl(original),lessons};
    state.stage=`${lessons.length} aulas encontradas.`;log(state.stage);
  } catch(error){state.error=safeError(error);state.stage=state.error;throw error;}
  finally {state.busy=false;state.operation=null;await publish();}
}

async function capture(item) {
  const inventory=state.inventory,tab=await chrome.tabs.get(inventory.tabId);
  if(!sameCourse(tab.url,inventory.page_url))throw new Error('A aba mudou de curso. Busque as aulas novamente.');
  if(inventory.platform!=='whop')await chrome.tabs.update(inventory.tabId,{url:item.page_url});
  else {
    const opened=await inject(inventory.tabId,'openWhop',item);
    if(!opened.some(x=>x.result?.opened))throw new Error('Não foi encontrado o botão desta aula.');
  }
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
    const tab=await activeTab(tabId);
    if(!sameCourse(tab.url,inventory.page_url))throw new Error('A aba mudou de curso. Aguarde a atualização da lista.');
    await ensureOffscreen();
    for(const item of selected) {
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
    if(message.action==='run'){run(message.mode,message.ids,null,message.tabId,message.courseKey,message.includeSubtitles).catch(async error=>{state.error=safeError(error);await publish();});return {};}
    if(message.action==='cancel'){cancelled=true;state.stage='Parando…';await chrome.runtime.sendMessage({target:'offscreen',action:'cancel'}).catch(()=>{});if(currentDownload!==null)await chrome.downloads.cancel(currentDownload).catch(()=>{});await publish();return {};}
    if(message.action==='showDownloads'){await chrome.downloads.showDefaultFolder();return {};}
    throw new Error('Comando desconhecido.');
  })().then(result=>respond({ok:true,result}),error=>respond({ok:false,error:safeError(error)}));
  return true;
});
