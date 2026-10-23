"""Optional integration QA: uses bundled Playwright Chromium and local 6-second HLS fixtures.

Developer dependencies only; not included in the installable extension ZIP.
Run from project root: .venv/bin/python chrome-extension/tests/browser_smoke.py
Fixtures live in .local/extension-fixtures; no account or remote media is used.
"""
import asyncio
import json
import tempfile
import ssl
import subprocess
import threading
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / '.local/extension-fixtures'
EXTENSION = Path(os.environ.get('EXTENSION_DIRECTORY', ROOT/'chrome-extension')).resolve()
BASE = 'https://hotmart.com/pt-br/club/test-course/products/123'
SECOND = 'https://hotmart.com/pt-br/club/another-course/products/456'
WHOP = 'https://whop.com/demo/exp_test/app/courses/cors_demo/lessons/lesn_one'
KIWI_COURSE='11111111-1111-4111-8111-111111111111'
KIWI_MODULE='22222222-2222-4222-8222-222222222222'
KIWI_LESSON='33333333-3333-4333-8333-333333333333'
KIWI_MEDIA='44444444-4444-4444-8444-444444444444'
KIWIFY=f'https://members.kiwify.com/{KIWI_COURSE}/{KIWI_MODULE}/{KIWI_LESSON}?club=demo'
KIWI_CDN='d3pjuhbfoxhm7c.cloudfront.net'
requests = []
drm = False
slow_segments = False
whop_captions = False
caption_failure = False

def whop_master():
    tracks=''
    if whop_captions:
        tracks='#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="pt-BR",NAME="Português",URI="subs/list.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="en",NAME="English",URI="subs/en.vtt"\n'
    return '#EXTM3U\n'+tracks+'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Original",LANGUAGE="en",DEFAULT=YES,URI="audio/media.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"\nvideo/media.m3u8\n'


