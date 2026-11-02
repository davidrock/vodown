import {NATIVE_HOST} from './native-protocol.js';
export function createDesktopBridge({native,storage,session,delay,random=()=>crypto.randomUUID()}) {
  async function post(type,data) {
    const requestId=random();
    const response=await native(NATIVE_HOST,{version:1,requestId,type,...data});
    if(!response || response.version!==1 || response.requestId!==requestId || response.type!==type)throw new Error('Resposta do desktop incompatível.');
    return response;
  }
  async function publish(inventory) {
    const {nativePairToken}=await storage.get('nativePairToken');
    if(!inventory)return;
    if(!nativePairToken)throw new Error('Reconexão necessária.');
    const response=await post('inventory',{pairToken:nativePairToken,inventory:{capabilities:['video','materials','subtitles'],courseKey:inventory.key||inventory.title,title:inventory.title,platform:inventory.platform,trackDiscoveryIncomplete:!!inventory.trackDiscoveryIncomplete,failedTracks:inventory.failedTracks||[],totalTracks:inventory.totalTracks||0,lessons:inventory.lessons.map((lesson,index)=>({id:String(lesson.id||index),title:String(lesson.title||lesson.name||`Aula ${index+1}`),module:String(lesson.module||'Aulas'),moduleIndex:Number(lesson.module_index)||1,index:Number(lesson.index)||index+1,trackId:String(lesson.track_id||''),trackTitle:String(lesson.track_title||''),trackIndex:Number(lesson.track_index)||0}))}});
    if(response.code!=='inventory_received')throw new Error('Reconecte o desktop para enviar as aulas.');
  }
  return {publish,async reportDiagnostic(diagnostic){const {nativePairToken}=await storage.get('nativePairToken');if(nativePairToken&&diagnostic)await post('reading_diagnostic',{pairToken:nativePairToken,diagnostic});},async materialWrite(type,captureId,data) {
    const {nativePairToken}=await storage.get('nativePairToken');
    const response=await post(type,{pairToken:nativePairToken,captureId,...data});
    if(!['material_ready','material_skipped','material_chunk_received','material_saved'].includes(response.code))throw new Error('O desktop não conseguiu gravar o material na pasta de destino.');
    return response.code;
  },async materialExists(lessonId,name) {
    const {nativePairToken}=await storage.get('nativePairToken');
    if(!nativePairToken)return false;
    const response=await post('material_exists',{pairToken:nativePairToken,lessonId,materialName:name});
    if(response.code!=='material_checked')throw new Error('Não foi possível verificar os materiais existentes.');
    return response.exists===true;
  },async captureRequest() {
    const {nativePairToken}=await storage.get('nativePairToken');
    if(!nativePairToken)throw new Error('Reconexão necessária.');
    const response=await post('capture_poll',{pairToken:nativePairToken});
    if(response.code==='pair_required')throw new Error('Reconexão necessária.');
    return response.code==='capture_poll' ? response.captureRequest : null;
  },async captureResult(captureId,url,failed=false,failureCode=null) {
    const {nativePairToken}=await storage.get('nativePairToken');
    const response=await post('capture_result',{pairToken:nativePairToken,captureId,url,failed,...(failureCode?{failureCode}:{})});
    if(response.code!=='capture_received')throw new Error('Captura recusada pelo desktop.');
  },async pair(inventory) {
    const nonce=random();
    const original=await session();
    if(!original?.accessToken || !original.userId)throw new Error('Entre na sua conta Vodown para conectar.');
    const accessToken=original.accessToken;
    const response=await post('pair',{nonce,accessToken});
    if(response.code!=='pair_pending')throw new Error('Abra o desktop e revogue uma conexão anterior antes de conectar novamente.');
    for(let attempt=0;attempt<60;attempt++) {
      await delay(2000);
      const reply=await post('pair_status',{nonce});
      if(reply.code==='paired' && /^[a-f0-9]{64}$/.test(reply.pairToken)) {
        if((await session()).userId!==original.userId)throw new Error('A conta mudou durante a conexão. Tente novamente.');
        await storage.set({nativePairToken:reply.pairToken});
        await publish(inventory());return {paired:true};
      }
    }
    throw new Error('A confirmação expirou. Tente novamente e confirme no desktop.');
  }};
}
