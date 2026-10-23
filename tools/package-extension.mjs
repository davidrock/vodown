import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
const root='chrome-extension';
const files={};
// Explicit allowlist prevents developer caches, credentials and fixtures entering the ZIP.
async function add(path){
  const stat=await readdir(`${root}/${path}`,{withFileTypes:true});
  for(const entry of stat){const child=`${path}/${entry.name}`; if(entry.isDirectory())await add(child);else if(entry.isFile()) files[`vodown/${child}`]=new Uint8Array(await readFile(`${root}/${child}`));}
}
for(const name of ['manifest.json','background.js','offscreen.js','offscreen.html','sidepanel.js','sidepanel.html','sidepanel.css','LEIA-ME.md']) files[`vodown/${name}`]=new Uint8Array(await readFile(`${root}/${name}`));
for(const directory of ['assets','lib','vendor'])await add(directory);
const zip=zipSync(files,{level:6});
await mkdir('dist',{recursive:true});
await writeFile('dist/vodown-chrome.zip',zip);
await writeFile('dist/vodown-chrome.zip.sha256',`${createHash('sha256').update(zip).digest('hex')}  vodown-chrome.zip\n`);
console.log(`Packaged ${Object.keys(files).length} extension files. No tests, account data or developer dependencies included.`);
