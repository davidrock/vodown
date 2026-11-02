'use client';
import {useEffect} from 'react';
import {getAuth} from './auth-client';
export function AuthCallback() {
  useEffect(()=>{
    const auth=getAuth();
    const {data}=auth?.auth.onAuthStateChange((event,session)=>{
      if(window.location.pathname==='/redefinir-senha' || event==='PASSWORD_RECOVERY')return;
      if(session && window.location.pathname!=='/conta' && (new URLSearchParams(window.location.search).has('code')||window.location.hash.includes('access_token')))
        window.location.replace('/conta');
    })||{data:null};
    return()=>data?.subscription.unsubscribe();
  },[]);
  return null;
}
