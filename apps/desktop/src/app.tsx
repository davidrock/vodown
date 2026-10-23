import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Download, Layers3, Settings2, UserRound, ArrowUpRight, ShieldCheck, Puzzle, RefreshCw, LogOut, MonitorDown } from 'lucide-react';
import { Brand } from '@vodown/ui/brand';
import { Button } from '@vodown/ui/button';
import { Card } from '@vodown/ui/card';
import { createVodownAuth } from '@vodown/auth';
import { Login } from '@vodown/auth/login';
import { getEntitlements, type Entitlements } from './api';
import { readHistory, type DownloadRecord } from './history';

const auth = createVodownAuth(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
type Screen = 'downloads'|'account'|'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('downloads');
  const [session, setSession] = useState<Session|null>(null);
  const [plan, setPlan] = useState<Entitlements|null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [history,setHistory] = useState<DownloadRecord[]>([]);
  const [historyError,setHistoryError] = useState('');
  useEffect(()=>{
    let active=true;
    readHistory().then(records=>{if(active)setHistory(records);}).catch(()=>{if(active)setHistoryError('Não foi possível consultar o histórico local.');});
    return()=>{active=false;};
  },[refresh]);
  useEffect(() => {
    if (!auth) return;
    const {data} = auth.auth.onAuthStateChange((_event, next) => {setSession(next); setPlan(null); setError('');});
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setError('');
    getEntitlements(session.access_token, controller.signal).then(setPlan).catch((e: Error) => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [session, refresh]);
  return <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
    <aside className="flex flex-col border-b border-border bg-white px-6 py-7 lg:min-h-screen lg:border-r lg:border-b-0">
      <Brand/>
      <div className="mt-6 rounded-xl bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground">Seu aprendizado, com você.</div>
      <nav aria-label="Principal" className="mt-8 flex gap-2 lg:flex-col">
        {([{id:'downloads',label:'Downloads',icon:Download},{id:'account',label:'Minha conta',icon:UserRound},{id:'settings',label:'Preferências',icon:Settings2}] as const).map(item => <button key={item.id} onClick={() => setScreen(item.id)} aria-current={screen===item.id ? 'page':undefined} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-left ${screen===item.id ? 'bg-secondary font-semibold text-secondary-foreground':'text-muted-foreground hover:bg-muted'}`}><item.icon size={18}/>{item.label}</button>)}
      </nav>
      <div className="mt-auto hidden pt-12 text-xs text-muted-foreground lg:block"><ShieldCheck className="mb-3 size-5"/>Seus vídeos ficam no seu computador.<div className="mt-5 text-[11px]">Vodown · versão 0.1.0</div></div>
    </aside>
    <main className="mx-auto w-full max-w-6xl px-6 py-8 md:px-12 md:py-10">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-semibold tracking-[.18em] text-primary">SUA BIBLIOTECA OFFLINE</p><h1 className="text-3xl font-semibold tracking-tight">{screen==='downloads'?'Seus próximos aprendizados.':screen==='account'?'Sua conta, seu espaço.':'Do seu jeito.'}</h1></div><span className="rounded-full border border-border bg-white px-4 py-2 text-xs font-medium">{plan ? `Plano ${plan.plan.toUpperCase()}` : session ? 'Consultando plano…':'Bem-vindo ao Vodown'}</span></header>
      {screen==='account' || !session ? <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <Card className="flex min-h-96 flex-col justify-center p-8 md:p-10"><div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary"><MonitorDown size={28}/></div><h2 className="max-w-sm text-2xl font-semibold tracking-tight">Um lugar para organizar suas aulas.</h2><p className="mt-4 max-w-md leading-7 text-muted-foreground">Conecte sua conta para consultar seu plano. O desktop faz parte do PRO; no FREE, você pode baixar uma aula por vez pela extensão.</p><div className="mt-8 flex items-center gap-3 text-sm"><Puzzle className="size-5 text-primary"/>Chrome e desktop trabalhando juntos.</div></Card>
        <Card className="p-7"><h2 className="mb-2 text-xl font-semibold">{session ? 'Conta conectada':'Entre para continuar'}</h2><p className="mb-7 text-sm text-muted-foreground">{session?.user.email || 'Use a mesma conta no app e na extensão.'}</p>{session ? <><PlanStatus plan={plan} error={error}/><Button variant="outline" className="mt-6 w-full" onClick={() => {void auth?.auth.signOut();}}><LogOut/>Sair da conta</Button></>:<Login client={auth}/>}</Card>
      </div> : screen==='settings' ? <Card className="max-w-2xl p-8"><h2 className="text-xl font-semibold">Preferências do desktop</h2><p className="mt-4 leading-7 text-muted-foreground">As configurações de qualidade, legendas e pasta continuam disponíveis na extensão. As preferências do motor de downloads nativo serão habilitadas com a conexão entre a extensão e o app.</p></Card> : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-3">{[{label:'Na fila',value:String(history.filter(item=>item.status==='queued').length),icon:Layers3},{label:'Em andamento',value:String(history.filter(item=>item.status==='running').length),icon:Download},{label:'Extensão',value:'Não conectada',icon:Puzzle}].map(item=><Card key={item.label} className="p-5"><div className="flex items-center justify-between text-sm text-muted-foreground">{item.label}<item.icon size={18}/></div><p className="mt-4 text-2xl font-semibold">{item.value}</p></Card>)}</div>
        {historyError ? <p role="alert">{historyError}</p>:null}
        {history.length ? <Card className="mb-6 divide-y divide-border p-5">{history.map(item=><div key={item.id} className="flex items-center justify-between gap-4 py-3"><span className="text-sm font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{item.platform} · {item.status}</span></div>)}</Card>:null}
        <Card className="p-8"><div className="flex items-center justify-between"><h2 className="font-semibold">Downloads</h2><Button variant="ghost" size="sm" onClick={()=>setRefresh(n=>n+1)}><RefreshCw/>Atualizar plano</Button></div><div className="flex min-h-72 flex-col items-center justify-center text-center"><div className="mb-5 rounded-2xl bg-secondary p-4 text-primary"><Download size={30}/></div><h3 className="text-lg font-semibold">Sua fila começa por uma aula.</h3><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">A extensão continua disponível para downloads no Chrome. O envio de aulas ao desktop ainda está em implementação.</p></div><PlanStatus plan={plan} error={error}/></Card>
      </>}
      <footer className="mt-9 flex items-center gap-2 text-xs text-muted-foreground"><ArrowUpRight size={14}/>Baixe apenas conteúdos para os quais você tem autorização.</footer>
    </main>
  </div>;
}
function PlanStatus({plan,error}: {plan:Entitlements|null;error:string}) {
  if(error) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  return <p role="status" className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{plan ? plan.desktopAllowed ? 'PRO ativo. Sua conta tem acesso ao desktop.':'Plano FREE: uma aula por ação na extensão. O desktop requer PRO.':'Consultando suas permissões…'}</p>;
}
