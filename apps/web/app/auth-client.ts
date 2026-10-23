'use client';
import {createVodownAuth} from '@vodown/auth';
export const auth=createVodownAuth(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,true);
