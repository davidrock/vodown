export type Entitlements = {plan: 'free'|'pro'; desktopAllowed: boolean; batchAllowed: boolean; maxLessonsPerAction: number|null};
export async function getEntitlements(token: string, signal: AbortSignal): Promise<Entitlements> {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:5080';
  const response = await fetch(`${base}/v1/me/entitlements`, {headers:{Authorization:`Bearer ${token}`}, signal});
  if (!response.ok) throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível consultar seu plano. Tente novamente.');
  return response.json() as Promise<Entitlements>;
}
