'use client';
import {useState, type FormEvent} from 'react';
import Link from 'next/link';
import {Button} from '@vodown/ui/button';
import {Input} from '@vodown/ui/input';
import {getAuth} from '../auth-client';
import {passwordError} from './recovery-flow';

export function PasswordForm({userId}: {userId:string}) {
  const [pending,setPending]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth=getAuth();
    if (!auth || pending) return;
    const data=new FormData(event.currentTarget), password=String(data.get('password') || ''), confirm=String(data.get('confirm') || '');
    const validation=passwordError(password,confirm);
    if(validation){setError(validation);return;}
    setPending(true);setError('');
    try {
      const {data:current,error:sessionError}=await auth.auth.getSession();
      if(sessionError || current.session?.user.id!==userId) throw new Error('session_changed');
      const {error:updateError}=await auth.auth.updateUser({password});
      if(updateError)throw updateError;
      setDone(true);
    } catch {setError('Não foi possível alterar a senha. Confira sua sessão ou solicite um novo link.');}
    finally {setPending(false);}
  }
  if(done)return <div className="mt-6 space-y-5"><p role="status" className="text-sm">Senha atualizada com sucesso.</p><Link href="/conta" className="text-sm text-primary hover:underline">Ir para minha conta</Link></div>;
  return <form className="mt-6 space-y-4" onSubmit={submit}><div className="space-y-2"><label className="text-sm font-medium" htmlFor="new-password">Nova senha</label><Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending}/></div><div className="space-y-2"><label className="text-sm font-medium" htmlFor="confirm-password">Confirme a senha</label><Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={8} required disabled={pending}/></div>{error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}<Button className="w-full" disabled={pending}>{pending?'Salvando…':'Salvar nova senha'}</Button></form>;
}
