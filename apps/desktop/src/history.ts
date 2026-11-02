import {isTauri, invoke} from '@tauri-apps/api/core';
export type DownloadRecord = {id:string;title:string;platform:string;status:'queued'|'running'|'processing'|'waiting_capture'|'completed'|'failed'|'canceled';createdAt:string;localPath?:string|null;courseTitle?:string|null};
export async function readHistory(): Promise<DownloadRecord[]> {
  return isTauri() ? invoke<DownloadRecord[]>('download_history') : [];
}

export function completedVideos(records:DownloadRecord[]):DownloadRecord[] {
  const paths=new Set<string>();
  return records.filter(record=>{
    if(record.status!=='completed'||!record.localPath?.toLowerCase().endsWith('.mp4')||paths.has(record.localPath))return false;
    paths.add(record.localPath);return true;
  });
}
