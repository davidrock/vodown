# Vodown

Monorepo Nx com app desktop Tauri/React, landing e conta em Next.js, API ASP.NET Core e extensão Chrome. A identidade aprovada está aplicada nas interfaces.

- [Arquitetura e estado da implementação](docs/ARCHITECTURE.md)
- [Como executar, configurar e testar](docs/DEVELOPMENT.md)
- Desktop preview: `pnpm dev`; app nativo: `pnpm dev:desktop`; API: `pnpm dev:api`; área web: `pnpm dev:web`.

Base em desenvolvimento: login/cadastro Supabase, PostgreSQL remoto migrado, histórico SQLite e cobrança Stripe Sandbox com planos de €5/mês, €25/ano e €100 em compra única. Checkout, portal e reconciliação de permissões estão implementados; o motor de downloads nativo e o envio de aulas da extensão ao desktop ainda estão pendentes. A extensão autônoma continua funcional e ainda não aplica login/planos.

## Ferramentas locais anteriores

**Extensão Chrome autônoma:** veja [EXTENSAO.md](EXTENSAO.md).
Baixa Whop e Hotmart em MP4 sem Python ou FFmpeg instalado no computador.

O projeto também inclui um coletor Hotmart. Veja [HOTMART.md](HOTMART.md):
`./validar-hotmart.sh 'URL'` verifica uma aula sem baixar os vídeos;
`./baixar-hotmart.sh 'URL' --limit 1` faz um download de teste.

Script gratuito, sem quota ou serviço pago, para guardar as aulas de vídeo que
a sua conta consegue abrir normalmente na Whop. Implementação própria em Python,
Playwright, yt-dlp e FFmpeg; não utiliza código das extensões comerciais.

## Usar neste Mac

As dependências Python estão instaladas em `.venv`; FFmpeg e Chrome já existem
neste computador. No Terminal:

```bash
cd /Users/david.martinelli/dev/coursedownloader
./baixar.sh
```

1. Abre um Chrome com perfil separado, dentro deste projeto.
2. Faça login na Whop nesse navegador e abra uma aula do curso. Expanda os módulos
   para que todos os botões das aulas apareçam na lista.
3. Volte ao Terminal e pressione Enter.
4. O script abre cada aula, captura a URL do player, baixa a maior qualidade
   oferecida e salva um MP4 com o número e nome da aula.

O link fornecido do Ecom Paradise já é o padrão. Para outro curso com o mesmo
player/layout:

```bash
./baixar.sh 'https://whop.com/.../app/courses/cors_.../lessons/lesn_.../'
```

Os vídeos ficam em `downloads/Ecom Paradise/`. Para mudar o destino ou testar
somente uma aula:

```bash
./baixar.sh --output 'downloads/Meu curso' --limit 1
```

### Download já realizado

As **9 aulas** do link fornecido já estão em `downloads/Ecom Paradise/`: todas
em **1920×1080 com áudio**, aproximadamente **70,2 minutos** e **539,8 MB** no
total. A validação com ffprobe conferiu a duração de cada arquivo contra a
duração exibida pela Whop, com tolerância de 3 segundos. Detalhes em
`downloads/Ecom Paradise/verification.json`. Uma segunda execução reconheceu
os nove arquivos completos e não transferiu novos segmentos.

Pode interromper com Ctrl+C e executar novamente. `progress.json` registra as
aulas completas; arquivos parciais ficam em `.partial/`. O script verifica o MP4
com ffprobe antes de registrar conclusão. Na próxima execução pula os arquivos
concluídos que ainda têm tamanho e estrutura válidos.

## Apenas investigar / usar URLs já capturadas

```bash
.venv/bin/python whop_downloader.py inspect --chrome
.venv/bin/python whop_downloader.py from-manifest .local/course.private.json
```

