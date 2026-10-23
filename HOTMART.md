# Hotmart Club — script local

Implementação própria que usa o login normal da sua conta, sem serviço pago e
sem quota de downloads. Aceita URLs de cursos diferentes: nenhum ID de produto,
ID de vídeo ou token fica fixo no coletor. O curso “O Código da Técnica” é apenas
o link padrão para conveniência.

## Validar um curso sem baixar todos os vídeos

```bash
cd /Users/david.martinelli/dev/coursedownloader
./validar-hotmart.sh 'https://hotmart.com/pt-br/club/SEU-CURSO/products/ID'
```

Faça login no Chrome que abrir, deixe o curso solicitado visível e pressione
Enter no Terminal. O script expande os módulos, inventaria os links das aulas
e, por padrão, valida **uma aula**. Confere o acesso aos manifestos e as qualidades
oferecidas sem transferir os segmentos de vídeo. Esse modo não prova que todas
as aulas do curso sejam baixáveis, pois proteção e player podem variar por aula.

Para conferir três aulas:

```bash
./validar-hotmart.sh 'URL-DO-CURSO' --limit 3
```

Para um teste completo de download, limitado a uma aula:

```bash
./baixar-hotmart.sh 'URL-DO-CURSO' --limit 1
```

Para baixar as aulas do curso quando quiser:

```bash
./baixar-hotmart.sh 'URL-DO-CURSO'
```

URLs de aulas, com `/content/...`, também são aceitas. Para “O Código da Técnica”,
o argumento URL pode ser omitido. Cada curso recebe uma pasta própria em
`downloads/Hotmart/<slug-do-curso>/`, com subpastas dos módulos.
Use `--output 'OUTRA-PASTA'` para escolher o destino.

## Retomada e sessão

Os arquivos completos são registrados em `progress.json` somente depois de
ffprobe confirmar vídeo, áudio e duração compatível com a informada pelo player.
Execute novamente para retomar; fragmentos incompletos permanecem em `.partial/`.

O perfil `.hotmart-profile/` mantém o login apenas neste computador. Ele é
separado do seu Chrome habitual e do perfil do Whop. O script não pede sua senha
no Terminal nem usa uma chave da API Hotmart.

`inventory.json` lista os conteúdos; `report.json` registra o resultado por aula.
`streams.private.json` contém URLs temporárias de reprodução e é salvo com
permissões `0600`. Perfil, vídeos e tokens estão no `.gitignore`.
Não compartilhe o perfil ou os manifestos privados.

## O streaming observado

O Hotmart Club coloca o vídeo em um iframe de `cf-embed.play.hotmart.com`.
O JSON servido ao documento do player (`script[type="application/json"]`)
contém `applicationData`, incluindo `mediaCode`, `mediaDuration`, `isDrmEnabled`
e as URLs de `mediaAssets`. A configuração é lida do documento entregue durante
o acesso normal à aula; não se extraem tokens de outros perfis ou contas.

Nos cursos inspecionados, os vídeos usam HLS em `vod-akm.play.hotmart.com`, com
assinaturas temporárias (`hdnts`). As URLs observadas tinham validade de cerca
de 500 segundos. O modo automático captura o stream imediatamente antes de
cada download e faz uma nova navegação autenticada se houver falha.

As playlists incluem AES-128 com `KEYFORMAT=identity`, ou sem `KEYFORMAT`,
e uma URI de reprodução em `contentplayer.hotmart.com`. Isso corresponde ao
HLS AES-128 descrito no [RFC 8216](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4).
O yt-dlp processa o stream autorizado como um cliente HLS normal; FFmpeg reúne
as faixas em MP4, sem reencodar. Não há extração manual de chaves nem acesso a
servidores de licença. Nenhuma assinatura é alterada ou gerada.

Algumas playlists de prévia de busca (`EXT-X-I-FRAME-STREAM-INF`) anunciadas
pelo servidor retornaram 404. São usadas para prévias e não para o vídeo
completo; não são baixadas pelo verificador.

## Compatibilidade real

Validação realizada em dois cursos da conta:

- **O Código da Técnica:** inventário de 33 aulas em 5 módulos; download real
  de amostras em MP4 1080p com áudio e duração conferida. Retomada confirmou
  que uma aula completa não é baixada novamente. O lote foi interrompido
  quando você pediu para limitar o trabalho à validação.
- **Guitar Practice 2.0:** configuração de outro produto, assinatura e vídeo
  reais; validou acesso às playlists e formatos 240p, 360p, 540p, 720p e 1080p
  sem transferir segmentos. Não foi realizado download completo desse curso.

O navegador autenticado já aberto foi usado para capturar as URLs dessas
amostras. A navegação automática do script foi testada com páginas locais
em Chrome isolado; o login inicial do perfil próprio depende de você.

O coletor suporta o **Hotmart Club atual com player nativo e HLS sem DRM**,
incluindo HLS AES-128 comum. URLs e estruturas de aulas são descobertas a cada
execução; a compatibilidade não depende do curso padrão.

Não é possível garantir “qualquer curso da plataforma”: a
[Hotmart oferece proteção DRM](https://hotmart.com/pt-br/player), e produtores
podem escolher players externos ou configurações diferentes. O script recusa
`isDrmEnabled`, proteção proprietária do player, `SAMPLE-AES`, Widevine/FairPlay
e formatos de chave diferentes de `identity`. Aulas inacessíveis, players
externos, DASH/MPD, PDFs e quizzes são reportados; não há exportação desses itens.
Uma aula recusada não é apresentada como baixada.

Há projetos públicos relacionados, como
[HotmartCourseDownloader](https://github.com/diegofcpereira/HotmartCourseDownloader)
e [OmniGet](https://github.com/OpenSelena/omniget). O primeiro documenta um fluxo
de extensão com HLS AES-128; o segundo declara suporte à Hotmart e que pula
aulas com DRM. Eles foram usados para pesquisa; seu código não foi instalado
nem copiado para esta implementação.

## Instalação e testes

As dependências já estão instaladas neste projeto. Em outro computador, requer
Python 3.11+, uv, Chrome e FFmpeg:

```bash
uv sync --cache-dir .local/uv-cache --system-certs
```

Testes unitários e de navegador com páginas locais:

```bash
.venv/bin/python -m unittest discover -s tests -v
WHOP_BROWSER_TEST=1 .venv/bin/python -m unittest discover -s tests -v
```
