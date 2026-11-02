'use client';
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createVodownAuth} from '@vodown/auth';
import type {PublicConfig} from './runtime-config';

declare global { interface Window { __VODOWN_PUBLIC_CONFIG__?:PublicConfig|null } }
let singleton:SupabaseClient|null|undefined;

export function publicConfig():PublicConfig|null {
  return typeof window==='undefined' ? null : window.__VODOWN_PUBLIC_CONFIG__ ?? null;
}
export function getAuth():SupabaseClient|null {
  if(typeof window==='undefined')return null;
  if(singleton===undefined){
    const config=publicConfig();
    const recovery=window.location.pathname==='/redefinir-senha';
    singleton=createVodownAuth(config?.supabaseUrl,config?.publishableKey,true,undefined,!recovery);
  }
  return singleton;
}
export function useAuth():{auth:SupabaseClient|null;loading:boolean} {
  const [state,setState]=useState<{auth:SupabaseClient|null;loading:boolean}>({auth:null,loading:true});
  useEffect(()=>{setState({auth:getAuth(),loading:false});},[]);
  return state;
}
