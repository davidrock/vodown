import { createClient } from '@supabase/supabase-js';
export function createVodownAuth(url: string | undefined, key: string | undefined, webSession=false) {
  if (!url || !key) return null;
  // Desktop/extension tokens remain in memory until a native secure-storage adapter is added.
  return createClient(url, key, {auth: {persistSession: webSession, autoRefreshToken: true, detectSessionInUrl: webSession,flowType:webSession?'pkce':'implicit'}});
}
