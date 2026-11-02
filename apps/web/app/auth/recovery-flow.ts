import type { SupabaseClient } from '@supabase/supabase-js';

// A valid ordinary login code must not be mistaken for a recovery grant.
export async function exchangeRecoveryCode(client: SupabaseClient, code: string, flowId?: string): Promise<string> {
  let recoveredUser: string | null = null;
  const {data:{subscription}} = client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) recoveredUser = session.user.id;
  });
  try {
    const {data,error} = await client.auth.exchangeCodeForSession(code, flowId ? {flowId} : undefined);
    if (error || !data.session || !recoveredUser || data.session.user.id !== recoveredUser) throw new Error('invalid_recovery');
    return recoveredUser;
  } finally { subscription.unsubscribe(); }
}

export function passwordError(password: string, confirm: string): string | null {
  if (password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (password !== confirm) return 'As senhas não coincidem.';
  return null;
}
