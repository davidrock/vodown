# Vodown — extensão autônoma

Baixa aulas da Hotmart, Whop e Kiwify em MP4, processando os vídeos inteiramente
dentro do Chrome. Não precisa instalar Python, Node, FFmpeg ou um aplicativo
auxiliar. O motor de vídeo em WebAssembly já está incluído nesta pasta.

## Instalação

1. Extraia o ZIP em uma pasta permanente. Não mova essa pasta após instalar.
2. Abra `chrome://extensions` no Chrome e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta que contém
   `manifest.json`. Fixe **Vodown** no menu de extensões.

Se estiver usando o projeto original, pode selecionar diretamente a pasta
`chrome-extension`. Ela já contém os arquivos compilados necessários.
Não é preciso executar comandos no terminal.

## Uso

1. Entre normalmente na sua conta e abra o curso na Hotmart, Whop ou Kiwify.
2. Clique no ícone da extensão para abrir o painel lateral.
3. A extensão identifica a aba atual e carrega as aulas automaticamente ao
   abrir o painel ou trocar para outro curso. **Atualizar aulas desta aba**
   permite repetir a busca. Na Hotmart, a extensão pode abrir a aula atual
   e expandir os módulos para encontrar os conteúdos.
   Na Whop, expanda os módulos antes da busca: são coletados os botões
   de aulas que o site já renderizou. Listas virtualizadas podem exigir adaptação.
   Na Kiwify, abra uma aula em `members.kiwify.com` e deixe a lista de aulas
   disponível. Os módulos são expandidos automaticamente e sua contagem é
   conferida antes de iniciar a fila. Conteúdos sem vídeo podem aparecer na
   lista; esses conteúdos serão informados como não processados.
4. Uma aula vem selecionada. **Validar 1 aula** confere o player e as
   playlists, sem baixar fragmentos de vídeo e sem criar MP4.
5. Clique em **Baixar selecionadas** para salvar as aulas escolhidas.
   **Selecionar todas** adiciona o curso inteiro à fila, por decisão sua.
6. Use o botão de engrenagem no topo para abrir **Configurações**. Lá você
   escolhe a qualidade, o limite por aula, a subpasta de destino e as legendas da Whop.

### Legendas da Whop

Na Whop, **Baixar só legendas** salva as faixas das aulas selecionadas sem
baixar o MP4. Isso também funciona para aulas cujo vídeo você já baixou.
O player do site pode carregar seus próprios dados de reprodução ao abrir a aula;
a extensão não transfere fragmentos de áudio/vídeo nesse modo.

Na tela principal, marque **Baixar legendas também** para que as legendas
acompanhem os vídeos. O checkbox começa desmarcado e é desmarcado ao mudar de
curso ou reabrir o painel. Com ele desmarcado, a fila baixa apenas os vídeos.
O botão **Baixar só legendas** continua disponível, independentemente do checkbox.

Em **Configurações**, escolha o **Formato das legendas**: **SRT** ou **VTT**.
O mesmo formato é usado pelos dois botões, sem alternância automática. Em uma
instalação nova, o formato é SRT. O **Idioma padrão das legendas** começa em
**Idioma original do vídeo**; você pode escolher um idioma específico na lista.
É baixada somente uma faixa por aula, em um formato. Não existe mais a opção `all`.
As preferências antigas `all` ou com vários idiomas migram para o idioma original;
um único idioma e um formato SRT/VTT já escolhidos são preservados.

O idioma original é identificado pelos dados de idioma do áudio do player.
Se esse idioma é conhecido e não há legenda correspondente, a extensão informa
a ausência. Se o player não informa o idioma original, usa a faixa identificada
como original, a faixa padrão ou a primeira disponível, sempre apenas uma.
Português aceita uma variante como `pt-BR`; uma região explicitamente escolhida,
como Português (Brasil), exige essa variante.
As alterações nas Configurações são salvas em **Salvar configurações** ou ao
voltar à lista de aulas. Atualizações do andamento não sobrescrevem o formulário.

Os arquivos ficam ao lado do MP4, por exemplo `001 - Aula.pt.6.vtt` e
`001 - Aula.pt.6.srt`. O número identifica a faixa e evita colisões entre faixas
do mesmo idioma. Legendas já registradas e ainda existentes não são salvas de
novo. Se o MP4 já existe, executar a fila novamente pode acrescentar as legendas
sem repetir o download do vídeo.