class FixtureServer(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        u = urlsplit(self.path)
        host = self.headers['Host'].split(':')[0]
        requests.append((host, u.path))
        data = None
        status=200
        if host==KIWI_CDN:
            if u.path.endswith('-master.m3u8'):
                data=f'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"\n{KIWI_MEDIA}-360p.m3u8\n'.encode()
            elif u.path.endswith('-360p.m3u8'):
                data=b'#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n'
            elif u.path.endswith('segment.ts'):
                data=(FIXTURES/'combined.ts').read_bytes()
        elif u.path.endswith('master.m3u8'):
            data = b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"\nmedia.m3u8\n'
        elif u.path.endswith('demoMux.m3u8'):
            data=whop_master().encode()
        elif u.path=='/subs/list.m3u8':
            data=b'#EXTM3U\n#EXTINF:3,\npt1.vtt\n#EXTINF:3,\npt2.vtt\n#EXT-X-ENDLIST\n'
        elif u.path.startswith('/subs/') and u.path.endswith('.vtt'):
            start,end=('04.000','05.500') if 'pt2' in u.path else ('01.000','02.500')
            data=f'WEBVTT\n\n00:00:{start} --> 00:00:{end}\nLegenda de demonstração\n'.encode()
            if caption_failure and u.path.endswith('en.vtt'):status=403
        else:
            file = FIXTURES / ('encrypted/key.bin' if host == 'contentplayer.hotmart.com' else 'encrypted/'+Path(u.path).name if host == 'vod-akm.play.hotmart.com' else u.path.lstrip('/'))
            if file.is_file():
                data = file.read_bytes()
        self.send_response(status if data else 404)
        self.send_header('Content-Type','application/vnd.apple.mpegurl' if u.path.endswith('.m3u8') else 'application/octet-stream')
        self.send_header('Content-Length',str(len(data or b'')))
        self.end_headers()
        if slow_segments and u.path.endswith('.ts'):
            time.sleep(2)
        try:
            self.wfile.write(data or b'')
        except OSError:
            pass  # Cancellation intentionally closes in-flight fixture requests.


async def route_request(route):
    global requests
    u = urlsplit(route.request.url)
    requests.append((u.hostname, u.path))
    if u.hostname == 'hotmart.com':
        base=u.scheme+'://'+u.netloc+u.path.split('/content/')[0]
        title='Outro curso de demonstração' if '/456' in u.path else 'Curso de demonstração'
        if '/content/' not in u.path:
            html = f'<h1>{title}</h1><p>0/2 conteúdos</p><button onclick="location.href=\'{base}/content/one\'">Continuar assistindo</button>'
        else:
            html = '<h1>Aula de demonstração</h1><button aria-controls="sectionId_1" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\',\'true\')"><span data-test="module-item-name">Primeiro módulo</span></button><section id="sectionId_1">'
            for item in ['one', 'two']:
                html += f'<a href="{base}/content/{item}?CLASS_MODULES_LIST=1"><span title="Aula {item}">Aula {item}</span><img data-test="content-background-thumbnail" src="https://api-player-thumbnail.hotmart.com/thumbnail/demo/cover.jpg"></a>'
            html += '</section><iframe src="https://cf-embed.play.hotmart.com/embed/demo"></iframe>'
        return await route.fulfill(content_type='text/html; charset=utf-8', body=html)
    if u.hostname=='members.kiwify.com':
        if 'classes' in u.path:
            return await route.fulfill(status=404,body='Unexpected classes navigation')
        html=f'''<title>Aula Kiwify - Módulo Kiwify - Curso Kiwify de demonstração</title>
        <button aria-expanded="false" aria-controls="headlessui-disclosure-panel-demo" onclick="this.setAttribute('aria-expanded','true');document.getElementById('headlessui-disclosure-panel-demo').hidden=false">Módulo Kiwify 0/2</button>
        <div id="headlessui-disclosure-panel-demo" hidden><ol><li><a href="{KIWIFY}">Aula Kiwify</a></li><li><a href="{KIWIFY.replace(KIWI_LESSON,'55555555-5555-4555-8555-555555555555')}">Material sem vídeo</a></li></ol></div>
        <video poster="https://aws-assets.kiwify.com.br/demo/{KIWI_MEDIA}/thumbnail.png"></video>
        <script>fetch('https://{KIWI_CDN}/demo/stale/stale-master.m3u8').catch(()=>{{}});fetch('https://{KIWI_CDN}/demo/{KIWI_MEDIA}/{KIWI_MEDIA}-master.m3u8');</script>'''
        return await route.fulfill(content_type='text/html; charset=utf-8',body=html)
    if u.hostname == 'cf-embed.play.hotmart.com':
        app = {'mediaCode': 'demo', 'mediaDuration': 6, 'isDrmEnabled': drm, 'flags': {'ENABLE_PLAYER_V4_ENCRYPTION': False}, 'mediaAssets': [{'height': 1080, 'url': 'https://vod-akm.play.hotmart.com/video/demo/hls/master.m3u8?hdnts=fixture'}]}
        return await route.fulfill(content_type='text/html; charset=utf-8', body='<video></video><script type="application/json">' + json.dumps({'props': {'pageProps': {'applicationData': app}}}) + '</script>')
    if u.hostname == 'whop.com':
        html = '''<h1>Curso Whop de demonstração</h1><button onclick="document.querySelector('mux-player').setAttribute('title','Aula Whop')"><img src="https://image.mux.com/demoMux/thumbnail.jpg" alt="Aula Whop"><div>Multimedia • 0:06</div></button><mux-player playback-id="demoMux" title="Aula Whop"></mux-player><script>const p=document.querySelector('mux-player');const v=document.createElement('mux-video');v.setAttribute('src','https://stream.mux.com/demoMux.m3u8?token=fixture');v.attachShadow({mode:'open'}).append(document.createElement('video'));p.attachShadow({mode:'open'}).append(v);</script>'''
        return await route.fulfill(content_type='text/html; charset=utf-8', body=html)
    if u.hostname == 'vod-akm.play.hotmart.com' and u.path.endswith('master.m3u8'):
        return await route.fulfill(content_type='application/vnd.apple.mpegurl', body='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"\nmedia.m3u8\n')
    if u.hostname == 'stream.mux.com' and u.path.endswith('demoMux.m3u8'):
        return await route.fulfill(content_type='application/vnd.apple.mpegurl', body='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Original",DEFAULT=YES,URI="audio/media.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"\nvideo/media.m3u8\n')
    file = None
    if u.hostname == 'vod-akm.play.hotmart.com':
        file = FIXTURES / 'encrypted' / Path(u.path).name
    elif u.hostname == 'contentplayer.hotmart.com':
        file = FIXTURES / 'encrypted/key.bin'
    elif u.hostname == 'stream.mux.com':
        file = FIXTURES / u.path.lstrip('/')
    if file and file.is_file():
        return await route.fulfill(path=str(file), content_type='application/vnd.apple.mpegurl' if file.suffix == '.m3u8' else 'application/octet-stream')
    return await route.fulfill(status=404, body='Fixture unavailable')


async def state(panel):
    return await panel.evaluate("async()=> (await chrome.runtime.sendMessage({target:'background',action:'state'})).result")


async def wait_done(panel):
    for attempt in range(540):
        data = await state(panel)
        if attempt % 40 == 0:
            print('Stage:',data['stage'],flush=True)
        if not data['busy']:
            assert data['results'], data
            return data
        await asyncio.sleep(.25)
    raise AssertionError('Extension timed out')


async def click(panel, name):
    await panel.evaluate('(id)=>document.getElementById(id).click()', name)
    await asyncio.sleep(.1)


async def wait_ui(panel, predicate):
    for _ in range(120):
        if await panel.evaluate(predicate):
            return
        await asyncio.sleep(.25)
    raise AssertionError(await panel.locator('body').inner_text())


async def main():
    global drm, slow_segments, whop_captions, caption_failure
    with tempfile.TemporaryDirectory(prefix='extension-qa-') as profile:
        cert, key = Path(profile)/'cert.pem', Path(profile)/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=extension-fixture'],check=True,capture_output=True)
        server=ThreadingHTTPServer(('127.0.0.1',0),FixtureServer)
        tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key)
        server.socket=tls.wrap_socket(server.socket,server_side=True)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        resolver=', '.join(f'MAP {h} 127.0.0.1:{server.server_port}' for h in ['vod-akm.play.hotmart.com','contentplayer.hotmart.com','stream.mux.com',KIWI_CDN])
        async with async_playwright() as pw:
            browsers = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            context = await pw.chromium.launch_persistent_context(profile, executable_path=str(browsers[-1]) if browsers else None, channel='chromium', headless=True, args=[f'--disable-extensions-except={EXTENSION}', f'--load-extension={EXTENSION}',f'--host-resolver-rules={resolver}','--ignore-certificate-errors','--no-proxy-server'], accept_downloads=True, viewport={'width':420,'height':900})
            await context.route('https://**/*', route_request)
            worker = context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
            extension_id = worker.url.split('/')[2]
            panel = await context.new_page()
            await panel.goto(f'chrome-extension://{extension_id}/sidepanel.html')
            await wait_ui(panel,"()=>document.getElementById('tab-context').textContent!=='Conferindo a aba atual…'")
            course = await context.new_page()
            await course.goto(BASE)
            await course.bring_to_front()
            await wait_ui(panel,"()=>document.querySelectorAll('.lesson').length===2 && !document.getElementById('download').disabled")
            assert await panel.locator('#download').inner_text() == 'Baixar selecionadas (1)'
            await click(panel, 'open-settings')
            await wait_ui(panel,"()=>!document.getElementById('settings-screen').hidden")
            await panel.evaluate("()=>{document.getElementById('quality').value='720';document.getElementById('max-input').value='750';document.getElementById('download-folder').value='Cursos/Offline'}")
            await click(panel, 'save-settings')
            await wait_ui(panel,"()=>document.getElementById('settings-feedback').textContent==='Configurações salvas.'")
            saved_settings=(await state(panel))['settings']
            assert saved_settings=={'maxInputMiB':750,'videoQuality':'720','downloadFolder':'Cursos/Offline','subtitleFormat':'srt','subtitleLanguage':'original'},saved_settings
            await click(panel, 'close-settings')
            await panel.reload()
            await course.bring_to_front()
            await wait_ui(panel,"()=>!document.getElementById('download').disabled")
            await click(panel, 'open-settings')
            await wait_ui(panel,"()=>document.getElementById('max-input').value==='750' && document.getElementById('quality').value==='720' && document.getElementById('download-folder').value==='Cursos/Offline'")
            await panel.evaluate("()=>{document.getElementById('max-input').value='49';document.getElementById('download-folder').value='Cursos/../Privado'}")
            await click(panel, 'save-settings')
            await wait_ui(panel,"()=>document.getElementById('settings-feedback').classList.contains('error')")
            assert (await state(panel))['settings']['maxInputMiB']==750
            await panel.evaluate("()=>{document.getElementById('max-input').value='750';document.getElementById('download-folder').value='Cursos/Offline'}")
            await click(panel, 'save-settings')
            await wait_ui(panel,"()=>document.getElementById('settings-feedback').textContent==='Configurações salvas.'")
            await click(panel, 'close-settings')
            await wait_ui(panel,"()=>!document.getElementById('download').disabled")
            print('PASS Settings: quality, limit and destination save, persist and reject invalid values')
            before = sum(path.endswith('.ts') for _, path in requests)
            await click(panel, 'validate')
            validated = await wait_done(panel)
            assert validated['results'][0]['status'] == 'validated', validated
            assert sum(path.endswith('.ts') for _, path in requests) == before
            await click(panel, 'download')
            hotmart = await wait_done(panel)
            assert hotmart['results'][0]['status'] == 'done', hotmart
            entries = await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries) == 1 and entries[0]['state']=='complete' and entries[0]['fileSize'] > 1024, entries
            print('PASS Hotmart: inventory, default single lesson, validation without segments, AES-128 + MP4 + Chrome download')
            await panel.screenshot(path=str(ROOT/'.local/extension-sidepanel.png'), full_page=True)
            await click(panel, 'download')
            resumed = await wait_done(panel)
            assert resumed['results'][0]['status']=='saved', resumed
            print('PASS Resume: completed file skipped')
            drm = True
            await panel.evaluate("()=>{document.getElementById('select-all').click();document.querySelector('.lesson input').click()}")
            await click(panel, 'download')
            blocked = await wait_done(panel)
            assert blocked['results'][0]['status']=='protected', blocked
            print('PASS DRM refused')
            drm = False
            # Same website, different product: no manual refresh required.
            await course.goto(SECOND)
            await wait_ui(panel,"()=>document.getElementById('course-title').textContent==='Outro curso de demonstração' && !document.getElementById('download').disabled")
            assert (await state(panel))['inventory']['key']=='hotmart:another-course:456'
            print('PASS Context: new Hotmart course automatically replaces previous inventory')
            previous_inventory=(await state(panel))['inventory']
            await panel.close()
            await course.goto(BASE)
            panel=await context.new_page()
            await panel.goto(f'chrome-extension://{extension_id}/sidepanel.html')
            await course.bring_to_front()
            await wait_ui(panel,"()=>document.getElementById('course-title').textContent==='Curso de demonstração' && !document.getElementById('download').disabled")
            assert (await state(panel))['inventory']['key']=='hotmart:test-course:123'
            await click(panel, 'open-settings')
            assert await panel.locator('#max-input').input_value()=='750'
            assert await panel.locator('#download-folder').input_value()=='Cursos/Offline'
            await click(panel, 'close-settings')
            print('PASS Reopen: a different current course replaces the saved previous course')
            unrelated=await context.new_page()
            await unrelated.goto('https://example.org/')
            await unrelated.bring_to_front()
            await wait_ui(panel,"()=>document.getElementById('course').hidden && document.getElementById('download').disabled && document.querySelectorAll('.lesson').length===0")
            assert await panel.locator('#results').inner_text()==''
            # Simulate a stale UI command; backend must not start the previous course.
            await panel.evaluate("inv=>chrome.runtime.sendMessage({target:'background',action:'run',mode:'download',quality:'auto',ids:[inv.lessons[0].id],tabId:inv.tabId,courseKey:inv.key})",previous_inventory)
            await asyncio.sleep(.3)
            assert not (await state(panel))['busy']
            assert len(await panel.evaluate('()=>chrome.downloads.search({})'))==1
            print('PASS Context: unrelated tab has no stale lessons or results')
            await course.bring_to_front()
            await wait_ui(panel,"()=>!document.getElementById('course').hidden && !document.getElementById('download').disabled")
            await course.goto(WHOP)
            await course.bring_to_front()
            await wait_ui(panel,"()=>document.querySelectorAll('.lesson').length===1 && document.getElementById('platform').textContent==='WHOP' && !document.getElementById('download').disabled")
            await click(panel, 'download')
            whop = await wait_done(panel)
            assert whop['results'][0]['status']=='done', whop
            entries = await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries)==2 and all(e['state']=='complete' and e['fileSize']>1024 for e in entries), entries
            print('PASS Whop: Shadow DOM capture, separate audio/video HLS, MP4 + Chrome download')
            await panel.evaluate("()=>chrome.storage.local.remove('completed')")
            slow_segments=True
            await click(panel,'download')
            for _ in range(80):
                if (await state(panel))['stage'].startswith('Baixando segmentos'):
                    break
                await asyncio.sleep(.1)
            else:
                raise AssertionError(await state(panel))
            await unrelated.bring_to_front()
            await wait_ui(panel,"()=>document.getElementById('course').hidden && !document.getElementById('stop').hidden")
            assert (await state(panel))['busy']
            await click(panel,'stop')
            for _ in range(80):
                stopped=await state(panel)
                if not stopped['busy']:
                    break
                await asyncio.sleep(.1)
            assert not stopped['busy'] and stopped['stage']=='Fila interrompida.',stopped
            assert len(await panel.evaluate('()=>chrome.downloads.search({})'))==2
            print('PASS Cancel: pending fragments aborted and no extra MP4 saved')
            slow_segments=False
            await course.goto(KIWIFY)
            await course.bring_to_front()
            await wait_ui(panel,"()=>document.querySelectorAll('.lesson').length===2 && document.getElementById('platform').textContent==='KIWIFY' && !document.getElementById('download').disabled")
            kiwi_inventory=(await state(panel))['inventory']
            assert all('?club=demo' in item['page_url'] for item in kiwi_inventory['lessons']),kiwi_inventory
            assert kiwi_inventory['title']=='Curso Kiwify de demonstração'
            captured=await panel.evaluate('''async ({tabId,item})=>{
                const {collectPage}=await import('./lib/collector.js');
                const result=await chrome.scripting.executeScript({target:{tabId},func:collectPage,args:['capture',item]});
                return result[0].result;
            }''',{'tabId':kiwi_inventory['tabId'],'item':kiwi_inventory['lessons'][0]})
            assert captured['url']==f'https://{KIWI_CDN}/demo/{KIWI_MEDIA}/{KIWI_MEDIA}-master.m3u8',captured
            await click(panel,'validate')
            kiwi_validation=await wait_done(panel)
            assert kiwi_validation['results'][0]['status']=='validated',kiwi_validation
            await click(panel,'download')
            kiwify=await wait_done(panel)
            assert kiwify['results'][0]['status']=='done',kiwify
            entries=await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries)==3
            await panel.screenshot(path=str(ROOT/'.local/extension-kiwify-sidepanel.png'),full_page=True)
            assert (await course.evaluate('location.href'))==KIWIFY
            print('PASS Kiwify: expanded modules, club preserved, stale media ignored, HLS validation and MP4 download')
            whop_captions=True
            await course.goto(WHOP)
            await course.bring_to_front()
            await wait_ui(panel,"()=>document.getElementById('platform').textContent==='WHOP' && !document.getElementById('subtitles').disabled")
            assert not await panel.locator('#include-subtitles').is_checked()
            before_media=sum(path.endswith(('.ts','.wasm')) for _,path in requests)
            await click(panel,'subtitles')
            captions=await wait_done(panel)
            assert captions['results'][0]['status']=='subtitles' and captions['results'][0]['subtitleCount']==1,captions
            assert sum(path.endswith(('.ts','.wasm')) for _,path in requests)==before_media
            entries=await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries)==4,entries
            caption_entries=[e for e in entries if e['fileSize']<1024]
            assert len(caption_entries)==1 and all(e['state']=='complete' for e in caption_entries)
            caption_texts=[Path(e['filename']).read_text() for e in caption_entries]
            assert not caption_texts[0].startswith('WEBVTT') and '00:00:01,000' in caption_texts[0]
            saved=await panel.evaluate("async()=> (await chrome.storage.local.get('completed')).completed")
            assert any(name.endswith('.en.2.srt') for record in saved.values() for name in record.get('subtitles',{})),saved
            await click(panel,'subtitles')
            await wait_done(panel)
            assert len(await panel.evaluate('()=>chrome.downloads.search({})'))==4
            # Preserve edits across a background update, then save automatically on Back.
            await click(panel,'open-settings')
            await panel.evaluate("()=>{const f=document.getElementById('subtitle-format');f.value='vtt';f.dispatchEvent(new Event('change'));const l=document.getElementById('subtitle-language');l.value='pt';l.dispatchEvent(new Event('change'))}")
            await worker.evaluate("async()=>{const {state}=await chrome.storage.session.get('state');await chrome.runtime.sendMessage({target:'panel',action:'state',state})}")
            assert await panel.locator('#subtitle-format').input_value()=='vtt'
            assert await panel.locator('#subtitle-language').input_value()=='pt'
            await click(panel,'close-settings')
            assert (await state(panel))['settings']['subtitleFormat']=='vtt'
            assert (await state(panel))['settings']['subtitleLanguage']=='pt'
            await click(panel,'subtitles')
            await wait_done(panel)
            entries=await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries)==5,entries
            text=Path(max(entries,key=lambda e:e['id'])['filename']).read_text()
            assert text.startswith('WEBVTT') and '00:00:04.000' in text
            await click(panel,'open-settings')
            await panel.evaluate("()=>{const f=document.getElementById('subtitle-format');f.value='srt';f.dispatchEvent(new Event('change'))}")
            await click(panel,'close-settings')
            await click(panel,'subtitles')
            await wait_done(panel)
            entries=await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries)==6,entries
            text=Path(max(entries,key=lambda e:e['id'])['filename']).read_text()
            assert not text.startswith('WEBVTT') and '00:00:04,000' in text
            print('PASS Whop subtitles: original language only, SRT/VTT contents and filenames, drafts preserved and Back saves preferences')
            # Add captions to an existing video without re-downloading that video.
            whop_entry=next(e for e in entries if e['fileSize']>1024 and e['id']==2)
            inv=(await state(panel))['inventory']
            await panel.evaluate("async ({key,id})=>{const {completed={}}=await chrome.storage.local.get('completed');completed[key]={...completed[key],downloadId:id};await chrome.storage.local.set({completed})}",{'key':inv['key']+':'+inv['lessons'][0]['id'],'id':whop_entry['id']})
            await click(panel,'include-subtitles')
            await click(panel,'download')
            resumed_captions=await wait_done(panel)
            assert resumed_captions['results'][0]['status']=='saved',resumed_captions
            assert sum(path.endswith(('.ts','.wasm')) for _,path in requests)==before_media
            assert len(await panel.evaluate('()=>chrome.downloads.search({})'))==6
            await click(panel,'open-settings')
            await panel.evaluate("()=>{const l=document.getElementById('subtitle-language');l.value='en';l.dispatchEvent(new Event('change'))}")
            await click(panel,'close-settings')
            caption_failure=True
            await click(panel,'subtitles')
            failed_captions=await wait_done(panel)
            assert failed_captions['results'][0]['status']=='partial',failed_captions
            caption_failure=False
            print('PASS Whop subtitles: existing MP4 preserved and partial caption failure reported')
            whop_captions=False
            await click(panel,'subtitles')
            absent=await wait_done(panel)
            assert absent['results'][0]['status']=='noSubtitles',absent
            assert len(await panel.evaluate('()=>chrome.downloads.search({})'))==6
            whop_captions=True
            await panel.evaluate("()=>chrome.storage.local.remove('completed')")
            await click(panel,'include-subtitles')
            assert not await panel.locator('#include-subtitles').is_checked()
            before_caption_requests=sum(path.startswith('/subs/') for _,path in requests)
            await click(panel,'download')
            video_only=await wait_done(panel)
            assert video_only['results'][0]['subtitleCount']==0,video_only
            assert sum(path.startswith('/subs/') for _,path in requests)==before_caption_requests
            assert len(await panel.evaluate('()=>chrome.downloads.search({})'))==7
            await panel.evaluate("()=>chrome.storage.local.remove('completed')")
            await click(panel,'include-subtitles')
            await click(panel,'download')
            combined=await wait_done(panel)
            assert combined['results'][0]['status']=='done' and combined['results'][0]['subtitleCount']==1,combined
            entries=await panel.evaluate('()=>chrome.downloads.search({})')
            assert len(entries)==9,entries
            saved=await panel.evaluate("async()=> (await chrome.storage.local.get('completed')).completed")
            assert all(name.endswith('.srt') for record in saved.values() for name in record.get('subtitles',{})),saved
            print('PASS Whop subtitles: unchecked checkbox saves video only; checked saves exactly one SRT companion')
            await panel.screenshot(path=str(ROOT/'.local/extension-whop-subtitles.png'),full_page=True)
            await click(panel,'open-settings')
            await panel.screenshot(path=str(ROOT/'.local/extension-subtitle-settings.png'),full_page=True)
            await panel.reload()
            await course.bring_to_front()
            await wait_ui(panel,"()=>document.getElementById('platform').textContent==='WHOP' && !document.getElementById('subtitles').disabled")
            await click(panel,'open-settings')
            assert await panel.locator('#subtitle-format').input_value()=='srt'
            assert await panel.locator('#subtitle-language').input_value()=='en'
            await click(panel,'close-settings')
            assert not await panel.locator('#include-subtitles').is_checked()
            await course.bring_to_front()
            await wait_ui(panel,"()=>!document.getElementById('course').hidden && !document.getElementById('download').disabled")
            (ROOT/'.local/extension-qa.json').write_text(json.dumps({'hotmart':hotmart['results'],'whop':whop['results'],'kiwify':kiwify['results'],'subtitles':captions['results'],'downloads':[{'state':e['state'],'bytes':e['fileSize'],'filename':Path(e['filename']).name} for e in entries]},indent=2))
            await context.close()
        server.shutdown();server.server_close()


if __name__=='__main__':
    asyncio.run(main())
