import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Download, FolderOpen, Settings2, UserRound, RefreshCw, LogOut, Search } from 'lucide-react';
import { Brand } from '@vodown/ui/brand';
import { Button } from '@vodown/ui/button';
import { Card } from '@vodown/ui/card';
import { createVodownAuth } from '@vodown/auth';
import { Login } from '@vodown/auth/login';
import { getEntitlements, activateLocalPro, type Entitlements } from './api';
import { readHistory, completedVideos, type DownloadRecord } from './history';
import { secureStorage } from './secure-storage';
import {isTauri,invoke} from '@tauri-apps/api/core';
import {openUrl} from '@tauri-apps/plugin-opener';
import {getCurrent,onOpenUrl} from '@tauri-apps/plugin-deep-link';
import {desktopOAuth} from './oauth-flow';
import {publicConnection,configureConnection,googleAvailable} from './connection';
import {BridgePanel} from './bridge-panel';
import {consentKey} from './pairing-consent';

const connection=publicConnection();
const auth = createVodownAuth(connection.url, connection.key, false, secureStorage);
const oauth = auth && secureStorage ? desktopOAuth({client:auth,storage:secureStorage,open:openUrl,supabaseUrl:connection.url}) : null;
type Screen = 'downloads'|'saved'|'account'|'settings';

