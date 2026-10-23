# Validação da base inicial

Verificações realizadas em 22/10/2026, macOS ARM64:

- API e quatro projetos C#: compilação sem warnings e sem erros.
- 31 testes .NET passaram: JWT ES256, assinatura/emissor/audience/expiração inválidos, membro/anonymous/service_role, validação de seleção, FREE/PRO e período pago. Inclui dois testes em PostgreSQL 18 temporário para migration, RLS e round-trip EF da entidade rica. Container encerrado após a validação.
- 27 testes unitários da extensão passaram.
- Smoke Chromium da extensão passou com fixtures locais: Whop, Hotmart, Kiwify, MP4, legendas, cancelamento, retomada e mudança de curso. Sem acesso a cursos reais.
- `pnpm check` passou; desktop e web compilaram. Builds desktop/web/API executados pelo Nx.
- Cargo test: persistência SQLite, inicialização idempotente e restrição de status passaram.
- Tauri gerou `apps/desktop/src-tauri/target/debug/bundle/macos/Vodown.app` e o app abriu nativamente. É um build de desenvolvimento, sem assinatura de distribuição; Linux e Windows ainda não foram compilados.
- Supabase Auth: endpoint de configurações respondeu HTTP 200 com a chave publicável fornecida. E-mail habilitado; Google e Facebook desabilitados. Nenhuma conta foi criada, nenhum e-mail foi enviado e nenhum login de usuário real foi feito.
- ZIP `dist/vodown-chrome.zip` validado: 34 arquivos, versão 1.6.0, marca incluída, nenhum .env, teste, node_modules ou arquivo .local.

Preview da interface: `screenshots/vodown-desktop.png`.

## Integração de cobrança — 23/10/2026

- 48 testes .NET passaram, sem falhas ou skips, com PostgreSQL 18 local isolado, simulação HTTP local e opt-in do Stripe Sandbox.
- No Stripe Sandbox real: catálogo EUR 500/2500/10000 centavos confirmado; três tipos de Checkout criados, reutilizados e expirados; assinatura com cartão oficial de teste ativada e cancelada. A reconciliação persistida alternou PRO → FREE. Cliente de teste descartável removido ao final.
- O teste de reconciliação acima usa eventos assinados localmente. Separadamente, o Stripe CLI entregou eventos reais `invoice.paid`, `customer.subscription.created` e `payment_intent.succeeded` ao endpoint local, todos com HTTP 200. Esses fixtures não pertenciam a uma conta Vodown mapeada e não concederam acesso.
- Simulação HTTP local validou compra única paga, reembolso, disputa aberta, disputa ganha e erro 500 do provedor. Pagamento hospedado e reembolso de compra única reais ainda não foram homologados; não confundir fixtures com essa validação.
- Duas migrations aplicadas no PostgreSQL remoto Supabase. Conexão com certificado oficial e TLS VerifyFull; `/health/ready` respondeu Healthy.
- Catálogo e portal criados somente no Stripe de testes. API recusa chave de produção. Nenhuma cobrança real foi realizada.

Os resultados de extensão, Rust e bundle nativo acima pertencem à validação anterior. Não representam um motor de download nativo nem a aplicação de planos na extensão, que continuam pendentes.

Verificação final: `pnpm check` passou e os três builds Nx (desktop, web e API) passaram. A página pública local mostra os preços acordados; login/cadastro renderizam sem sessão. Nenhum login real Supabase foi executado. RLS foi confirmado por consulta em todas as quatro tabelas de domínio no banco isolado. PostgreSQL e simulação temporários foram encerrados após os testes.