São coletadas as faixas de texto anunciadas na playlist HLS ou no player da
aula. Faixas em segmentos são reunidas com seus tempos e convertidas localmente
quando você escolhe SRT. Não é necessário ativar CC no player. A extensão não
cria transcrições ou traduções. Miniaturas e capítulos não são legendas e são ignorados.
Uma faixa ausente ou com falha é informada no painel; não invalida um MP4 salvo.
O suporte a legendas nesta versão é exclusivo da Whop. Cada faixa tem limite de
8 MiB e 3000 segmentos; playlists incompletas, protegidas ou em outros formatos
são recusadas. A entrega das faixas HLS é descrita na
[documentação do Mux](https://www.mux.com/docs/guides/add-subtitles-to-your-videos).

Os MP4 são salvos na pasta de downloads configurada no Chrome, dentro da
subpasta definida em **Configurações** (o padrão é `Course Downloader`),
separados por plataforma, curso e módulo. Por exemplo, se o destino for
`Cursos/Offline`, um MP4 da Hotmart ficará em
`Cursos/Offline/Hotmart/...`. A API de extensões do Chrome só permite
escolher uma subpasta dentro de Downloads. Para trocar o diretório-base,
altere-o nas configurações de downloads do próprio Chrome.

Mantenha o Chrome e a aba do curso abertos. A extensão abre cada aula para
obter uma URL atual de reprodução e pausa o vídeo quando captura o player.
Evite navegar para outro curso nessa aba durante a fila.
**Parar** interrompe a operação. Ao executar novamente, aulas já salvas
são puladas enquanto o Chrome ainda registra o download e o arquivo existe.
Uma aula interrompida será baixada novamente desde o início.

Ao trocar para outro curso, a lista anterior fica oculta enquanto o novo curso
é carregado. Em sites sem suporte, nenhuma lista de aulas é exibida.
Se houver uma fila em andamento na aba original, ela continua; o painel
informa que a operação está em outra aba e permite usar **Parar**. O novo curso
é buscado depois que a operação termina. A troca de aula dentro do mesmo curso
não força uma nova busca nem muda sua seleção.

## Atualizar a extensão

A versão atual é **1.5.0**. Se carregou diretamente a pasta `chrome-extension`
deste projeto, abra `chrome://extensions` e clique no botão **Recarregar**
da extensão. Feche e abra novamente o painel lateral para atualizar a interface.

Se instalou a partir do ZIP, extraia o ZIP novo e substitua os arquivos da pasta
que o Chrome já carregou; depois use **Recarregar**. Isso mantém as preferências
e o registro dos downloads. Não é necessário remover a extensão.

A versão 1.3.0 adiciona acesso a `members.kiwify.com` e ao servidor de vídeo
Kiwify observado (`d3pjuhbfoxhm7c.cloudfront.net`). O Chrome pode solicitar
a confirmação dessas novas permissões ao atualizar. Elas permitem ler as aulas
e buscar os vídeos entregues pelo player.

## Conta e privacidade

A extensão funciona com a conta conectada no Chrome e depende do acesso
que essa conta tem ao curso. Não existe e-mail, senha, cookie, token de
login ou curso fixo no pacote. Outra pessoa pode usar a mesma extensão,
entrando na própria conta e abrindo um curso disponível para ela.

Não há servidor nosso, serviço pago, telemetria ou envio de dados a terceiros.
As requisições de reprodução vão aos servidores da própria plataforma.
URLs assinadas de vídeo e chaves HLS ficam em memória durante a operação;
não são salvas no histórico da extensão. A lista de aulas fica na sessão
do Chrome; os identificadores de arquivos concluídos ficam no armazenamento
local da extensão para evitar downloads duplicados. As preferências de
qualidade, limite por aula e subpasta de Downloads também são salvas nesse
armazenamento local.

As permissões servem para ler a aba e os iframes do curso, navegar entre as
aulas, buscar o HLS nos provedores permitidos e salvar os MP4. A extensão
confere a aba atual enquanto o painel está aberto e pode coletar as aulas
automaticamente. O download de vídeo continua exigindo o clique em
**Baixar selecionadas**.

## Compatibilidade e tamanho dos vídeos

Suporta o player nativo HLS da Hotmart Club, o player Mux da Whop e o player
nativo HLS da Kiwify em `members.kiwify.com`, com vídeo H.264.
Na Kiwify, a captura associa o identificador da capa do vídeo à playlist
realmente solicitada pelo player. URLs de aulas anteriores são ignoradas;
o parâmetro de clube é preservado na navegação. Esta versão permite apenas
o CDN Kiwify observado, `d3pjuhbfoxhm7c.cloudfront.net`; outros provedores,
players externos ou áreas de membros personalizadas podem exigir adaptação.
A Hotmart pode usar AES-128 comum, com a chave de
reprodução entregue pelo próprio servidor; isso é suportado.
DRM, Widevine, FairPlay, SAMPLE-AES, player externo, transmissões ao vivo
e aulas sem vídeo HLS não são suportados.
Na Kiwify, playlists criptografadas também são recusadas.

O pacote é reutilizável para contas e cursos diferentes, mas não garante
compatibilidade com todo curso: o produtor pode escolher outro player ou
proteção, e a plataforma pode mudar a interface.

O processamento em WebAssembly mantém uma aula em memória por vez. Em
**Configurações**, o campo **Limite por aula (MB)** permite escolher de
**50 a 1500**, com padrão **300**, somando os fragmentos de vídeo e áudio.
As alterações são salvas quando você clica em **Salvar configurações** e valem
para as próximas filas, incluindo cursos diferentes. Os valores usam base 1024
(MiB). O consumo total de RAM é maior que o limite dos fragmentos. Aumentar o
limite permite arquivos maiores, mas não garante que um computador tenha
memória suficiente para processá-los.

Em **Configurações**, **Automática** escolhe uma qualidade até 1080p
considerando o limite salvo, a duração e a taxa de dados informada pela
playlist. Essa estimativa não é exata. Se surgir a mensagem de tamanho,
aumente o limite ou escolha **Até 480p** ou **Até 360p** e execute novamente.
Vídeos próximos de 1500 MiB não foram testados; os testes do motor usaram
amostras curtas.

## Validação desta versão

Na versão 1.5.0, 27 testes unitários e o fluxo de Chromium isolado conferiram:
idioma original do áudio selecionando apenas uma faixa mesmo quando a primeira
é uma tradução; migração das preferências antigas; SRT e VTT com seus nomes e
conteúdos corretos; preservação do formulário durante atualizações; salvamento
ao voltar; checkbox desmarcado baixando só MP4 e marcado acrescentando um único
SRT. Também passaram os testes de retomada, falhas de legenda e vídeos das três
plataformas. A verificação usou amostras locais, sem acessar a conta do Chrome.

Em 20/10/2026, a versão 1.4.0 passou em 25 testes unitários e no fluxo de
Chromium isolado com VTT segmentado, SRT, seleção/persistência de idiomas,
download só de legendas sem buscar mídia/WASM, retomada sem duplicar arquivos,
acréscimo de legendas a um MP4 existente, aviso de falha parcial e ausência de
faixas. O salvamento de MP4 com legendas também foi conferido; os fluxos de
vídeo de Whop, Hotmart e Kiwify passaram novamente.

Na aula real da Whop aberta no Chrome, foram identificados 12 idiomas e
obtidas as faixas de inglês e português. O código reuniu os segmentos e produziu
VTT e SRT nos dois idiomas: 114 entradas em inglês e 148 em português, sem
transferir fragmentos de vídeo. A validação usou Chromium temporário com uma
cópia privada da playlist já fornecida ao player. URLs temporárias, conteúdo
das legendas e dados de conta não fazem parte do pacote.

Em 20/10/2026, a versão 1.3.0 passou em 17 testes unitários e no fluxo completo
em Chromium isolado com amostras locais das três plataformas. Na Kiwify foram
verificados abertura dos módulos, preservação do clube, descarte de playlists
de outra aula, validação HLS e geração/salvamento de MP4. Os testes anteriores
de configurações, troca de abas, retomada, cancelamento e recusa de DRM passaram.

No curso real aberto da Kiwify, foram inspecionados 25 conteúdos em três módulos
e a playlist da aula atual. Foi processado apenas um fragmento de aproximadamente
16,68 segundos em 360p, com vídeo e áudio, no motor WebAssembly da extensão.
A aula inteira e o curso não foram baixados. Esses dados de sessão e mídias não
fazem parte do pacote distribuído. Isso não comprova todos os cursos Kiwify.

Em 12/10/2026, a extensão instalada em Chromium isolado passou nos fluxos:
coleta Hotmart, seleção de uma aula, validação sem transferência de vídeo,
AES-128, MP4 com áudio, salvamento via Chrome, cancelamento, retomada por arquivo concluído,
recusa de DRM e Whop com vídeo e áudio separados. Foram usadas amostras
locais de seis segundos; o pacote não contém esses vídeos.

Na versão 1.2.0 foram conferidos também o salvamento e a persistência da
qualidade, do limite e da subpasta de Downloads, a rejeição de valores inválidos,
o uso do limite na escolha automática e no download combinado, a busca
automática de outro curso no mesmo site, a troca Hotmart/Whop e a ocultação da
lista em uma aba sem suporte, inclusive com uma fila em andamento. A busca
automática não baixou novos vídeos por conta própria.

Também foi conferido o HLS real do curso aberto da Hotmart: playlist em
360p, duração de 828,62 segundos e primeiro fragmento AES-128 de 346.296
bytes, processado com sucesso dentro do contexto da extensão. Esse teste
não baixou a aula inteira nem o curso. URLs e dados dessa sessão não
acompanham o pacote.

O botão **Validar 1 aula** testa o acesso às playlists; não comprova sozinho
o download de todos os fragmentos ou o MP4 final. Os testes de seis segundos
conferiram também a geração, áudio, duração, resolução e o salvamento do MP4.

Bibliotecas e fontes: `vendor/NOTICE.txt`, `vendor/SOURCES.md` e os textos
de licença em `vendor`. São empacotadas localmente, sem buscar código remoto
durante o uso.