export function App() {
  const [sidebarTarget,setSidebarTarget]=useState<HTMLDivElement|null>(null);
  const [fileError,setFileError]=useState('');
  const [googleEnabled,setGoogleEnabled]=useState(false);
  useEffect(()=>{const controller=new AbortController();void googleAvailable(controller.signal).then(setGoogleEnabled).catch(()=>{});return()=>controller.abort();},[]);
  const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('vodown-theme')==='dark'?'dark':'light');
  const [subtitles,setSubtitles]=useState(()=>localStorage.getItem('vodown-subtitles')!=='off');
  useEffect(()=>{localStorage.setItem('vodown-theme',theme);},[theme]);
  useEffect(()=>{localStorage.setItem('vodown-subtitles',subtitles?'on':'off');},[subtitles]);
  const [screen, setScreen] = useState<Screen>(auth ? 'downloads':'account');
  const [session, setSession] = useState<Session|null>(null);
  const [plan, setPlan] = useState<Entitlements|null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [history,setHistory] = useState<DownloadRecord[]>([]);
  const [historyError,setHistoryError] = useState('');
  const [search,setSearch] = useState('');
  const [authError,setAuthError] = useState('');
  const [signingOut,setSigningOut] = useState(false);
  const [authNotice,setAuthNotice] = useState('');
  useEffect(()=>{
    let active=true;
    readHistory().then(records=>{if(active)setHistory(records);}).catch(()=>{if(active)setHistoryError('Não foi possível consultar o histórico local.');});
    return()=>{active=false;};
  },[refresh,screen]);
  useEffect(() => {
    if (!auth) return;
    let active = true;
    const {data} = auth.auth.onAuthStateChange((_event, next) => {setSession(next); setPlan(null); setError('');if(next)setAuthNotice('');});
    auth.auth.getSession().then(({error})=>{if(active && error)setAuthError('Não foi possível restaurar sua sessão. Verifique o armazenamento seguro do sistema e tente entrar novamente.');})
      .catch(()=>{if(active)setAuthError('Não foi possível restaurar sua sessão no armazenamento seguro.');});
    return () => {active=false;data.subscription.unsubscribe();};
  }, []);
  useEffect(()=>{
    if(!oauth || !isTauri())return;
    let active=true, unlisten:(()=>void)|undefined;
    const receive=(urls:string[])=>{for(const url of urls)void oauth.handle(url).then(handled=>{
      if(active && handled){setAuthError('');setAuthNotice('');}
    }).catch(()=>{if(active){setAuthNotice('');setAuthError('Não foi possível entrar com o Google. Tente novamente.');}});};
    void (async()=>{
      const stop=await onOpenUrl(receive);
      if(!active){stop();return;}
      unlisten=stop;
      const urls=await getCurrent();
      if(active && urls)receive(urls);
    })().catch(()=>{if(active)setAuthError('Não foi possível preparar o login pelo navegador.');});
    return()=>{active=false;unlisten?.();};
  },[]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setError('');
    setPlan(null);
    activateLocalPro(session.access_token,controller.signal).then(()=>getEntitlements(session.access_token, controller.signal)).then(setPlan).catch((e: Error) => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [session, refresh]);
  async function signOut() {
    if (!auth || signingOut) return;
    setSigningOut(true);setAuthError('');
    try {
      const {error}=await auth.auth.signOut();
      if(error)setAuthError('Não foi possível sair da conta. Tente novamente.');
      else await secureStorage?.removeItem(consentKey);
    } catch {setAuthError('Não foi possível remover a sessão do armazenamento seguro. Tente novamente.');}
    finally {setSigningOut(false);}
  }
  async function recoverPassword() {
    setAuthError('');
    try {
      const configured=import.meta.env.VITE_WEB_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '');
      if(!configured) throw new Error('missing_url');
      const url=new URL(configured);
      if(url.username || url.password || (url.protocol!=='https:' && !(import.meta.env.DEV && url.protocol==='http:' && url.hostname==='localhost' && url.port==='3000'))) throw new Error('invalid_url');
      const destination=new URL('/recuperar-senha',url.origin).href;
      if(isTauri()) await openUrl(destination);
      else window.open(destination,'_blank','noopener,noreferrer');
    } catch {setAuthError('Não foi possível abrir a recuperação de senha. Verifique a configuração do site.');}
  }
  async function googleLogin() {
    if(!oauth)throw new Error('OAuth indisponível');
    setAuthError('');setAuthNotice('');
    await oauth.start();
    setAuthNotice('Conclua o login no navegador e volte ao Vodown.');
  }
  const saved=completedVideos(history);
  const titles={downloads:['Downloads','Escolha o que você quer baixar.'],saved:['Baixados','Encontre os arquivos salvos no seu computador.'],account:['Minha conta','Gerencie seu acesso ao Vodown.'],settings:['Preferências','Ajuste o Vodown ao seu jeito.']};
  return <div data-theme={theme} className="desktop-shell desktop-layout">
    <a className="skip-link" href="#desktop-main">Pular para o conteúdo</a>
    <aside className="desktop-sidebar">
      <div className="desktop-brand"><Brand compact/><span>Vodown</span></div>
      <nav aria-label="Principal" className="desktop-nav">
        {([{id:'downloads',label:'Downloads',icon:Download},{id:'saved',label:'Baixados',icon:FolderOpen},{id:'account',label:'Minha conta',icon:UserRound},{id:'settings',label:'Preferências',icon:Settings2}] as const).map(item=><button key={item.id} onClick={()=>setScreen(item.id)} aria-current={screen===item.id?'page':undefined}><item.icon size={18} aria-hidden="true"/>{item.label}</button>)}
      </nav>
      <div ref={setSidebarTarget} className="sidebar-connection-slot"/>
      <p className="sidebar-version">Vodown · 0.1.0</p>
    </aside>
    <main id="desktop-main" className="desktop-main">
      <header className="workspace-header"><div><h1>{titles[screen][0]}</h1><p>{titles[screen][1]}</p></div>{plan?<span className="plan-badge">{plan.plan.toUpperCase()}</span>:null}</header>
      {authError?<p role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{authError}</p>:null}
      {authNotice?<p role="status" className="mb-6 text-sm text-muted-foreground">{authNotice}</p>:null}
      <BridgePanel client={auth} session={session} visible={screen==='downloads'} includeSubtitles={subtitles} onSubtitlesChange={setSubtitles} sidebarTarget={sidebarTarget} onCompleted={()=>setRefresh(n=>n+1)}/>
      {screen==='account'?<Card className="account-panel"><h2 className="text-xl font-semibold">{session?'Sua conta':'Entrar no Vodown'}</h2><p className="mt-2 mb-6 text-sm text-muted-foreground">{session?.user.email||'Use a mesma conta na extensão e no desktop.'}</p>{session?<><PlanStatus plan={plan} error={error}/><div className="mt-6 flex flex-wrap gap-3"><Button variant="outline" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/>Atualizar plano</Button><Button variant="outline" disabled={signingOut} onClick={()=>{void signOut();}}><LogOut size={16}/>{signingOut?'Saindo…':'Sair da conta'}</Button></div></>:!auth?<ConnectionSetup/>:<Login client={auth} onRecover={()=>{void recoverPassword();}} onGoogle={oauth&&googleEnabled?googleLogin:undefined}/>}</Card>:null}
      {screen==='settings'?<Card className="account-panel"><h2 className="text-lg font-semibold">Aparência e downloads</h2><label className="preference-row"><span><strong>Tema escuro</strong><small>Altere a aparência do aplicativo.</small></span><input type="checkbox" checked={theme==='dark'} onChange={event=>setTheme(event.target.checked?'dark':'light')}/></label><label className="preference-row"><span><strong>Incluir legendas</strong><small>Salve as legendas disponíveis ao lado dos vídeos.</small></span><input type="checkbox" checked={subtitles} onChange={event=>setSubtitles(event.target.checked)}/></label></Card>:null}
      {screen==='saved'?<section className="saved-panel"><div className="saved-toolbar"><label className="search-field"><Search size={17} aria-hidden="true"/><span className="sr-only">Buscar aulas baixadas</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar aula ou curso…"/></label><Button variant="outline" size="sm" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15}/>Atualizar</Button></div>{historyError||fileError?<p role="alert" className="my-4 text-sm text-red-700">{historyError||fileError}</p>:null}
        {saved.length?<div className="saved-list">{saved.filter(item=>`${item.title} ${item.courseTitle||''} ${item.platform}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())).map(item=><article key={item.id} className="saved-row"><div className="saved-file-icon"><FolderOpen size={20}/></div><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{item.title}</h2><p className="mt-1 text-xs text-muted-foreground">{item.courseTitle||item.platform}</p></div><Button size="sm" variant="outline" onClick={()=>{setFileError('');void invoke('open_download_folder',{id:item.id}).catch(()=>setFileError('Não foi possível encontrar o arquivo. Ele pode ter sido movido ou removido.'));}}>Abrir pasta</Button></article>)}{!saved.some(item=>`${item.title} ${item.courseTitle||''} ${item.platform}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))?<p className="empty-search">Nenhuma aula encontrada.</p>:null}</div>:<div className="workspace-empty"><div className="empty-icon"><FolderOpen size={28}/></div><h2>Nenhuma aula baixada ainda</h2><p>Os vídeos concluídos aparecerão aqui. Comece pela página Downloads.</p><Button className="mt-5" onClick={()=>setScreen('downloads')}>Ir para Downloads</Button></div>}
      </section>:null}
    </main>
  </div>;
}

