"""Developer-only packaging. No private project state or dependencies enter the ZIP."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent/'dist'
FILES=['manifest.json','background.js','sidepanel.html','sidepanel.css','sidepanel.js','offscreen.html','offscreen.js','LEIA-ME.md']
paths=[ROOT/name for name in FILES]
paths += [p for folder in ['lib','vendor','assets'] for p in (ROOT/folder).rglob('*') if p.is_file()]
assert all(p.is_file() for p in paths)
manifest=json.loads((ROOT/'manifest.json').read_text())
assert 'nativeMessaging' not in manifest['permissions']
assert (ROOT/'vendor/core/ffmpeg-core.wasm').stat().st_size > 10_000_000
OUT.mkdir(exist_ok=True)
dest=OUT/'course-downloader-chrome.zip'
with ZipFile(dest,'w',ZIP_DEFLATED,compresslevel=9) as archive:
    for file in sorted(paths):
        archive.write(file,'course-downloader-chrome/'+file.relative_to(ROOT).as_posix())
with ZipFile(dest) as archive:
    assert archive.testzip() is None
    assert all('/node_modules/' not in n and '/tests/' not in n and '/.local/' not in n for n in archive.namelist())
checksum=hashlib.sha256(dest.read_bytes()).hexdigest()
(OUT/'course-downloader-chrome.sha256').write_text(f'{checksum}  {dest.name}\n')
print(f'{dest}: {dest.stat().st_size/1024/1024:.1f} MiB, {len(paths)} files; SHA256 {checksum}')
