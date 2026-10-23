import type { Metadata } from 'next';
import '@vodown/ui/styles.css';
import {AuthCallback} from './auth-callback';
export const metadata: Metadata = {title:'Vodown — seus cursos com você',description:'Organize seus downloads de aulas com Vodown.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body><AuthCallback/>{children}</body></html>;}
