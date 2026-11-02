import test from 'node:test';
import assert from 'node:assert/strict';
import {completedVideos,type DownloadRecord} from '../src/history.ts';
test('downloaded content contains one entry per completed video, excluding materials and failed jobs',()=>{
  const base={title:'Aula',platform:'kiwify',status:'completed',createdAt:'2026-11-01'} as const;
  const records:DownloadRecord[]=[{...base,id:'video',localPath:'/Curso/Aula.mp4'},{...base,id:'subtitles',localPath:'/Curso/Aula.mp4'},{...base,id:'materials',localPath:'/Curso/Materiais'},{...base,id:'empty',localPath:null},{...base,id:'failed',status:'failed',localPath:'/Curso/Outro.mp4'}];
  assert.deepEqual(completedVideos(records).map(r=>r.id),['video']);
});
