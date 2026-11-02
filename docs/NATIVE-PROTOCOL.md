# Native Messaging Vodown V1

Host: `com.vodown.desktop`. JSON UTF-8 precedido por quatro bytes com tamanho em ordem nativa, até 1 MiB por frame. O stdout do host contém somente frames. O host encaminha as mensagens ao desktop pelo socket local restrito ao usuário no macOS. O suporte equivalente Windows ainda precisa de homologação.

Todas as mensagens incluem `version: 1`, `requestId` e `type`. O identificador aceita 1–128 caracteres ASCII alfanuméricos, `_` e `-`. A resposta repete os três campos e fornece `code`. O handshake `hello` não autoriza operações.

`pair` envia nonce e sessão para confirmação pelo desktop, que verifica online a identidade. `pair_status` consulta a confirmação. As demais operações exigem `pairToken`; logout ou revogação invalida o pareamento. O manifesto do host mantém a allowlist exata da extensão.

`inventory` publica curso, plataforma, aulas, módulos, trilhas, identificadores e capacidades. Quando uma ou mais trilhas não puderem ser lidas, `trackDiscoveryIncomplete`, `failedTracks` e `totalTracks` sinalizam a lista parcial; o desktop bloqueia o download do curso inteiro até que ela seja atualizada. `capture_poll` retorna a captura ativa `[id, lessonId, kind, courseKey]`. Os tipos são `video`, `video_no_subtitles` e `materials`. `capture_result` encerra uma captura correspondente, fornecendo o resultado ou uma falha identificada. URLs ficam transitórias, fora do histórico e dos logs.

Uma captura de vídeo pode retornar JSON com URL, legendas SRT/VTT e avisos sanitizados. O desktop salva as legendas ao lado do MP4. Autorização de plano é consultada pelo motor antes de iniciar cada tarefa, sem confiar no plano informado pela extensão.

## Materiais

`material_exists` recebe `lessonId` e `materialName`, verificando apenas o destino derivado do inventário pareado. A resposta `material_checked` contém `exists`.

Durante uma captura ativa de materiais, a extensão envia:

1. `material_begin`: `captureId`, `materialName`. Resposta `material_ready` ou `material_skipped`.
2. `material_chunk`: `captureId`, `offset`, `data` (array de bytes, até 32 KiB). Resposta `material_chunk_received`.
3. `material_end`: `captureId`, `size`. Resposta `material_saved` após sincronização e publicação do arquivo final.

Todas exigem `pairToken` válido e a captura ativa correspondente. O tamanho máximo é 512 MiB por arquivo. O desktop exige posições sequenciais e tamanho final exato. Caminhos arbitrários não são aceitos; o destino é `Downloads/Vodown/Curso/Módulo/Materiais/Aula/Nome`. Para aulas de trilhas da Hotmart, a trilha fica entre o curso e o módulo. O diretório canônico deve permanecer dentro da raiz. Materiais antigos sem pasta de trilha são reconhecidos quando não houver ambiguidade. Arquivos existentes são preservados. Cancelamento, revogação e término da captura descartam parciais ainda abertos.

Ao terminar os materiais, `capture_result` fornece JSON com `count`. A ausência de anexos é identificada como `no_materials` no motor e não conta como falha do curso. O fluxo não usa o gerenciador de downloads do Chrome.
