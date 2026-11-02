const projectUrl='https://oqwidyxobduhddbvopkt.supabase.co';
export function publicConnection() {
  let key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  try {key ||= localStorage.getItem('vodown-public-key') || '';} catch { /* Storage can be unavailable in preview. */ }
  return {url:import.meta.env.VITE_SUPABASE_URL || projectUrl,key};
}
export async function configureConnection(key:string) {
  key=key.trim();
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))throw new Error('Use a chave publicável do projeto (sb_publishable_…).');
  const response=await fetch(`${projectUrl}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('O Supabase recusou essa chave. Confira o projeto e a chave publicável.');
  localStorage.setItem('vodown-public-key',key);
}

export async function googleAvailable(signal:AbortSignal):Promise<boolean> {
  const {url,key}=publicConnection();
  if(!key)return false;
  const response=await fetch(`${url}/auth/v1/settings`,{headers:{apikey:key},signal});
  if(!response.ok)return false;
  const settings=await response.json();
  return settings.external?.google===true;
}
