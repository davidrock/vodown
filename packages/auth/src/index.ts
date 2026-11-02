import { createClient } from '@supabase/supabase-js';
type AuthStorage = {getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void>; removeItem: (key: string) => Promise<void>};
export function createVodownAuth(url: string | undefined, key: string | undefined, webSession=false, storage?: AuthStorage, detectSessionInUrl=webSession) {
  if (!url || !key) return null;
  return createClient(url, key, {auth: {persistSession: webSession || !!storage, storage, autoRefreshToken: true, detectSessionInUrl,flowType:webSession||storage?'pkce':'implicit'}});
}
