export const DEFAULT_MAX_INPUT_MIB=300;
export const MIN_MAX_INPUT_MIB=50;
export const MAX_MAX_INPUT_MIB=1500;
export const MIB=1024*1024;
export const DEFAULT_VIDEO_QUALITY='auto';
export const DEFAULT_DOWNLOAD_FOLDER='Course Downloader';
export const VIDEO_QUALITIES=new Set(['auto','1080','720','480','360']);

export function normalizeDownloadFolder(value=DEFAULT_DOWNLOAD_FOLDER) {
  const folder=String(value??'').normalize('NFKC').trim().replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/$/,'');
  if(!folder||folder.length>180||folder.startsWith('/')||folder.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f:*?"<>|]/.test(part))) {
    throw new Error('Informe uma pasta válida dentro de Downloads, sem usar .. ou caracteres especiais.');
  }
  return folder;
}

export function normalizeSettings(value={}) {
  const maxInputMiB=Number(value.maxInputMiB ?? DEFAULT_MAX_INPUT_MIB);
  if(!Number.isInteger(maxInputMiB)||maxInputMiB<MIN_MAX_INPUT_MIB||maxInputMiB>MAX_MAX_INPUT_MIB) {
    throw new Error(`Informe um limite inteiro entre ${MIN_MAX_INPUT_MIB} e ${MAX_MAX_INPUT_MIB} MB por aula.`);
  }
  const videoQuality=String(value.videoQuality ?? DEFAULT_VIDEO_QUALITY);
  if(!VIDEO_QUALITIES.has(videoQuality))throw new Error('Escolha uma qualidade de vídeo válida.');
  // Migrate the old combined controls: format no longer enables downloads or selects all languages.
  const subtitleFormat=['off','both'].includes(value.subtitleFormat)?'srt':value.subtitleFormat??'srt';
  if(!['vtt','srt'].includes(subtitleFormat))throw new Error('Escolha SRT ou VTT para as legendas.');
  const oldLanguage=String(value.subtitleLanguages??'').trim().toLowerCase();
  const subtitleLanguage=String(value.subtitleLanguage??(/^([a-z]{2,3})(-[a-z0-9]{2,8})*$/.test(oldLanguage)&&oldLanguage!=='all'?oldLanguage:'original')).trim().toLowerCase();
  if(subtitleLanguage==='all'||(subtitleLanguage!=='original'&&!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(subtitleLanguage)))throw new Error('Escolha um idioma de legenda válido.');
  return {maxInputMiB,videoQuality,downloadFolder:normalizeDownloadFolder(value.downloadFolder),subtitleFormat,subtitleLanguage};
}

export const inputBudget=settings=>normalizeSettings(settings).maxInputMiB*MIB;
