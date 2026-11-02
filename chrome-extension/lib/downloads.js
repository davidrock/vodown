export function safePart(value) {
  return String(value||'Aulas').normalize('NFKC').replace(/[\x00-\x1f/\\:*?"<>|]/g,'-').replace(/^[ .]+|[ .]+$/g,'').slice(0,100)||'Aula';
}

export function downloadFilename(inventory,item,downloadFolder) {
  return `${downloadFolder}/${inventory.platform==='hotmart'?'Hotmart':inventory.platform==='kiwify'?'Kiwify':'Whop'}/${safePart(inventory.slug)}/${String(item.module_index||1).padStart(2,'0')} - ${safePart(item.module)}/${String(item.index).padStart(3,'0')} - ${safePart(item.title)}.mp4`;
}

export function subtitleFilename(inventory,item,downloadFolder,file) {
  return downloadFilename(inventory,item,downloadFolder).replace(/\.mp4$/,`.${safePart(file.language)}.${file.track}.${file.format}`);
}

export function nativePart(value) {
  let name=Array.from(String(value||'')).map(c=>/[\x00-\x1f/\\:*?"<>|]/.test(c)?'-':c).slice(0,140).join('').replace(/^[ .]+|[ .]+$/g,'')||'Sem nome';
  if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='_'+name;
  return name;
}
export function materialFolder(inventory,item) {return `Vodown/${nativePart(inventory.title)}/${nativePart(item.module)}/Materiais/${nativePart(item.title)}`;}
