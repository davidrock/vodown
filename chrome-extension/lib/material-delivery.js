import {nativePart} from './downloads.js';
export function matchesMaterialDownload(item,job) {
  if(!job)return false;
  if(job.sourceUrl && item.url===job.sourceUrl)return true;
  try{if(item.referrer && new URL(item.referrer).origin===job.origin)return true;}catch{}
  if(item.url?.startsWith(`blob:${job.origin}/`))return true;
  // Some file-save controls use a data URI without a referrer. Only claim
  // the requested filename; unrelated browser downloads remain untouched.
  const filename=String(item.filename||'').split(/[\\/]/).pop();
  return !!item.url?.startsWith('data:') && filename?.normalize('NFC')===nativePart(job.name).normalize('NFC');
}

export function hasCompletedMaterial(items,folder,name) {
  const suffix=`/${folder}/${nativePart(name)}`.normalize('NFC');
  return items.some(item=>item.state==='complete' && item.exists===true && ('/'+String(item.filename||'').replace(/\\/g,'/').replace(/^\/+/,'' )).normalize('NFC').endsWith(suffix));
}
