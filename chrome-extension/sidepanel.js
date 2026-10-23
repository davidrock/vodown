import {courseScope,safeError,stateForCourse} from './lib/model.js';
import {DEFAULT_DOWNLOAD_FOLDER,DEFAULT_MAX_INPUT_MIB,DEFAULT_VIDEO_QUALITY,MAX_MAX_INPUT_MIB,MIN_MAX_INPUT_MIB,normalizeSettings} from './lib/settings.js';

const el=id=>document.getElementById(id);
let selected=new Set(), inventoryKey=null, rawState=null, currentState=null;
let context={tabId:null,scope:null,checking:true};
let requesting=false, revision=0, lastAttempt=null, syncTimer=null, settingsDirty=false;

async function send(action,data={}) {
  const response=await chrome.runtime.sendMessage({target:'background',action,...data});
  if(!response?.ok)throw new Error(response?.error||'A extensão não respondeu.');
  return response.result;
}

function acceptState(state) {
  if(rawState&&(state.version||0)<(rawState.version||0))return;
  rawState=state;render();maybeSync();
}

function showSettings(open) {
  el('main-screen').hidden=open;
  el('settings-screen').hidden=!open;
  el('open-settings').hidden=open;
  if(open) {
    el('settings-feedback').textContent='';
    el('settings-feedback').classList.remove('error');
    writeSettings(currentState?.settings||rawState?.settings);
    settingsDirty=false;
  }
}

function writeSettings(settings={}) {
  if(document.activeElement!==el('quality'))el('quality').value=settings.videoQuality||DEFAULT_VIDEO_QUALITY;
  if(document.activeElement!==el('max-input'))el('max-input').value=settings.maxInputMiB||DEFAULT_MAX_INPUT_MIB;
  if(document.activeElement!==el('download-folder'))el('download-folder').value=settings.downloadFolder||DEFAULT_DOWNLOAD_FOLDER;
  el('subtitle-format').value=settings.subtitleFormat||'srt';
  const language=settings.subtitleLanguage||'original';
  if(![...el('subtitle-language').options].some(o=>o.value===language))el('subtitle-language').add(new Option(`Idioma (${language})`,language));
  el('subtitle-language').value=language;
}

function disable() {
  const busy=requesting||rawState?.busy;
  el('scan').disabled=!!busy||context.checking||!context.scope;
  for(const id of ['validate','download','subtitles'])el(id).disabled=!!busy||!currentState?.inventory||!selected.size;
  el('subtitles').hidden=currentState?.inventory?.platform!=='whop';
  el('include-subtitles-row').hidden=currentState?.inventory?.platform!=='whop';
  el('include-subtitles').disabled=!!busy;
  for(const id of ['quality','max-input','download-folder','subtitle-format','subtitle-language','save-settings'])el(id).disabled=!!busy;
  el('open-settings').disabled=!!busy;
  el('select-all').disabled=!!busy;
  el('lessons').querySelectorAll('input').forEach(input=>input.disabled=!!busy);
  el('stop').hidden=!rawState?.busy||rawState.operation?.kind==='scan';
}

function selection() {
  const count=selected.size;
  el('selected-count').textContent=`${count} selecionada${count===1?'':'s'}`;
  el('download').textContent=`Baixar selecionadas${count?` (${count})`:''}`;
  el('select-all').checked=count>0&&count===currentState?.inventory?.lessons?.length;
  el('select-all').indeterminate=count>0&&count!==currentState?.inventory?.lessons?.length;
  disable();
}

function render() {
  if(!rawState)return;
  const state=stateForCourse(rawState,context.checking?null:context.scope);
  currentState=state;
  el('error').hidden=!state.error;
  el('error').textContent=state.error||'';
  el('tab-context').textContent=context.checking?'Conferindo a aba atual…':context.scope?`Curso detectado na ${context.scope.platform==='hotmart'?'Hotmart':context.scope.platform==='kiwify'?'Kiwify':'Whop'}. A lista acompanha esta aba.`:'Abra um curso da Hotmart, Whop ou Kiwify na aba atual.';
  el('stage').textContent=context.checking?'Conferindo a aba atual…':state.stage;
  el('current').hidden=!state.current;
  el('current').textContent=state.current||'';
  el('progress').value=state.total?Math.round(state.finished/state.total*100):0;
  const inventory=state.inventory;
  el('course').hidden=!inventory;
  const key=inventory?`${inventory.key}:${inventory.lessons.map(x=>x.id).join(',')}`:null;
  if(key!==inventoryKey) {
    inventoryKey=key;
    el('include-subtitles').checked=false;
    selected=new Set(inventory?.lessons.slice(0,1).map(x=>x.id)||[]);
    el('lessons').replaceChildren();
    if(inventory) {
      el('platform').textContent=inventory.platform.toUpperCase();
      el('course-title').textContent=inventory.title;
      el('count').textContent=`${inventory.lessons.length} aulas`;
      for(const item of inventory.lessons) {
        const label=document.createElement('label');label.className='lesson';
        const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(item.id);
        input.setAttribute('aria-label',`Selecionar ${item.title}`);
        input.addEventListener('change',()=>{input.checked?selected.add(item.id):selected.delete(item.id);selection();});
        const text=document.createElement('div');
        const name=document.createElement('div');name.className='lesson-title';name.textContent=item.title;
        const module=document.createElement('div');module.className='lesson-module';module.textContent=item.module;
        const number=document.createElement('span');number.className='lesson-number';number.textContent=String(item.index).padStart(2,'0');
        text.append(name,module);label.append(input,text,number);el('lessons').append(label);
      }
    }
  }
  // Keep the form draft intact while background state updates arrive.
  el('results').replaceChildren();
  const names={done:'Salva',saved:'Vídeo já salvo',validated:'Validada',failed:'Falhou',protected:'Protegida',subtitles:'Legendas salvas',noSubtitles:'Sem legendas',partial:'Legendas com avisos'};
  for(const item of state.results||[]) {
    const p=document.createElement('div');p.className=`result ${item.status}`;
    p.textContent=`${names[item.status]||item.status} · ${item.title}${item.height?` · ${item.height}p`:''}${item.subtitleCount?` · ${item.subtitleCount} arquivo(s) de legenda`:''}${item.reason?` — ${item.reason}`:''}`;
    el('results').append(p);
  }
  el('logs').replaceChildren();
  for(const line of state.logs||[]) {const li=document.createElement('li');li.textContent=line;el('logs').append(li);}
  selection();
}

