import {isTauri, invoke} from '@tauri-apps/api/core';
export type DownloadRecord = {id:string;title:string;platform:string;status:'queued'|'running'|'completed'|'failed'|'canceled';createdAt:string};
export async function readHistory(): Promise<DownloadRecord[]> {
  return isTauri() ? invoke<DownloadRecord[]>('download_history') : [];
}
