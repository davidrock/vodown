import type { Metadata } from 'next';
import '@vodown/ui/styles.css';
import {AuthCallback} from './auth-callback';
import {connection} from 'next/server';
import {configScript,readPublicConfig} from './runtime-config';
export const metadata: Metadata = {title:'Vodown — seus cursos com você',description:'Organize seus downloads de aulas com Vodown.'};
export default async function Layout({children}:{children:React.ReactNode}) {
  await connection();
  const config=readPublicConfig(process.env);
  return <html lang="pt-BR"><head><script dangerouslySetInnerHTML={{__html:configScript(config)}}/></head><body><AuthCallback/>{children}</body></html>;
}
