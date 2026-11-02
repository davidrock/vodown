import {createClient} from '../vendor/supabase/client.js';
import {createAccountService} from './account.js';
import {persistentAuthStorage} from './persistent-auth.js';
import {supabaseUrl,publishableKey,apiUrl} from '../vendor/supabase/config.js';

const client=supabaseUrl && publishableKey && apiUrl ? createClient(supabaseUrl,publishableKey,{
  auth:{storage:persistentAuthStorage(chrome.storage.local,chrome.storage.session),persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'},
}) : null;
export const account=createAccountService({client,apiUrl,supabaseUrl,identity:chrome.identity});
