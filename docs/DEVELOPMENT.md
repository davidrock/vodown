# Desenvolvimento Vodown

Requisitos: Node 24 LTS, pnpm 11, .NET SDK 10 e, para o desktop nativo, Rust estável e os pré-requisitos Tauri de cada sistema operacional. Python não é necessário ao produto. O teste legado Chromium da extensão usa um ambiente Python de desenvolvimento.

```sh
pnpm install --frozen-lockfile
dotnet tool restore
dotnet restore Vodown.slnx
```

## Interfaces

```sh
pnpm dev              # Preview React do desktop em http://127.0.0.1:1420
pnpm dev:desktop      # Janela Tauri nativa
pnpm dev:web          # Landing/conta em http://localhost:3000
pnpm dev:api          # API em http://localhost:5080
```

Copie `.env.example` para `.env` na raiz para o desktop. Para o web, crie `apps/web/.env.local` com as variáveis públicas `NEXT_PUBLIC_SUPABASE_*` e `NEXT_PUBLIC_API_URL` do exemplo. O site também aceita as variáveis `VODOWN_PUBLIC_SUPABASE_URL`, `VODOWN_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `VODOWN_PUBLIC_API_URL`, usadas em runtime nos containers. É seguro usar a chave publicável do Supabase; nunca use `service_role`, secret key, senha do banco ou segredo Stripe nas interfaces.

Para recuperação de senha, inclua `http://localhost:3000/redefinir-senha` nos redirect URLs do Supabase de desenvolvimento e, quando existirem, os endereços HTTPS equivalentes de staging e produção nos respectivos projetos. Configure o envio de e-mails e mantenha o template de recuperação do Supabase com o link de confirmação. O fluxo usa PKCE: solicite o link e abra-o no mesmo navegador; uma nova solicitação pode invalidar um fluxo anterior em andamento. O desktop abre o site no navegador padrão usando `VITE_WEB_URL`; em builds de produção configure essa variável com a origem HTTPS do site. Sem ela, a interface exibirá uma mensagem em vez de abrir um endereço arbitrário. Não inclua segredos no valor.

Fluxo a homologar com conta descartável: solicitar recuperação, abrir o link no mesmo navegador, definir senha, entrar com a nova senha e verificar link expirado/reutilizado. A API de testes simulada cobre a troca PKCE, mas não comprova envio de e-mail, configuração do Supabase nem abertura de navegador em Windows/macOS.

Para preparar um banco local isolado, execute `node tools/setup-local-api.mjs`. O script gera uma senha privada em `.local/vodown-server-secrets.json`, preserva uma configuração existente e sobe o projeto Compose `vodown-development`. Em instalações com Compose separado, defina `VODOWN_COMPOSE_EXECUTABLE=docker-compose`. Depois aplique as migrations com `node tools/api-local.mjs ef database update --project apps/api/Vodown.Repository --startup-project apps/api/Vodown.API` e execute `pnpm dev:api`. O banco local começa sem assinaturas; ele não importa planos de ambientes remotos.

Configure a conexão da API com Secret Manager ou variável de ambiente `ConnectionStrings__Vodown`, em formato Npgsql:

O projeto API já possui `UserSecretsId`; use `dotnet user-secrets set 'ConnectionStrings:Vodown' '<conexão>' --project apps/api/Vodown.API` localmente, sem enviar a senha pelo chat.

```text
Host=<host>;Port=5432;Database=postgres;Username=<usuario>;Password=<senha>;SSL Mode=VerifyFull
```

Use o host, usuário, porta e certificados indicados no painel Connect do Supabase. Se precisar de pooler, prefira session mode para o EF e mantenha migrations em conexão apropriada. Não coloque credenciais em appsettings versionado.

```sh
dotnet ef database update --project apps/api/Vodown.Repository --startup-project apps/api/Vodown.API
```

Revise o SQL antes de aplicar no remoto. Nenhuma migration é aplicada automaticamente. `/health/live` verifica o processo; `/health/ready` verifica uma consulta ao schema real. Sem banco configurado, readiness retorna 503.

## Verificação

```sh
pnpm check
pnpm build
pnpm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm package:extension
```

Os testes PostgreSQL são opcionais e aparecem como skipped sem `VODOWN_TEST_DATABASE`. Use um banco local isolado, nunca produção. `compose.yaml` fornece um PostgreSQL local na porta 55439 e exige `VODOWN_LOCAL_DB_PASSWORD`.

Para criar um ZIP da extensão com conta habilitada, exporte no shell as três variáveis públicas `VODOWN_EXTENSION_SUPABASE_URL`, `VODOWN_EXTENSION_SUPABASE_PUBLISHABLE_KEY` e `VODOWN_EXTENSION_API_URL` e execute `pnpm package:extension`. As origens devem constar em `chrome-extension/manifest.json`; adicione as origens exatas de staging/produção ao manifesto de cada distribuição. O gerador rejeita chaves secretas/service_role. Sem as três variáveis, gera uma extensão sem conta configurada que bloqueia novos downloads. Os arquivos gerados `chrome-extension/vendor/supabase/client.js` e `config.js` ficam fora do Git; `client.js` é gerado a partir do lockfile e `config.js` é específico do ambiente; gere-o também antes de carregar a extensão diretamente do diretório. O modelo `config.example.js` documenta o formato. A configuração contém somente valores públicos; não use senhas ou segredos.

