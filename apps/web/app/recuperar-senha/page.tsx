'use client';
import {useState, type FormEvent} from 'react';
import Link from 'next/link';
import {Brand} from '@vodown/ui/brand';
import {Button} from '@vodown/ui/button';
import {Card} from '@vodown/ui/card';
import {Input} from '@vodown/ui/input';
import {useAuth} from '../auth-client';

export default function RecoverPassword() {
  const {auth,loading}=useAuth();
  const [pending,setPending]=useState(false);
  const [sent,setSent]=useState(false);
  const [error,setError]=useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || pending) return;
    const email=String(new FormData(event.currentTarget).get('email') || '').trim();
    setPending(true);setError('');
    try {
      const result=await auth.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/redefinir-senha`});
      if(result.error) throw result.error;
      setSent(true);
    } catch {setError('Não foi possível solicitar a recuperação. Aguarde e tente novamente.');}
    finally {setPending(false);}
  }
  return <main className="mx-auto max-w-md px-6 py-12"><Link href="/" aria-label="Voltar ao início"><Brand/></Link><Card className="mt-10 p-8"><h1 className="text-2xl font-semibold">Recuperar senha</h1>{sent?<p role="status" className="mt-5 text-sm leading-6">Se houver uma conta para esse e-mail, você receberá um link. Abra-o neste mesmo navegador.</p>:<form className="mt-6 space-y-4" onSubmit={submit}><p className="text-sm text-muted-foreground">Informe seu e-mail para receber as instruções.</p><label className="block text-sm font-medium" htmlFor="recovery-email">E-mail</label><Input id="recovery-email" name="email" type="email" autoComplete="email" required disabled={!auth || pending}/>{error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}{!loading && !auth?<p role="alert" className="text-sm text-red-700">A autenticação não está configurada.</p>:null}<Button className="w-full" disabled={!auth || pending}>{pending?'Enviando…':'Enviar instruções'}</Button></form>}<Link href="/conta" className="mt-6 block text-sm text-primary hover:underline">Voltar para a conta</Link></Card></main>;
}
