import {useEffect,useState,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Puzzle,Link2Off} from 'lucide-react';
import type {SupabaseClient,Session} from '@supabase/supabase-js';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {Button} from '@vodown/ui/button';
import {Card} from '@vodown/ui/card';
import {secureStorage} from './secure-storage';
import {runCourseQueue} from './course-queue';
import {groupCourse,type CourseLesson} from './course-groups';
import {pairingConsent} from './pairing-consent';
type Candidate={nonce:string;email:string;userId:string};
type Inventory={courseKey:string;title:string;platform:string;lessons:CourseLesson[];trackDiscoveryIncomplete?:boolean;failedTracks?:string[];totalTracks?:number};
export function BridgePanel({client,session,visible,includeSubtitles,onSubtitlesChange,sidebarTarget,onCompleted}:{client:SupabaseClient|null;session:Session|null;visible:boolean;includeSubtitles:boolean;onSubtitlesChange:(value:boolean)=>void;sidebarTarget:HTMLElement|null;onCompleted:()=>void}) {
  const consent=client&&secureStorage?pairingConsent(client,secureStorage):null;
  const [connected,setConnected]=useState(false);
  const [candidate,setCandidate]=useState<Candidate|null>(null);
  const [inventory,setInventory]=useState<Inventory|null>(null);
  const [error,setError]=useState('');
  const [connectionNotice,setConnectionNotice]=useState('');
  const revoking=useRef(false);
  const queueCanceled=useRef(false);
  const queueRunning=useRef(false);
  const queueAccount=useRef(session?.user.id);queueAccount.current=session?.user.id;
  const downloadedSignature=useRef('');
  const [downloaded,setDownloaded]=useState<Set<string>>(new Set());
  const [queue,setQueue]=useState<{done:number;total:number;failed:number;skipped:number;title:string;warnings:string[]}|null>(null);
  const [busy,setBusy]=useState(false);
  const [job,setJob]=useState<{title:string;status:string;bytes:number;error:string|null;path:string|null;errorCode?:string|null;warning?:string|null}|null>(null);
  useEffect(()=>{
    if(!isTauri())return;
    let stopped=false,running=false,seen='';
    setCandidate(null);setInventory(null);setConnectionNotice('');setDownloaded(new Set());downloadedSignature.current='';queueCanceled.current=true;
    // Switching accounts invalidates pairing and all account-scoped inventory.
    const reset=invoke('bridge_reset');
    const poll=async()=>{
      if(running || stopped || revoking.current)return;running=true;
      try {
        await reset;
        if(!client || !session)return;
        const pending=await invoke<{nonce:string;accessToken:string}|null>('bridge_pending');
        if(pending && pending.nonce!==seen) {
          try {
            if(!consent)return;
            const verified=await consent.inspect(pending,session.user.id);
            if(stopped || revoking.current)return;
            seen=pending.nonce;
            if(verified.trusted){await invoke('bridge_accept',{nonce:verified.nonce});setCandidate(null);setConnectionNotice('Extensão conectada.');setError('');}
            else {setError('');setCandidate(verified);}
          } catch(error) {
            if(stopped || revoking.current)return;
            seen=pending.nonce;await invoke('bridge_reset');
            setError(error instanceof Error?error.message:'Não foi possível verificar a conta da extensão.');
          }
        }
        const paired=await invoke<boolean>('bridge_connected');if(!stopped)setConnected(paired);
        const next=await invoke<Inventory|null>('bridge_inventory');
        if(!stopped){
          setInventory(next);const currentJob=await invoke<typeof job>('native_download_status');setJob(currentJob);
          const signature=JSON.stringify([next?.courseKey,next?.lessons.map(l=>[l.id,l.title,l.module]),currentJob?.status,currentJob?.path]);
          if(next && signature!==downloadedSignature.current){const saved=await invoke<{lessonId:string}[]>('downloaded_lessons');if(!stopped){setDownloaded(new Set(saved.map(s=>s.lessonId)));downloadedSignature.current=signature;}}
        }
      } catch {if(!stopped)setError('Não foi possível verificar a conexão com a extensão.');}
      finally {running=false;}
    };
    void poll();const timer=setInterval(()=>{void poll();},2000);
    return()=>{stopped=true;clearInterval(timer);};
  },[client,session?.user.id]);
  async function decide(accept:boolean) {
    if(busy || !candidate)return;setBusy(true);setError('');
    try{if(accept){await consent?.trust(candidate.userId);await invoke('bridge_accept',{nonce:candidate.nonce});setConnectionNotice('Extensão conectada.');}else{await invoke('bridge_reset');}setCandidate(null);}
    catch{setError('A solicitação expirou. Conecte novamente pela extensão.');setCandidate(null);}
    finally{setBusy(false);}
  }
  async function revoke() {
    if(revoking.current)return;
    revoking.current=true;setBusy(true);setError('');setConnectionNotice('Desconectando a extensão…');
    try {
      await invoke('bridge_reset');setConnected(false);setCandidate(null);setInventory(null);
      await consent?.revoke();
      await invoke('bridge_reset');
      setConnectionNotice('Conexão revogada. Para conectar novamente, confirme a solicitação no desktop.');
    } catch {setConnectionNotice('');setError('Não foi possível concluir a revogação. Verifique o acesso ao armazenamento seguro e tente novamente.');}
    finally {revoking.current=false;setBusy(false);}
  }
  async function download(lessonId:string,materialsOnly=false) {
    if(!client)return;setBusy(true);setError('');
    try {const {data,error}=await client.auth.getSession();if(error || !data.session)throw new Error('Entre novamente na sua conta.');await invoke('native_download',{lessonId,accessToken:data.session.access_token,materialsOnly,includeSubtitles,expectedCourse:inventory?.courseKey});setJob(await invoke('native_download_status'));}
    catch(error){setError(typeof error==='string'?error:error instanceof Error?error.message:'Não foi possível iniciar o download.');}
    finally{setBusy(false);}
  }
  async function openFolder(lessonId:string) {
    try{await invoke('open_lesson_folder',{lessonId});}catch(error){setError(typeof error==='string'?error:'Não foi possível abrir a pasta.');setDownloaded(previous=>new Set([...previous].filter(id=>id!==lessonId)));}
  }
  async function downloadCourse(lessons:CourseLesson[]) {
    if(!client || !inventory || queueRunning.current)return;
    queueRunning.current=true;queueCanceled.current=false;setBusy(true);setError('');
    const owner=session?.user.id;
    try {
      await runCourseQueue(lessons,{
        includeSubtitles,
        saved:async()=>new Set((await invoke<{lessonId:string}[]>('downloaded_lessons')).map(s=>s.lessonId)),
        canceled:()=>queueCanceled.current||queueAccount.current!==owner,
        report:setQueue,
        start:async(lesson,materialsOnly=false,subtitlesOnly=false)=>{
          if(queueCanceled.current||queueAccount.current!==owner)throw new Error('Fila interrompida.');
          const {data,error}=await client.auth.getSession();if(error||!data.session||data.session.user.id!==owner)throw new Error('Entre novamente para continuar o curso.');
          await invoke('native_download',{lessonId:lesson.id,accessToken:data.session.access_token,materialsOnly,subtitlesOnly,includeSubtitles,expectedCourse:inventory.courseKey});
        },
        wait:async()=>{
          while(true){
            const current=await invoke<NonNullable<typeof job>>('native_download_status');setJob(current);
            if(!current)throw new Error('Não foi possível acompanhar a fila.');
            if(!['authorizing','capturing','downloading','finishing'].includes(current.status))return current;
            if(queueCanceled.current||queueAccount.current!==owner)await invoke('native_download_cancel');
            await new Promise(resolve=>setTimeout(resolve,700));
          }
        },
      });
    } catch(error){setError(typeof error==='string'?error:error instanceof Error?error.message:'Não foi possível baixar o curso.');}
    finally{queueRunning.current=false;setBusy(false);downloadedSignature.current='';onCompleted();}
  }
  function cancelDownloads(){queueCanceled.current=true;void invoke('native_download_cancel');}
  const tracks=inventory?groupCourse(inventory.lessons):[];
  const active=!!job && ['authorizing','capturing','downloading','finishing'].includes(job.status);
  const showJob=!queue && job && job.errorCode!=='no_materials' && (active || (!queue && (job.error||job.warning)));
  return <>
    {sidebarTarget?createPortal(<div className="connection-panel">
      <div className="connection-indicator"><span className={`connection-dot ${connected?'is-connected':''}`} aria-hidden="true"/><span>{connected?'Extensão conectada':candidate?'Conexão pendente':'Extensão desconectada'}</span></div>
      {candidate?<><p className="connection-hint">{candidate.email} quer conectar este computador.</p><div className="connection-actions"><Button size="sm" disabled={busy} onClick={()=>{void decide(true);}}>Permitir</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>{void decide(false);}}>Recusar</Button></div></>:null}
      {connected?<button className="connection-disconnect" disabled={busy||active} onClick={()=>{void revoke();}}><Link2Off size={14}/>Desconectar extensão</button>:<p className="connection-hint">Abra a extensão no Chrome para conectar.</p>}
      {connectionNotice && !connected?<p role="status" className="connection-hint">{connectionNotice}</p>:null}
    </div>,sidebarTarget):null}
    <div hidden={!visible} className="download-workspace">
    {error?<p role="alert" className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>:null}
    {queue?<section className="transfer-panel" aria-label="Progresso do download">
      <div className="flex items-center justify-between gap-4"><div><p className="font-semibold">{queueRunning.current?'Baixando seleção':queueCanceled.current?'Download interrompido':queue.failed?'Download finalizado com avisos':'Download concluído'}</p><p className="mt-1 text-sm text-muted-foreground">{queue.done} de {queue.total} aulas processadas{queue.skipped?` · ${queue.skipped} vídeos existentes preservados`:''}{queue.failed?` · ${queue.failed} aulas com falha`:''}</p></div>{queueRunning.current?<Button size="sm" variant="outline" onClick={cancelDownloads}>Cancelar</Button>:<button aria-label="Fechar resumo do download" className="dismiss-button" onClick={()=>setQueue(null)}>×</button>}</div>
      {queueRunning.current?<><progress className="transfer-progress" max={queue.total||1} value={queue.done}/><p className="mt-2 text-sm text-muted-foreground">{queue.title}</p></>:null}
      {queue.warnings.length?<details className="mt-3 text-sm"><summary>Ver {queue.warnings.length} avisos</summary><ul className="mt-2 space-y-2 text-muted-foreground">{queue.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>:null}
    </section>:null}
    {showJob?<section className="transfer-panel"><div className="flex items-center justify-between gap-4"><div><p className="font-semibold">{job.title}</p><p className="mt-1 text-sm text-muted-foreground">{{authorizing:'Confirmando acesso…',capturing:'Recebendo arquivos da extensão…',downloading:'Baixando…',finishing:'Finalizando…',completed:'Concluído',failed:'Não foi possível concluir',canceled:'Cancelado'}[job.status]||job.status}{job.bytes>0?` · ${(job.bytes/1048576).toFixed(1)} MB`:''}</p></div>{active&&!queue?<Button size="sm" variant="outline" onClick={cancelDownloads}>Cancelar</Button>:null}</div>{job.error?<p role="alert" className="mt-3 text-sm text-red-700">{job.error}</p>:null}{job.warning&&!queue?<p className="mt-3 text-sm text-muted-foreground">{job.warning}</p>:null}</section>:null}
    {!inventory?<div className="workspace-empty"><div className="empty-icon"><Puzzle size={28}/></div><h2>{session?'Abra seu curso no Chrome':'Entre para começar'}</h2><p>{session?'As aulas aparecerão aqui automaticamente. Escolha o curso, um módulo ou aulas específicas para baixar.':'Acesse Minha conta e entre com a mesma conta usada na extensão.'}</p></div>:null}
    {inventory ? <Card className="course-panel">
      <div className="flex items-center justify-between gap-4"><div><p className="text-xs uppercase text-primary">{inventory.platform} · {inventory.lessons.length} aulas</p><h2 className="mt-2 text-xl font-semibold">{inventory.title}</h2></div></div>
      <div className="course-toolbar"><Button disabled={busy||active||!inventory.lessons.length||inventory.trackDiscoveryIncomplete} onClick={()=>{void downloadCourse(inventory.lessons);}}>Baixar curso inteiro</Button><span className="text-xs text-muted-foreground">Inclui vídeos e materiais disponíveis</span></div>
      {inventory.trackDiscoveryIncomplete?<p role="alert" className="mt-3 text-sm text-red-700">Algumas trilhas não foram carregadas{inventory.failedTracks?.length?`: ${inventory.failedTracks.join(', ')}`:''}. Atualize as aulas na extensão antes de baixar o curso inteiro.</p>:null}
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSubtitles} disabled={busy||active} onChange={event=>onSubtitlesChange(event.target.checked)}/> Baixar legendas disponíveis</label>
      <div className="course-modules">{tracks.map(track=><section key={track.key||'course'} className="space-y-3">
        {track.title?<div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{track.title} <span className="text-xs font-normal text-muted-foreground">{track.lessons.length} {track.lessons.length===1?'aula':'aulas'}</span></h3><Button size="sm" variant="outline" disabled={busy||active} onClick={()=>{void downloadCourse(track.lessons);}}>Baixar trilha</Button></div>:null}
        {track.modules.map(module=><details key={module.key} className="module-panel"><summary className="cursor-pointer font-semibold">{module.title} <span className="ml-2 text-xs font-normal text-muted-foreground">{module.lessons.length} {module.lessons.length===1?'aula':'aulas'}</span></summary><div className="mt-2"><Button size="sm" variant="outline" disabled={busy||active} onClick={()=>{void downloadCourse(module.lessons);}}>Baixar módulo</Button></div><ul className="mt-2 divide-y divide-border">{module.lessons.map(lesson=><li key={lesson.id} className="lesson-row"><span>{lesson.title}</span><div className="flex shrink-0 gap-2">{downloaded.has(lesson.id)?<Button size="sm" variant="outline" onClick={()=>{void openFolder(lesson.id);}}>Abrir pasta</Button>:null}<Button size="sm" variant="outline" disabled={busy||active} onClick={()=>{void download(lesson.id,true);}}>Materiais</Button><Button size="sm" disabled={busy||active} onClick={()=>{void download(lesson.id);}}>{downloaded.has(lesson.id)?'Baixar novamente':'Baixar aula'}</Button></div></li>)}</ul></details>)}
      </section>)}</div>
    </Card>:null}
  </div></>;
}
