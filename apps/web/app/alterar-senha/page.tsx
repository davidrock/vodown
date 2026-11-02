'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Brand} from '@vodown/ui/brand';
import {Card} from '@vodown/ui/card';
import {useAuth} from '../auth-client';
import {PasswordForm} from '../auth/password-form';

export default function ChangePassword() {
  const {auth,loading:authLoading}=useAuth();
  const [userId,setUserId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    if(authLoading)return;
    let active=true;
    if(!auth){setLoading(false);return;}
    auth.auth.getSession().then(({data,error})=>{if(active && !error)setUserId(data.session?.user.id || null);}).catch(()=>{}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[auth,authLoading]);
  return <main className="mx-auto max-w-md px-6 py-12"><Link href="/" aria-label="Voltar ao início"><Brand/></Link><Card className="mt-10 p-8"><h1 className="text-2xl font-semibold">Alterar senha</h1>{loading?<p role="status" className="mt-6 text-sm">Verificando sessão…</p>:userId?<PasswordForm userId={userId}/>:<div className="mt-6 space-y-4"><p role="alert" className="text-sm">Entre na sua conta para alterar a senha.</p><Link href="/conta" className="text-sm text-primary hover:underline">Entrar</Link></div>}</Card></main>;
}