Para login Google, configure o provedor Google no Supabase com um cliente OAuth **web** do Google Cloud, consentimento e callback do Supabase conforme o painel do projeto. Cadastre os destinos do site (por exemplo, `http://localhost:3000/conta`) e `https://<id-da-extensao>.chromiumapp.org/oauth` na lista de redirect URLs do Supabase. Obtenha o ID da extensão em `chrome://extensions`; o ID de desenvolvimento precisa de configuração própria e o ID publicado na Chrome Web Store deve ser estável. O client secret fica somente no Supabase, nunca no pacote. O fluxo da extensão usa Chrome Identity e PKCE, valida a origem/caminho retornados e bloqueia troca de conta enquanto uma operação estiver ativa. Login Google real ainda precisa de homologação com o provedor configurado.

Para o desktop, inclua `com.vodown.desktop://auth/callback/**` nos redirect URLs do projeto Supabase correspondente. O app instalado registra o esquema de URL, abre o navegador do sistema e aceita somente o retorno associado à tentativa pendente no armazenamento seguro; a tentativa expira após dez minutos. O código é trocado via PKCE uma única vez, inclusive quando o app é aberto pelo retorno. Os plugins de deep link e instância única são necessários para encaminhar a URL ao app já aberto no Windows. Uma build de desenvolvimento sem registro do protocolo no sistema pode abrir o navegador, mas não receber o retorno: homologue usando instaladores para macOS e Windows. Nenhum provider Google foi configurado nem autenticado nesta implementação.

O smoke browser anterior (`chrome-extension/tests/browser_smoke.py`) usa fixtures de vídeo locais e ainda precisa ser adaptado para autenticação e autorização da API; não representa uma validação ponta a ponta da versão atual. Para carregar a extensão preparada, use `chrome-extension/` no modo desenvolvedor do Chrome ou o ZIP `dist/vodown-chrome.zip`.

## Marca

Logo aprovada: `assets/branding/vodown-logo-v4.png`. `node tools/prepare-brand.mjs` prepara cópias recortadas, símbolo e ícones da extensão sem substituir a arte original. `pnpm --dir apps/desktop tauri icon src-tauri/icons/icon.png --output src-tauri/icons` gera os formatos nativos.

## Ambiente restrito de agentes

Se Nx não puder abrir sockets, use `NX_DAEMON=false NX_ISOLATE_PLUGINS=false`. Se o MSBuild não puder usar seu servidor, use `DOTNET_CLI_USE_MSBUILD_SERVER=0` e `-m:1 -nr:false -p:UseSharedCompilation=false`. O build web usa Webpack para funcionar também neste ambiente.

Nesta máquina, Rust foi instalado somente em `.local/cargo` e `.local/rustup`, sem alterar o PATH global. Para usá-lo, adicione `.local/cargo/bin` ao PATH da sessão e defina `CARGO_HOME` e `RUSTUP_HOME` para esses diretórios. Esses arquivos não entram no produto ou no versionamento.

## Stripe Sandbox

O ambiente aceita somente `sk_test_`. Configure no servidor `Stripe:SecretKey`, `WebhookSecret`, `MonthlyPriceId`, `AnnualPriceId`, `LifetimePriceId`, `PortalConfigurationId` e `WebBaseUrl`. O arquivo privado `.local/vodown-server-secrets.json` é lido por `tools/api-local.mjs`; nunca o distribua com o app, extensão ou frontend. Os caminhos de certificado da conexão são locais à máquina e devem ser ajustados em cada implantação.

```sh
node tools/setup-stripe-test.mjs  # catálogo idempotente: €5/mês, €25/ano, €100 única
node tools/stripe-listen.mjs     # CLI oficial em .local/stripe; grava segredo de assinatura privado
pnpm dev:api                    # inicie/reinicie após o listener atualizar o segredo
```

O listener encaminha para localhost e precisa permanecer aberto durante os testes. Não há webhook público de produção configurado. A compra única é uma licença do Vodown. Reembolso ou disputa suspende a licença; disputa ganha permite reconciliar novamente. Veja `BILLING-CONTRACT.md`.

A simulação Postman é local e não exige conta: `postman simulation run postman/simulations/billing.sim.yaml --port 4900 --no-history`. Use `VODOWN_STRIPE_SIMULATION=http://127.0.0.1:4900/stripe` nos testes. O teste real requer `VODOWN_RUN_STRIPE_SANDBOX=1`, arquivo privado configurado e `VODOWN_TEST_DATABASE` obrigatoriamente local. Ele cria objetos descartáveis somente em Stripe test e os remove ao final; nunca use um banco remoto nesse teste.
