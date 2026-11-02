import {readFileSync} from 'node:fs';
const json = file => JSON.parse(readFileSync(file,'utf8'));
if (json('nx.json').defaultBase !== 'master') throw new Error('Nx must use master');
if (json('package.json').packageManager !== 'pnpm@11.17.0') throw new Error('Update CI when changing pnpm');
if (readFileSync('.node-version','utf8').trim() !== '24.22.1') throw new Error('Update CI when changing Node');
console.log('Repository and CI tool versions agree.');
