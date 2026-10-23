import {cp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root,'vendor/ffmpeg'),{recursive:true});await mkdir(path.join(root,'vendor/core'),{recursive:true});
for(const file of await readdir(path.join(root,'node_modules/@ffmpeg/ffmpeg/dist/esm'))){if(file.endsWith('.js'))await cp(path.join(root,'node_modules/@ffmpeg/ffmpeg/dist/esm',file),path.join(root,'vendor/ffmpeg',file));}
for(const file of ['ffmpeg-core.js','ffmpeg-core.wasm'])await cp(path.join(root,'node_modules/@ffmpeg/core/dist/esm',file),path.join(root,'vendor/core',file));
for(const pkg of ['ffmpeg','core']){for(const license of ['LICENSE','LICENSE.md']){try{await cp(path.join(root,`node_modules/@ffmpeg/${pkg}`,license),path.join(root,`vendor/LICENSE-${pkg}`));break;}catch{}}}
await writeFile(path.join(root,'vendor/NOTICE.txt'),'Libraries bundled unmodified from npm: @ffmpeg/ffmpeg 0.12.15 (MIT); @ffmpeg/core 0.12.10 (GPL-2.0-or-later build).\nCore: FFmpeg 5.1.4, Emscripten 3.1.40, single-thread SIMD build with the upstream codec libraries.\nSource and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm (packages/core, src, build and Dockerfile).\nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n5.1.4\nMIT, GPL-2.0 and LGPL-2.1 license texts accompany this distribution. See SOURCES.md for upstream component sources.\nNo remote JavaScript or WebAssembly is fetched at runtime.\n');
console.log('Extensão autônoma preparada em chrome-extension/.');
