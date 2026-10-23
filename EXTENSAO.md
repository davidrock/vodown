# Extensão Chrome

A extensão autônoma está em [chrome-extension](chrome-extension).
Não usa os scripts Python deste projeto nem o FFmpeg instalado no computador.

O pacote de instalação está em `dist/course-downloader-chrome.zip`.
Extraia-o, abra `chrome://extensions`, ative o modo do desenvolvedor e
carregue a pasta que contém `manifest.json` usando **Carregar sem compactação**.

As instruções completas e os limites de compatibilidade estão em
[LEIA-ME.md](chrome-extension/LEIA-ME.md).

Na versão **1.5.0**, o checkbox **Baixar legendas também** fica na tela principal,
desmarcado por padrão. As Configurações definem somente o formato **SRT/VTT** e
o idioma padrão, inicialmente **Idioma original do vídeo**. Uma única faixa é
baixada por aula, e a preferência antiga `all` migra para original.
O botão **Baixar só legendas** dispensa baixar o vídeo novamente e respeita o
mesmo formato escolhido. Arquivos concluídos são reutilizados e falhas de
legenda aparecem como avisos.

O player nativo da Kiwify também é suportado, além de
Hotmart e Whop. A Kiwify é reconhecida em `members.kiwify.com`; a extensão
expande os módulos, preserva o clube e captura a playlist da aula atual.
O suporte cobre o CDN observado; players externos e vídeos protegidos
continuam fora da compatibilidade. A tela de **Configurações** concentra a qualidade do
vídeo, o limite por aula e a subpasta dentro de Downloads. Essas preferências
são configuráveis e persistidas. O painel acompanha a aba atual, identifica
novos cursos e oculta conteúdo de outros cursos/sites. Para atualizar uma
instalação existente, substitua os arquivos da pasta carregada, clique em
**Recarregar** em `chrome://extensions` e reabra o painel.

## Desenvolvimento

Os arquivos de execução em `chrome-extension/vendor` já estão preparados.
Para reconstruí-los, com Node instalado apenas no ambiente de desenvolvimento:

```sh
npm ci --prefix chrome-extension --ignore-scripts
node chrome-extension/build.mjs
npm test --prefix chrome-extension
```

Os testes de integração opcionais em `chrome-extension/tests/browser_smoke.py`
usam Playwright e Chromium em um perfil temporário. As amostras HLS de seis
segundos em `.local/extension-fixtures` são privadas e não são distribuídas.
Elas cobrem AES-128, áudio/vídeo separados e HLS Kiwify com áudio e vídeo juntos
(`combined.ts`). O teste não usa a conta do Chrome.

```sh
.venv/bin/python chrome-extension/tests/browser_smoke.py
```

O ZIP de instalação inclui somente o manifesto, painel, worker, engine,
bibliotecas HLS/coleta, instruções e bibliotecas WebAssembly locais. Não inclui
Python, node_modules, testes, vídeos, perfis, cookies ou URLs assinadas.