function showError(error) {el('error').hidden=false;el('error').textContent=safeError(error);}
function showSettingsError(error) {
  el('settings-feedback').textContent=safeError(error);
  el('settings-feedback').classList.add('error');
}
async function action(callback,errorHandler=showError) {
  requesting=true;disable();
  try{await callback();}catch(error){errorHandler(error);}
  finally{requesting=false;disable();}
}

function maybeSync() {
  if(!rawState||rawState.busy||context.checking||context.tabId===null)return;
  if(context.scope&&rawState.inventory?.key===context.scope.key&&rawState.inventory.tabId===context.tabId)return;
  const token=`${context.tabId}:${context.scope?.key||'unsupported'}`;
  if(lastAttempt===token)return;
  lastAttempt=token;
  const expectedRevision=revision;
  send('syncTab',{tabId:context.tabId}).then(state=>{
    acceptState(state);
    if(expectedRevision!==revision)maybeSync();
  }).catch(error=>{if(expectedRevision===revision)showError(error);});
}

async function refreshContext() {
  const expectedRevision=++revision;
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(expectedRevision!==revision)return;
    let scope=null;
    try{scope=courseScope(tab?.pendingUrl||tab?.url);}catch{}
    context={tabId:tab?.id??null,scope,checking:false};
    render();maybeSync();
  }catch(error){if(expectedRevision===revision){context={tabId:null,scope:null,checking:false};render();showError(error);}}
}

function scheduleContext(hide=false) {
  if(hide){revision++;context={...context,checking:true};render();}
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>refreshContext(),100);
}

el('scan').addEventListener('click',()=>action(async()=>{
  await refreshContext();
  if(!context.scope)throw new Error('Selecione a aba do curso.');
  acceptState(await send('scan',{tabId:context.tabId}));
}));
el('open-settings').addEventListener('click',()=>showSettings(true));
el('close-settings').addEventListener('click',()=>action(async()=>{
  if(settingsDirty)await savePreferences();
  showSettings(false);
},showSettingsError));
el('max-input').min=MIN_MAX_INPUT_MIB;el('max-input').max=MAX_MAX_INPUT_MIB;
for(const input of el('settings-screen').querySelectorAll('input,select')) {
  input.addEventListener('input',()=>{settingsDirty=true;});
  input.addEventListener('change',()=>{settingsDirty=true;});
}
async function savePreferences() {
  const settings=normalizeSettings({
    videoQuality:el('quality').value,
    maxInputMiB:el('max-input').value,
    downloadFolder:el('download-folder').value,
    subtitleFormat:el('subtitle-format').value,
    subtitleLanguage:el('subtitle-language').value,
  });
  await send('settings',{settings});
  el('settings-feedback').classList.remove('error');
  el('settings-feedback').textContent='Configurações salvas.';
  settingsDirty=false;
}
el('save-settings').addEventListener('click',()=>action(savePreferences,showSettingsError));
el('select-all').addEventListener('change',()=>{
  selected=new Set(el('select-all').checked?currentState.inventory.lessons.map(x=>x.id):[]);
  el('lessons').querySelectorAll('input').forEach(input=>input.checked=el('select-all').checked);
  selection();
});
for(const mode of ['validate','download','subtitles'])el(mode).addEventListener('click',()=>action(()=>send('run',{
  mode,ids:[...selected],tabId:context.tabId,courseKey:context.scope?.key,includeSubtitles:el('include-subtitles').checked,
})));
el('stop').addEventListener('click',()=>action(()=>send('cancel')));
el('folder').addEventListener('click',()=>action(()=>send('showDownloads')));
chrome.runtime.onMessage.addListener(message=>{
  if(message.target==='panel'&&message.action==='state')acceptState(message.state);
});
chrome.tabs.onActivated.addListener(()=>scheduleContext(true));
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(tabId!==context.tabId||(!change.url&&!change.status))return;
  let changedCourse=false;
  if(change.url){try{changedCourse=courseScope(change.url).key!==context.scope?.key;}catch{changedCourse=true;}}
  if(change.status==='loading'&&!rawState?.busy)lastAttempt=null;
  scheduleContext(changedCourse);
});
chrome.tabs.onRemoved.addListener(tabId=>{if(tabId===context.tabId)scheduleContext(true);});
window.addEventListener('focus',()=>scheduleContext());
action(async()=>{acceptState(await send('state'));await refreshContext();});
