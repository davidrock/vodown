import sharp from 'sharp';
import {mkdir,copyFile} from 'node:fs/promises';
const source='assets/branding/vodown-logo-v4.png';
const metadata=await sharp(source).metadata();
if(!metadata.hasAlpha) throw new Error('The approved logo must retain transparency.');
const crop=await sharp(source).extract({left:0,top:0,width:600,height:metadata.height}).png().toBuffer();
const symbol=await sharp(crop).trim({background:'#00000000'}).png().toBuffer();
const logo=await sharp(source).trim({background:'#00000000'}).png().toBuffer();
await sharp(logo).toFile('assets/branding/vodown-logo.png');
await sharp(symbol).toFile('assets/branding/vodown-symbol.png');
for(const directory of ['apps/desktop/public/brand','apps/web/public/brand','chrome-extension/assets/brand']) {
  await mkdir(directory,{recursive:true});
  await sharp(logo).toFile(`${directory}/vodown-logo.png`);
  await sharp(symbol).toFile(`${directory}/vodown-symbol.png`);
}
for(const size of [16,32,48,128]) await sharp(symbol).resize(size,size,{fit:'contain',background:'#00000000'}).toFile(`chrome-extension/assets/icon-${size}.png`);
await mkdir('apps/desktop/src-tauri/icons',{recursive:true});
await sharp(symbol).resize(1024,1024,{fit:'contain',background:'#00000000'}).toFile('apps/desktop/src-tauri/icons/icon.png');
console.log('Approved Vodown brand prepared for desktop, web and extension.');
