import type {SupabaseClient} from '@supabase/supabase-js';
export const consentKey='sb-vodown-trusted-extension-v1';
type Storage={getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>};
export function pairingConsent(client:SupabaseClient,storage:Storage) {
  return {
    async inspect(pending:{nonce:string;accessToken:string},desktopUserId:string) {
      const {data,error}=await client.auth.getUser(pending.accessToken);
      if(error)throw new Error('Não foi possível validar a sessão da extensão. Entre novamente e tente conectar.');
      if(!data.user || data.user.id!==desktopUserId)throw new Error('A extensão precisa estar conectada à mesma conta deste aplicativo.');
      let trusted=false;
      const value=await storage.getItem(consentKey);
      if(value){try{trusted=JSON.parse(value).userId===data.user.id;}catch{/* Require new consent if stored data is invalid. */}}
      return {nonce:pending.nonce,email:data.user.email||'Sua conta',userId:data.user.id,trusted};
    },
    trust(userId:string){return storage.setItem(consentKey,JSON.stringify({userId}));},
    revoke(){return storage.removeItem(consentKey);},
  };
}
