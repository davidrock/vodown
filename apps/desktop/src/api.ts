export type Entitlements = {plan: 'free'|'pro'; desktopAllowed: boolean; batchAllowed: boolean; maxLessonsPerAction: number|null};
export async function getEntitlements(token: string, signal: AbortSignal): Promise<Entitlements> {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:5080';
  let response:Response;
  try {response = await fetch(`${base}/v1/me/entitlements`, {headers:{Authorization:`Bearer ${token}`}, signal});}
  catch(error) {if(signal.aborted)throw error;throw new Error('Não foi possível conectar à API do Vodown. Verifique se o serviço está disponível e atualize seu plano.');}
  if (!response.ok) throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível consultar seu plano. Tente novamente.');
  return response.json() as Promise<Entitlements>;
}

export async function activateLocalPro(token:string,signal:AbortSignal) {
  if(!import.meta.env.DEV || import.meta.env.VITE_LOCAL_PRO_TEST!=='true')return;
  const base=import.meta.env.VITE_API_URL || 'http://localhost:5080';
  const origin=new URL(base);
  if(origin.protocol!=='http:' || !['localhost','127.0.0.1'].includes(origin.hostname))throw new Error('Licença de teste disponível somente na API local.');
  const response=await fetch(`${base}/v1/development/local-pro`,{method:'POST',headers:{Authorization:`Bearer ${token}`},signal});
  if(!response.ok)throw new Error('Não foi possível ativar o PRO local de desenvolvimento.');
}
