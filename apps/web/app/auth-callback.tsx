'use client';
import {useEffect} from 'react';
import {auth} from './auth-client';
export function AuthCallback() {
  useEffect(()=>{
    const {data}=auth?.auth.onAuthStateChange((event,session)=>{
      if(session && window.location.pathname!=='/conta' && (new URLSearchParams(window.location.search).has('code')||window.location.hash.includes('access_token')))
        window.location.replace('/conta');
    })||{data:null};
    return()=>data?.subscription.unsubscribe();
  },[]);
  return null;
}
