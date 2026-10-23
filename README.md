# Vodown

O Vodown é um app para organizar e guardar localmente as aulas que o usuário tem autorização para baixar. A proposta é combinar uma extensão do Chrome, que encontra aulas na plataforma aberta pelo usuário, com um app desktop para organizar downloads e arquivos.

> O projeto está em desenvolvimento. A extensão autônoma existente continua utilizável, e a base de autenticação e cobrança está preparada em ambiente de testes. O motor nativo do desktop e a integração de planos na extensão ainda não foram concluídos.

## O que existe hoje

- **Extensão Chrome:** extensão Manifest V3 com captura e downloads por navegador para Whop, Hotmart e Kiwify, nos formatos de vídeo observados e implementados. Inclui legendas opcionais e opções de qualidade e destino. A versão independente não exige Python nem FFmpeg instalados no computador. Ela ainda não faz login no Vodown nem aplica os limites dos planos.
- **Desktop:** app Tauri 2 com interface React, Vite e TypeScript. Já tem identidade visual, tela de conta, preferências e histórico local SQLite. A interface está em desenvolvimento; o motor nativo de downloads e a comunicação entre o app e a extensão ainda estão pendentes.
- **Site e conta:** app Next.js com landing page, cadastro e login Supabase por e-mail, além de uma área de cobrança. O fluxo de checkout usa a página hospedada do Stripe.
- **API:** ASP.NET Core 10 com autenticação por JWT do Supabase, consulta de permissões, cobrança Stripe e acesso ao PostgreSQL.
- **Dados:** Supabase Auth administra as contas. O PostgreSQL guarda assinaturas, licenças do plano vitalício e recibos de webhooks. O SQLite local guarda o histórico do desktop. Os vídeos permanecem no computador do usuário.

## Planos planejados

| Plano | Preço | Acesso previsto |
| --- | ---: | --- |
| FREE | Gratuito | Uma aula por ação manual na extensão |
| PRO mensal | €5/mês | Recursos PRO durante a assinatura |
| PRO anual | €25/ano | Recursos PRO durante a assinatura |
| PRO vitalício | €100, pagamento único | Licença permanente dos recursos PRO do Vodown |

Os preços já estão cadastrados no Stripe de testes. O Checkout e o processamento de eventos ainda não estão abertos para cobranças reais. “Vitalício” refere-se à licença do Vodown; não altera os direitos ou a duração de acesso aos cursos nas plataformas de origem.

## Arquitetura

Este é um monorepo Nx com aplicações independentes e pacotes compartilhados:

```text
apps/
  desktop/       Tauri 2 + Rust + React
  web/           Next.js: site e conta
  api/           ASP.NET Core: autenticação, permissões e cobrança
  api-tests/     testes da API e do domínio
packages/
  auth/          integração e componentes de autenticação Supabase
  ui/            componentes e estilos compartilhados
chrome-extension/ extensão Chrome Manifest V3
```

A API está dividida em quatro camadas: **API** para endpoints e autenticação, **Service** para regras e casos de uso, **Repository** para PostgreSQL/EF Core e **Shared** para objetos de valor e validações do domínio. O Supabase é a fonte de identidade; a API valida o JWT e determina o plano no servidor. O frontend não pode conceder acesso PRO por conta própria.

## Tecnologias

- Monorepo e tarefas: Nx, pnpm e TypeScript.
- Desktop: Tauri 2, Rust, React e Vite.
- Site: Next.js.
- Interface: componentes locais no padrão shadcn/ui, Radix e Tailwind CSS.
- API e domínio: C# / ASP.NET Core 10.
- Autenticação e banco: Supabase Auth e PostgreSQL com Entity Framework Core/Npgsql.
- Pagamentos: Stripe Checkout, Customer Portal e webhooks assinados.
- Histórico local: SQLite.

## Começar a desenvolver

### Requisitos

Node.js 24, pnpm 11 e .NET SDK 10. Para compilar ou abrir o desktop nativo, também são necessários Rust e os pré-requisitos do Tauri para o sistema operacional. Para PostgreSQL local, use Docker Compose.

### Instalar dependências

```sh
pnpm install --frozen-lockfile
dotnet tool restore
dotnet restore Vodown.slnx
```

### Executar as aplicações

```sh
pnpm dev:web       # site e conta em http://localhost:3000
pnpm dev:api       # API em http://localhost:5080
pnpm dev           # preview web da interface desktop
pnpm dev:desktop   # janela nativa Tauri
```

Para autenticação local, copie `.env.example` para `.env` e configure as variáveis públicas do Supabase. O app web também precisa das variáveis `NEXT_PUBLIC_SUPABASE_*` e `NEXT_PUBLIC_API_URL` em `apps/web/.env.local`. A API precisa da conexão PostgreSQL e das chaves de teste do Stripe em configuração local privada. Nunca coloque senhas do banco ou segredos do Stripe em arquivos versionados, no frontend ou na extensão.

Veja [Desenvolvimento](docs/DEVELOPMENT.md) para configurar ambiente, banco, migrations, Stripe Sandbox e testes. Veja [Arquitetura](docs/ARCHITECTURE.md) para o desenho das camadas e o estado das integrações.

## Comandos úteis

```sh
pnpm check          # checagem TypeScript
pnpm build          # builds desktop, web e API
pnpm test           # testes da API e da extensão
pnpm package:extension
```

As verificações de PostgreSQL e Stripe Sandbox exigem configuração local própria; detalhes e limites estão em [Validação](docs/VALIDATION.md). Não use banco de produção para testes.

## Extensão independente e ferramentas anteriores

A extensão pode ser carregada no Chrome pelo diretório `chrome-extension/` em modo de desenvolvedor. Consulte [guia da extensão](chrome-extension/LEIA-ME.md) para instalação e opções. O comportamento específico da captura ainda está isolado da integração de conta do produto.

O repositório também mantém scripts locais anteriores para Whop e Hotmart. Eles são ferramentas separadas do app desktop e não representam suporte universal a cursos ou plataformas. Consulte [Whop](EXTENSAO.md) e [Hotmart](HOTMART.md) antes de usá-los.

## Documentação

- [Arquitetura e estado do produto](docs/ARCHITECTURE.md)
- [Configuração e desenvolvimento](docs/DEVELOPMENT.md)
- [Contrato da API de cobrança](docs/BILLING-CONTRACT.md)
- [Verificações realizadas e limitações](docs/VALIDATION.md)
- [Guia da extensão Chrome](chrome-extension/LEIA-ME.md)

Use a ferramenta apenas com conteúdo cujo download esteja autorizado para sua conta. O Vodown não deve contornar DRM, controles de acesso ou restrições da plataforma.