`inspect` navega pelas aulas e salva `streams.private.json` sem baixar os vídeos.
`from-manifest` aceita uma lista JSON com `index`, `title`, `page_url`,
`playback_id`, `url` e `drm`. As URLs expiram: se receber 401/403, use novamente
`download` para obter URLs novas pelo player autenticado. Esse modo tenta uma
recarga normal e uma nova captura quando o download falha.

## Como funciona o streaming deste curso

Verificado no navegador em 9 de outubro de 2026:

- O curso **Free Dropshipping Masterclass / Ecom Paradise** apresenta 9 aulas de
  vídeo na lista e usa o componente `mux-player` (`mux-player-react` 3.13.0).
- O player contém um `mux-video` em um Shadow DOM aberto. Seu atributo `src`
  fornece `https://stream.mux.com/<playback-id>.m3u8?token=<JWT>`.
- O manifesto principal oferece resoluções diferentes e uma faixa de áudio
  separada. As playlists de qualidade ficam na CDN `*.edgemv.mux.com`.
- O elemento HTML de vídeo usa uma URL `blob:` porque o player reúne segmentos
  usando Media Source Extensions. Essa URL representa dados temporários no
  navegador; o endereço útil para baixar é o manifesto HLS.
- Miniaturas também têm JWTs, mas são tokens com audiência `t`; o vídeo usa
  audiência `v`. Copiar o token da imagem não dá acesso ao vídeo.
- Nenhum token é gerado, modificado ou forjado. São usadas somente URLs que o
  player recebeu durante o acesso normal da conta.

A [documentação da Mux sobre reprodução assinada](https://www.mux.com/docs/guides/secure-video-playback)
explica a expiração dos JWTs e os diferentes tipos de token. As playlists
descrevem segmentos; o [yt-dlp](https://github.com/yt-dlp/yt-dlp) baixa as faixas e
o FFmpeg reúne vídeo e áudio em MP4, sem reencodar.

Há também um [projeto público sem cobrança declarada, mlapping/whop-downloader](https://github.com/mlapping/whop-downloader),
que usa Playwright e yt-dlp. Sua documentação descreve navegação por teclas e a
arquitetura antiga com iframe. Neste projeto a navegação usa os botões de aulas
observados no layout atual e confere título/ID antes de associar um stream à aula.

## Limites e dados locais

- O coletor atende ao layout observado, com botões `Multimedia • duração` e Mux
  Player. Lista apenas aulas renderizadas; módulos recolhidos, listas virtualizadas,
  PDFs, quizzes e players externos exigem adaptação. Não é uma promessa de
  compatibilidade com todos os cursos Whop.
- A inspeção verifica o manifesto principal e suas playlists antes de transferir
  os segmentos. Se detectar chave de criptografia ou DRM, interrompe aquela
  aula. Não há extração de chaves, acesso a servidores de licença ou remoção
  de marcas d'água. A Mux documenta [DRM separadamente](https://www.mux.com/docs/guides/protect-videos-with-drm).
- O login pertence ao perfil local `.whop-profile/`; não pede senha pelo Terminal.
  Esse perfil e os JSONs com URLs assinadas são privados e estão no `.gitignore`.
  Não os compartilhe: podem conceder acesso enquanto estiverem válidos.
- As URLs do manifesto privado existente foram capturadas da sessão já aberta
  no seu Chrome. O fluxo automático abre um perfil próprio e requer login inicial.

## Instalar em outro computador

Requer Python 3.11+, uv, FFmpeg e Chrome:

```bash
uv sync --cache-dir .local/uv-cache --system-certs
brew install ffmpeg
./baixar.sh
```

Se preferir Chromium do Playwright, instale-o e omita `--chrome`:

```bash
.venv/bin/playwright install chromium
.venv/bin/python whop_downloader.py download
```

## Testes

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Teste adicional de navegação e captura em Chrome isolado, com página de teste
inteiramente local e sem acessar a Whop:

```bash
WHOP_BROWSER_TEST=1 .venv/bin/python -m unittest discover -s tests -v
```
