# CircleCI e entrega Vodown

## Estado

A configuração inicial de `origin/circleci-project-setup` falhou no job `node/test`, passo `Installing NPM packages`: `npm ci` exigiu um `package-lock.json` na raiz. O monorepo usa pnpm. Evidência: pipeline 1, workflow `07231cf4-07a2-4a5e-a5f5-e56baa37557f`, job 1, em 30/10/2026. Node 16 também era incompatível com os requisitos atuais.

O novo setup usa Node 24.22.1/pnpm 11.17.0 e configuração dinâmica. Habilite Dynamic Config no projeto CircleCI. Não é necessário integrar o commit de exemplo para usar a configuração substituta.

## Seleção

`tools/ci/select.mjs` determina o intervalo, exporta o grafo Nx e calcula os projetos tocados e seus consumidores transitivos, combinando o resultado com `tools/ci/impact.mjs`. Configuração desconhecida ou metadados indisponíveis provocam execução completa. Arquivos globais recebem regras por tecnologia: `Directory.Build.props` aciona backend; `pnpm-lock.yaml` aciona consumidores Node. Isso evita que a classificação global conservadora do Nx execute .NET por uma simples mudança no lockfile Node.

- PR: ancestral comum com o SHA da branch de destino consultada no GitHub.
- `master`: último pipeline cujo workflow `verify` terminou com sucesso, consultado na API pública CircleCI. Se a consulta não funcionar, execução completa. `CIRCLECI_READ_TOKEN` é opcional e não deve ser exposto a PRs; sem ele o fallback continua seguro.
- Feature branch sem PR: ancestral comum com `origin/master`.
- Parâmetro de pipeline `full: true`: execução completa. Criar no painel CircleCI um schedule semanal para `master` com esse parâmetro; também pode ser disparado manualmente.
- Renomeações são tratadas como exclusão + adição, incluindo caminhos com espaços. Arquivos desconhecidos executam todas as áreas. Documentação isolada executa somente o check leve.

O relatório `impact.json` e a configuração de continuação são artefatos do setup. O job `ci-complete` depende de todos os jobs selecionados e deve ser exigido pela proteção da branch. Configure isso no GitHub após o primeiro pipeline publicar o check.

## Jobs

Backend usa .NET 10 e PostgreSQL 18 isolado. Testes Stripe Sandbox reais não rodam em PRs; testes opcionais da simulação Postman continuam skipped até configurar o serviço de simulação no CI. Não configurar chaves Stripe ou banco de produção nesse job.

Web e interface desktop usam pnpm com lockfile congelado. A extensão mantém seu lockfile npm separado para FFmpeg WASM. Builds de verificação usam valores públicos fictícios e não são artefatos publicáveis de produção.

Desktop compila em macOS ARM, gera também bundle Intel por cross-compilation e compila/testa em Windows x64. O bundle Intel ainda exige execução real em máquina Intel na homologação. CircleCI precisa ter créditos/acesso aos executores macOS e Windows configurados. Bundles de CI são sem assinatura.

Validação local:

```sh
node --test tools/ci/*.test.mjs
node tools/ci/validate-repository.mjs
node tools/ci/workflow.mjs /tmp/vodown-continuation.json
circleci config validate .circleci/config.yml
circleci config validate /tmp/vodown-continuation.json
```

## Deploy e releases

CI07/CI08 ainda dependem de registry, contexts, acesso SSH e ambientes. Não há publicação nem deploy automático habilitados nesta configuração inicial. Não confundir aprovação sintática com uma execução remota bem-sucedida.

Contexts previstos: `vodown-registry`, `vodown-staging`, `vodown-production`, `vodown-signing`. Restringir a branch `master` e usuários autorizados; forks e PRs não recebem segredos de deploy. Produção exige aprovação e imagens imutáveis. Chaves de assinatura nativa e do updater são distintas.

O frontend Next lê as variáveis públicas em runtime, permitindo que a mesma imagem receba configurações distintas em staging e produção. A publicação e a promoção automática dessa imagem ainda precisam ser implementadas e homologadas.
