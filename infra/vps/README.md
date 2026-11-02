# Vodown no VPS existente

Servidor confirmado pela API Hostinger: `srv1864951.hstgr.cloud`, VPS 1864951. O Caddy compartilhado pertence ao projeto `platform-caddy`, em `/opt/platform/caddy/compose.yml`; seu compose usa redes externas `edge` e `storage`. Vodown usará somente `edge`, com aliases por stack. Não criaremos outro proxy nem publicaremos portas de aplicação no host.

O acesso SSH foi confirmado com a identidade local `~/.ssh/vps` após a tentativa com a identidade padrão ser recusada. A rede edge usa `172.16.1.0/24`. Nenhuma configuração remota foi alterada. O domínio ainda será adquirido; `Caddyfile.example` não deve ser ativado com os hostnames fictícios.

## Preparação

1. Criar `/opt/vodown/staging` e `/opt/vodown/production` com acesso do usuário de deploy, Compose e arquivos `.env` privados com permissão 600.
2. Usar nomes de projeto `vodown-staging` e `vodown-production`. Cada stack tem imagens imutáveis e env próprios; não reutilizar banco/chaves entre ambientes.
3. Copiar `.env.example`, `api/.env.example` e `web/.env.example` para arquivos privados. Corrigir `VODOWN_API_ENV_FILE` para `./api/.env` e `VODOWN_WEB_ENV_FILE` para `./web/.env`. Preencher conexão PostgreSQL TLS, Supabase, CORS, hosts e Stripe de testes. Segredos permanecem fora do Git.
4. Confirmar `docker network inspect edge` antes do deploy; `ReverseProxy__KnownNetworks__0` já contém o CIDR observado (`172.16.1.0/24`). Nunca habilitar forwarded headers irrestritos.
5. Validar `docker compose --env-file .env -f compose.yaml config --quiet`. Omitir `--quiet` pode imprimir segredos do ambiente.
6. Aplicar migrations revisadas explicitamente; containers não migram o banco durante a inicialização.
7. Fazer pull e subir apenas o projeto Vodown. Conferir health dos dois containers antes de configurar rotas públicas.
8. Depois de adquirir o domínio e configurar DNS, incorporar os blocos ao Caddyfile existente, validar e recarregar Caddy. Preservar os blocos dos outros produtos.

Os aliases serão `vodown-staging-web:3000` e `vodown-staging-api:8080` (equivalentes de produção com prefixo próprio). O endpoint `/health/ready` consulta o banco; `/health/live` e `/api/health` verificam os processos API/web. HTTPS é terminado no Caddy, com headers aceitos somente da rede configurada.

## Rollback

Registrar o digest anterior de cada imagem antes de implantar. Em falha, restaurar as referências anteriores no `.env` privado e executar `docker compose up -d --wait`. Nunca executar `down` no projeto Caddy nem nos demais produtos. Rollback de imagem não desfaz migration: alterações de schema devem ser compatíveis com a versão anterior ou ter procedimento de restauração separado.

O site lê `VODOWN_PUBLIC_SUPABASE_URL`, `VODOWN_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `VODOWN_PUBLIC_API_URL` ao iniciar cada requisição, permitindo promover a mesma imagem entre ambientes. Esses valores são enviados ao navegador: use somente a chave publicável ou anon do Supabase, nunca uma chave secreta ou service role. Configuração incompleta ou insegura falha no health check.

Ainda pendentes: publicação no registry, usuário/chave restritos para o deploy CircleCI, SMTP/domínios e credenciais de ambientes. O acesso administrativo local já funciona. Este material prepara o deploy e não comprova uma implantação.