function PlanStatus({plan,error}: {plan:Entitlements|null;error:string}) {
  if(error) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  return <p role="status" className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{plan ? plan.desktopAllowed ? 'PRO ativo. Sua conta tem acesso ao desktop.':'Plano FREE: uma aula por ação na extensão. O desktop requer PRO.':'Consultando suas permissões…'}</p>;
}

function ConnectionSetup() {
  const [key,setKey]=useState('');
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  return <form className="space-y-4" onSubmit={async event=>{event.preventDefault();if(pending)return;setPending(true);setError('');try{await configureConnection(key);window.location.reload();}catch(error){setError(error instanceof Error ? error.message:'Não foi possível conectar.');setPending(false);}}}>
    <p className="text-sm leading-6 text-muted-foreground">Conecte o projeto Vodown uma vez para habilitar o login neste computador.</p>
    <label htmlFor="public-key" className="block text-sm font-medium">Chave pública do Supabase</label>
    <input id="public-key" required autoComplete="off" spellCheck={false} value={key} onChange={event=>setKey(event.target.value)} placeholder="sb_publishable_…" disabled={pending} className="w-full rounded-lg border border-border px-3 py-2 text-sm"/>
    <p className="text-xs leading-5 text-muted-foreground">Disponível em Settings → API Keys no painel do projeto. Informe somente a chave publicável.</p>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p>:null}
    <Button type="submit" className="w-full" disabled={pending}>{pending?'Verificando conexão…':'Conectar e habilitar login'}</Button>
  </form>;
}
