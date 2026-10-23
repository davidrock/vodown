'use client';
import Link from 'next/link';
import { Brand } from '@vodown/ui/brand';
import { Card } from '@vodown/ui/card';
import { Login } from '@vodown/auth/login';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@vodown/ui/button';
import {BillingPanel} from './billing-panel';
import {auth} from '../auth-client';
export default function Account(){
  const [session,setSession]=useState<Session|null>(null);
  useEffect(()=>{const subscription=auth?.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>subscription?.data.subscription.unsubscribe();},[]);
  return <main className={`mx-auto px-6 py-12 ${session?'max-w-5xl':'max-w-md'}`}><Link href="/" aria-label="Voltar ao início"><Brand/></Link><Card className="mt-10 p-8"><h1 className="mb-2 text-2xl font-semibold">Sua conta Vodown</h1><p className="mb-7 text-sm text-muted-foreground">A mesma conta no navegador e no desktop.</p>{session?<><p className="mb-5 text-sm">Conectado como {session.user.email}</p><Button variant="outline" onClick={()=>{void auth?.auth.signOut();}}>Sair</Button><BillingPanel session={session} apiUrl={process.env.NEXT_PUBLIC_API_URL||'http://localhost:5080'}/></>:<Login client={auth}/>}</Card></main>;
}
