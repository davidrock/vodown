function safePart(value) {
  return String(value||'Aulas').normalize('NFKC').replace(/[\x00-\x1f/\\:*?"<>|]/g,'-').replace(/^[ .]+|[ .]+$/g,'').slice(0,100)||'Aula';
}

export function downloadFilename(inventory,item,downloadFolder) {
  return `${downloadFolder}/${inventory.platform==='hotmart'?'Hotmart':inventory.platform==='kiwify'?'Kiwify':'Whop'}/${safePart(inventory.slug)}/${String(item.module_index||1).padStart(2,'0')} - ${safePart(item.module)}/${String(item.index).padStart(3,'0')} - ${safePart(item.title)}.mp4`;
}

export function subtitleFilename(inventory,item,downloadFolder,file) {
  return downloadFilename(inventory,item,downloadFolder).replace(/\.mp4$/,`.${safePart(file.language)}.${file.track}.${file.format}`);
}
