'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Brand} from '@vodown/ui/brand';
import {Card} from '@vodown/ui/card';
import {useAuth} from '../auth-client';
import {PasswordForm} from '../auth/password-form';
import {exchangeRecoveryCode} from '../auth/recovery-flow';

export default function ResetPassword() {
  const {auth,loading}=useAuth();
  const [userId,setUserId]=useState<string|null>(null);
  const [invalid,setInvalid]=useState(false);
  // React Strict Mode may run the effect twice: exchange a one-use code only once.
  const exchange=useRef<Promise<string>|null>(null);
  useEffect(()=>{
    if(loading)return;
    let active=true;
    if(!exchange.current) {
      const params=new URLSearchParams(window.location.search);
      const code=params.get('code'),flowId=params.get('sb_flow_id') || undefined;
      // Remove authorization codes and provider errors from the visible URL.
      window.history.replaceState(window.history.state,'',window.location.pathname);
      exchange.current=auth && code ? exchangeRecoveryCode(auth,code,flowId) : Promise.reject(new Error('invalid_recovery'));
    }
    exchange.current.then(id=>{if(active)setUserId(id);}).catch(()=>{if(active)setInvalid(true);});
    return()=>{active=false;};
  },[auth,loading]);
  return <main className="mx-auto max-w-md px-6 py-12"><Link href="/" aria-label="Voltar ao início"><Brand/></Link><Card className="mt-10 p-8"><h1 className="text-2xl font-semibold">Redefinir senha</h1>{userId?<PasswordForm userId={userId}/>:invalid?<div className="mt-6 space-y-4"><p role="alert" className="text-sm text-red-700">O link é inválido, expirou ou já foi usado. Solicite outro e abra-o no mesmo navegador.</p><Link href="/recuperar-senha" className="text-sm text-primary hover:underline">Solicitar outro link</Link></div>:<p role="status" className="mt-6 text-sm text-muted-foreground">Validando link…</p>}</Card></main>;
}
