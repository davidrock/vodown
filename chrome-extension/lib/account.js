// All token handling stays in the extension's trusted service worker.
export function createAccountService({client,apiUrl,supabaseUrl,identity,request=fetch}) {
  async function session() {
    if(!client || !apiUrl)throw new Error('A conta ainda não foi configurada nesta versão da extensão.');
    const {data,error}=await client.auth.getSession();
    if(error || !data.session?.access_token)throw new Error('Entre na sua conta Vodown para continuar.');
    return data.session;
  }
  async function api(path,token,options={}) {
    let response;
    try {
      response=await request(`${apiUrl}${path}`,{...options,headers:{Authorization:`Bearer ${token}`, ...(options.body ? {'Content-Type':'application/json'} : {})},signal:AbortSignal.timeout(15000)});
    } catch {throw new Error('Não foi possível consultar sua conta. Verifique a conexão e tente novamente.');}
    if(response.status===401)throw new Error('Sua sessão expirou. Entre novamente.');
    if(response.status===403)throw new Error('Seu plano não permite esta operação.');
    if(!response.ok)throw new Error('Não foi possível consultar seu plano. Tente novamente.');
    try{return await response.json();}catch{throw new Error('Não foi possível confirmar suas permissões.');}
  }
  return {
    async bridgeSession(){const current=await session();return {accessToken:current.access_token,userId:current.user.id};},
    async signIn(email,password) {
      if(!client || !apiUrl)throw new Error('A conta ainda não foi configurada nesta versão da extensão.');
      if(typeof email!=='string' || typeof password!=='string' || !email.trim() || !password || email.length>320 || password.length>1024)throw new Error('Informe seu e-mail e senha.');
      try {
        const {error}=await client.auth.signInWithPassword({email:email.trim(),password});
        if(error)throw error;
      } catch {throw new Error('Não foi possível entrar. Confira seu e-mail, sua senha e a confirmação da conta.');}
      return this.status();
    },
    async signInGoogle() {
      if(!client || !apiUrl || !supabaseUrl || !identity)throw new Error('A conta ainda não foi configurada nesta versão da extensão.');
      try {
        const redirect=identity.getRedirectURL('oauth');
        const expected=new URL(redirect);
        if(expected.protocol!=='https:' || expected.username || expected.password || !expected.hostname.endsWith('.chromiumapp.org') || expected.pathname!=='/oauth' || expected.search || expected.hash)throw new Error('invalid_redirect');
        const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect,skipBrowserRedirect:true}});
        if(error || !data.url || !data.flowId)throw new Error('invalid_oauth');
        const authorize=new URL(data.url), supabase=new URL(supabaseUrl);
        if(authorize.origin!==supabase.origin || authorize.pathname!=='/auth/v1/authorize' || authorize.username || authorize.password || authorize.hash)throw new Error('invalid_provider');
        const returned=await identity.launchWebAuthFlow({url:authorize.href,interactive:true});
        if(!returned)throw new Error('canceled');
        const callback=new URL(returned);
        if(callback.origin!==expected.origin || callback.pathname!==expected.pathname || callback.username || callback.password || callback.hash || callback.searchParams.has('error') || callback.searchParams.getAll('code').length!==1 || !callback.searchParams.get('code'))throw new Error('invalid_callback');
        const callbackFlowIds=callback.searchParams.getAll('sb_flow_id');
        if(callbackFlowIds.length>1 || callbackFlowIds.length===1 && callbackFlowIds[0]!==data.flowId)throw new Error('invalid_flow');
        const {data:result,error:exchangeError}=await client.auth.exchangeCodeForSession(callback.searchParams.get('code'),{flowId:data.flowId});
        if(exchangeError || !result.session?.access_token)throw new Error('exchange_failed');
      } catch {throw new Error('Não foi possível entrar com o Google. Tente novamente.');}
      return this.status();
    },
    async signOut() {
      if(!client)return;
      const {error}=await client.auth.signOut({scope:'local'});
      if(error)throw new Error('Não foi possível sair da conta. Tente novamente.');
    },
    async status() {
      if(!client || !apiUrl)return {configured:false,email:null,plan:null};
      const {data,error}=await client.auth.getSession();
      if(error || !data.session?.access_token)return {configured:true,email:null,plan:null};
      const account={configured:true,email:data.session.user.email||null,plan:null};
      try {
        const entitlement=await api('/v1/me/entitlements',data.session.access_token);
        if(entitlement.plan==='free'||entitlement.plan==='pro')account.plan=entitlement.plan;
      } catch { /* Display the account, but never infer access from failed lookup. */ }
      return account;
    },
    async authorize(lessonCount) {
      if(!Number.isSafeInteger(lessonCount) || lessonCount<1)throw new Error('Seleção inválida.');
      const current=await session();
      const result=await api('/v1/me/download-authorizations',current.access_token,{method:'POST',body:JSON.stringify({client:'extension',lessonCount})});
      if(result.allowed!==true)throw new Error('Não foi possível confirmar suas permissões.');
    },
  };
}

export function sessionStorageAdapter(storage) {
  return {
    async getItem(key){const result=await storage.get(key);return typeof result[key]==='string'?result[key]:null;},
    async setItem(key,value){await storage.set({[key]:value});},
    async removeItem(key){await storage.remove(key);},
  };
}
