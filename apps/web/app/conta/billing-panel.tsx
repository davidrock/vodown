import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {Button} from '@vodown/ui/button';
import {Card} from '@vodown/ui/card';
type Plan='monthly'|'annual'|'lifetime';
type Prices={available:boolean;testMode:boolean;prices:{interval:Plan;currency:string;amountMinor:number}[]};
type Access={plan:'free'|'pro';desktopAllowed:boolean};
export function BillingPanel({session,apiUrl}:{session:Session;apiUrl:string}) {
  const [catalog,setCatalog]=useState<Prices|null>(null);
  const [access,setAccess]=useState<Access|null>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const request=useRef<{plan:Plan;id:string}|null>(null);
  const [revision,setRevision]=useState(0);
  async function api<T>(path:string,method='GET',body?:unknown,id?:string,signal?:AbortSignal):Promise<T> {
    const response=await fetch(`${apiUrl}${path}`,{method,signal,headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{}),...(id?{'Idempotency-Key':id}:{})},body:body?JSON.stringify(body):undefined});
    if(!response.ok){const problem=await response.json().catch(()=>null);throw new Error(response.status===401?'Entre novamente para continuar.':problem?.detail||'Não foi possível consultar a cobrança. Tente novamente.');}
    return response.json() as Promise<T>;
  }
  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    const reconcile=revision>0||new URLSearchParams(window.location.search).get('checkout')==='success';
    Promise.allSettled([
      api<Prices>('/v1/billing/plans','GET',undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setCatalog(value);}),
      api<Access>(reconcile?'/v1/billing/reconcile':'/v1/me/entitlements',reconcile?'POST':'GET',undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setAccess(value);})
    ]).then(results=>{const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected'&&!controller.signal.aborted)setError((failure.reason as Error).message);});
    return()=>controller.abort();
  },[session.access_token,apiUrl,revision]);
  async function checkout(plan:Plan) {
    if(pending)return;
    setPending(true);setError('');
    if(request.current?.plan!==plan)request.current={plan,id:crypto.randomUUID()};
    try {
      const result=await api<{url:string}>('/v1/billing/checkout','POST',{plan},request.current.id);
      const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Endereço de checkout inválido.');
      window.location.assign(url.href);
    } catch(e){setError((e as Error).message);setPending(false);}
  }
  async function portal() {
    setPending(true);setError('');
    try {
      const result=await api<{url:string}>('/v1/billing/portal','POST',undefined,crypto.randomUUID());
      const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='billing.stripe.com')throw new Error('Endereço de cobrança inválido.');
      window.location.assign(url.href);
    } catch(e){setError((e as Error).message);setPending(false);}
  }
  const labels:Record<Plan,string>={monthly:'Mensal',annual:'Anual',lifetime:'Compra única'};
  return <section className="mt-8 space-y-5" aria-label="Planos e assinatura">
    <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">Seu plano {access?.plan.toUpperCase()||'…'}</h2><Button variant="ghost" onClick={()=>setRevision(n=>n+1)} disabled={pending}>Atualizar</Button></div>
    {catalog?.testMode?<p className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">Ambiente de testes. Nenhuma cobrança real será realizada.</p>:null}
    {error?<p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>:null}
    {access?.plan==='pro'?<Card className="p-6"><h3 className="font-semibold">PRO ativo</h3><p className="my-4 text-sm text-muted-foreground">Desktop e filas de aulas disponíveis na sua conta.</p><Button variant="outline" onClick={()=>{void portal();}} disabled={pending}>Gerenciar cobrança</Button></Card>:<div className="grid gap-4 md:grid-cols-3">{catalog?.prices.map(price=><Card key={price.interval} className="flex flex-col p-6"><h3 className="font-semibold">{labels[price.interval]}</h3><p className="my-5 text-3xl font-semibold">{new Intl.NumberFormat('pt-PT',{style:'currency',currency:price.currency}).format(price.amountMinor/100)}</p><p className="mb-6 text-sm text-muted-foreground">{price.interval==='lifetime'?'Uma vez, para os recursos PRO do Vodown.':price.interval==='annual'?'Renovação anual. Cancele quando quiser.':'Renovação mensal. Cancele quando quiser.'}</p><Button className="mt-auto" onClick={()=>{void checkout(price.interval);}} disabled={pending||!access||!catalog.available}>Escolher {labels[price.interval].toLowerCase()}</Button></Card>)}</div>}
    {catalog&&!catalog.available?<p className="text-sm text-muted-foreground">A cobrança ainda não está disponível.</p>:null}
  </section>;
}
