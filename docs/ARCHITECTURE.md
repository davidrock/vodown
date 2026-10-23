# Vodown

## Aplicações e dados

- `apps/desktop`: Tauri 2, Rust, React, Vite e TypeScript. SQLite em `app_data_dir()/vodown.sqlite3` para histórico/fila local. Nenhum vídeo ou URL de playback é enviado ao backend.
- `chrome-extension`: extensão existente MV3, agora com a identidade Vodown. Motor browser/WASM preservado. Ainda não migrada para React nem conectada à autenticação/planos.
- `apps/web`: Next.js para landing e área da conta. Checkout hospedado e portal iniciados pela API; as permissões são determinadas no servidor.
- `apps/api`: ASP.NET Core 10. PostgreSQL do Supabase para assinaturas, clientes Stripe, licenças de compra única e recibos de eventos.
- `packages/ui`: componentes locais no padrão shadcn/ui, Radix Slot, Tailwind 4 e tokens da identidade violeta.
- `packages/auth`: cliente Supabase e formulário de login compartilhado. Desktop com sessão em memória. Web com sessão persistente gerida pelo Supabase no navegador e callbacks PKCE. Login e cadastro por e-mail/senha; recuperação de senha, OAuth via navegador e armazenamento seguro nativo ainda pendentes.

O Nx coordena as tarefas com configurações explícitas por projeto. Os apps podem ser executados e publicados separadamente. `pnpm-lock.yaml` e `Cargo.lock` fixam as resoluções das dependências.

## Backend em quatro projetos

```text
API ────────> Service ────────> Shared
 │               ↑
 └────────> Repository
```

- **API**: endpoints, autenticação JWT, autorização, DI, CORS, OpenAPI e ProblemDetails. Sem regras de cobrança no controller.
- **Service**: domínio organizado por funcionalidade, entidade rica Subscription, políticas FREE/PRO, casos de uso e interfaces específicas de repositório.
- **Repository**: EF Core/Npgsql, mapeamento do domínio e migrations. Implementa as interfaces de Service.
- **Shared**: Value Objects e AssertionConcern; sem EF, dependência de HTTP ou serviços externos.

Sem repositório genérico, AutoMapper, MediatR, event bus ou unidade de trabalho redundante: o DbContext já delimita a persistência. DTOs HTTP separados das entidades de domínio.

## Autenticação e permissões

O usuário entra pelo Supabase Auth. A API valida assinatura assimétrica ES256/RS256, emissor, audience `authenticated`, expiração, role e identificador. O endpoint JWKS é do projeto configurado; nunca vem da requisição do usuário. Rotação de chaves fica a cargo do ConfigurationManager padrão.

Só membros autenticados podem consultar `/v1/me/entitlements` e solicitar `/v1/me/download-authorizations`. O usuário é derivado do token, nunca de um `userId` informado pelo cliente. Não há endpoint para editar plano.

- FREE: uma aula por ação manual na extensão; desktop e lote bloqueados.
- PRO: desktop e lote permitidos com assinatura Active/Trialing dentro do período autorizado, ou licença de compra única válida.
- Cancelamento agendado mantém acesso até o fim do período. PastDue/Unpaid/Canceled não liberam PRO.
- Ausência de assinatura e de licença válida retorna FREE. Erro no banco não libera PRO nem simula uma consulta bem-sucedida.

Estas regras já estão implementadas e testadas na API; a extensão legada ainda não as aplica. Uma resposta de autorização não é um sistema de licença inviolável: o cliente local é modificável. O limite FREE exige integração com a extensão, e o desktop ainda precisa verificar o plano no motor nativo antes de iniciar novos jobs.

## PostgreSQL

Supabase Auth é dono da identidade; não duplicamos senhas ou o cadastro de autenticação. A tabela `vodown.subscriptions` contém o identificador do usuário, identificadores Stripe, estado, período pago e versão temporal da atualização.

O schema `vodown` não deve ser exposto na Data API. A migration habilita RLS e remove acesso dos papéis de navegador `anon` e `authenticated`. A conexão do backend precisa de um papel autorizado no schema; na implantação inicial, a credencial do banco fica somente no servidor. Uma chave publicável jamais dá permissão para gravar assinaturas.

Migrations são aplicadas explicitamente, não a cada inicialização da API. O banco remoto foi conectado com TLS VerifyFull e as duas migrations foram aplicadas em 23/10/2026. O histórico fica no schema privado `vodown`.

## Etapas seguintes

1. Concluir configuração e validar login real no Supabase; cadastro, confirmação e recuperação de senha.
2. Homologar os pagamentos hospedados de ponta a ponta e preparar a publicação da API e o webhook público. Stripe Sandbox já tem checkout mensal/anual/compra única, portal, verificação de assinatura, recibos idempotentes e reconciliação do estado. A tela de sucesso nunca concede PRO.
3. Autenticação e limites na extensão; depois migração da interface para React/shadcn sem alterar a captura verificada.
4. Pareamento Native Messaging com allowlist da extensão e mesma conta. Motor nativo de downloads, FFmpeg empacotado, cancelamento/retomada e SQLite.
5. OAuth com PKCE pelo navegador do sistema e armazenamento nativo seguro da sessão.
6. CI em Linux/macOS/Windows, instaladores assinados, atualização e revisão da licença da distribuição FFmpeg.

Ainda não há download nativo, pareamento ou mecanismo de atualização implementados nesta base. O Stripe funciona somente no ambiente de testes. A interface mostra esses estados honestamente e não contém aulas ou assinaturas de demonstração.
