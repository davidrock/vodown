import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@vodown/ui/button';
import { Input } from '@vodown/ui/input';

export function Login({client}: {client: SupabaseClient | null}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [signup,setSignup]=useState(false);
  const [notice,setNotice]=useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setError('');setNotice('');
    try {
      const credentials={email:String(data.get('email')),password:String(data.get('password'))};
      const {error} = signup?await client.auth.signUp(credentials):await client.auth.signInWithPassword(credentials);
      if (error) setError('Não foi possível entrar. Confira seu e-mail, sua senha e a confirmação da conta.');
      else if(signup)setNotice('Se o cadastro puder ser realizado, você receberá um e-mail de confirmação. Depois, entre com sua senha.');
    } catch { setError('Não foi possível conectar. Tente novamente.'); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    <div className="space-y-2"><label htmlFor="email" className="text-sm font-medium">E-mail</label><Input id="email" name="email" type="email" autoComplete="email" required disabled={!client || pending}/></div>
    <div className="space-y-2"><label htmlFor="password" className="text-sm font-medium">Senha</label><Input id="password" name="password" type="password" autoComplete={signup?'new-password':'current-password'} minLength={signup?8:undefined} required disabled={!client || pending}/></div>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {!client ? <p role="status" className="text-sm text-muted-foreground">Login disponível assim que o projeto Supabase for conectado.</p> : null}
    {notice?<p role="status" className="text-sm text-primary">{notice}</p>:null}
    <Button type="submit" className="w-full" disabled={!client || pending}>{pending ? 'Aguarde…' : signup?'Criar minha conta':'Entrar na minha conta'}</Button>
    <Button type="button" variant="ghost" className="w-full" disabled={pending} onClick={()=>{setSignup(value=>!value);setError('');setNotice('');}}>{signup?'Já tenho conta':'Criar uma conta gratuita'}</Button>
  </form>;
}
