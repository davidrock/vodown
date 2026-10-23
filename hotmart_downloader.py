"""Local Hotmart Club downloader using the account's normal player URLs."""
from __future__ import annotations

import argparse
import hashlib
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

from whop_downloader import ProtectedVideo, QuietLogger, media_info, private_json, redact, safe_name

DEFAULT_URL = "https://hotmart.com/pt-br/club/o-codigo-da-tecnica/products/7084698"
REFERER = "https://cf-embed.play.hotmart.com/"


def course_path(url: str) -> str:
    p = urlsplit(url)
    match = re.fullmatch(r"(/[^/]+/club/[^/]+/products/\d+)(?:/content/[A-Za-z0-9]+)?/?", p.path)
    if p.scheme != "https" or p.hostname != "hotmart.com" or not match:
        raise ValueError("Use uma URL HTTPS de curso/aula do Hotmart Club em hotmart.com.")
    return match.group(1)


def default_output(url: str) -> Path:
    return Path("downloads/Hotmart") / safe_name(course_path(url).split("/")[3])


def trusted_media_url(url: str) -> None:
    p = urlsplit(url)
    host = p.hostname or ""
    if p.scheme != "https" or not (host.endswith(".play.hotmart.com") or host == "contentplayer.hotmart.com") or p.username or p.password or p.port not in (None, 443):
        raise ValueError("Recurso fora dos hosts HTTPS do player Hotmart suportado.")


def attributes(line: str) -> dict[str, str]:
    return {k: v.strip('"') for k, v in re.findall(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)', line.partition(":")[2])}


def check_playlist(text: str, base: str) -> list[str]:
    """AES-128 identity is ordinary HLS; SAMPLE-AES and DRM key formats are refused."""
    if not text.lstrip().startswith("#EXTM3U"):
        raise ValueError("A resposta não é HLS; o acesso pode ter expirado.")
    children = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.startswith(("#EXT-X-KEY:", "#EXT-X-SESSION-KEY:")):
            attrs = attributes(line)
            method = attrs.get("METHOD")
            if method == "NONE":
                continue
            if method != "AES-128" or attrs.get("KEYFORMAT", "identity") != "identity":
                raise ProtectedVideo("DRM/criptografia não suportada. Nenhuma licença ou chave será extraída.")
            if not attrs.get("URI"):
                raise ValueError("Playlist AES-128 sem URI de reprodução.")
            # The standard HLS client obtains this authorized URI itself. No manual key extraction.
            trusted_media_url(urljoin(base, attrs["URI"]))
        if line.startswith("#EXT-X-STREAM-INF:"):
            target = next((s.strip() for s in lines[index + 1:] if s.strip() and not s.startswith("#")), None)
            if not target:
                raise ValueError("Playlist sem variante após EXT-X-STREAM-INF.")
            children.append(urljoin(base, target))
        if line.startswith("#EXT-X-MEDIA:"):
            target = attributes(line).get("URI")
            if target:
                children.append(urljoin(base, target))
        # I-frame-only playlists are seek previews, not complete videos. Some advertised
        # Hotmart preview playlists return 404; they aren't needed for offline MP4s.
        if line.startswith("#EXT-X-I-FRAME-STREAM-INF:"):
            target = attributes(line).get("URI")
            if target:
                trusted_media_url(urljoin(base, target))
        # Validate media segment/init URLs too, without downloading media during preflight.
        if line.startswith("#EXT-X-MAP:"):
            target = attributes(line).get("URI")
            if target:
                trusted_media_url(urljoin(base, target))
        if line.strip() and not line.startswith("#"):
            trusted_media_url(urljoin(base, line.strip()))
    return children


def check_manifests(url: str, headers: dict) -> None:
    trusted_media_url(url)
    if not urlsplit(url).path.endswith(".m3u8"):
        raise ValueError("Este coletor atende a HLS (.m3u8), não a DASH/MPD.")
    seen = set()
    opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def visit(current: str, depth: int):
        if current in seen:
            return
        if depth > 3 or len(seen) >= 50:
            raise ValueError("Playlist excessivamente complexa.")
        trusted_media_url(current)
        seen.add(current)
        with opener.open(Request(current, headers=headers), timeout=30) as response:
            trusted_media_url(response.geturl())
            payload = response.read(2_000_001)
            final_url = response.geturl()
        if len(payload) > 2_000_000:
            raise ValueError("Playlist grande demais.")
        for child in check_playlist(payload.decode("utf-8-sig"), final_url):
            visit(child, depth + 1)

    visit(url, 0)


def parse_player(data: dict, expected_media: str | None = None) -> dict:
    app = data.get("props", {}).get("pageProps", {}).get("applicationData", {})
    if not app.get("mediaCode"):
        raise ValueError("Configuração de vídeo ausente no JSON do player.")
    if expected_media and app["mediaCode"] != expected_media:
        raise ValueError("Player ainda corresponde à aula anterior.")
    if app.get("isDrmEnabled") is not False:
        raise ProtectedVideo("O player informa DRM ou não permite confirmar o modo sem DRM.")
    if app.get("flags", {}).get("ENABLE_PLAYER_V4_ENCRYPTION"):
        raise ProtectedVideo("Configuração proprietária de proteção do player não suportada.")
    assets = [a for a in app.get("mediaAssets", []) if a.get("url") and urlsplit(a["url"]).path.endswith(".m3u8")]
    if not assets:
        raise ValueError("O player não forneceu um stream HLS suportado.")
    asset = max(assets, key=lambda a: a.get("height") or 0)
    trusted_media_url(asset["url"])
    return {"url": asset["url"], "playback_id": app["mediaCode"],
            "duration": app.get("mediaDuration"), "drm": False, "encryption": False}


def lesson_key(lesson: dict) -> str:
    # Keep both content path and media ID, including courses/lessons with multiple videos.
    identity = urlsplit(lesson["page_url"]).path.lower() + ":" + lesson["playback_id"]
    return hashlib.sha256(identity.encode()).hexdigest()[:12]


def saved_video(lesson: dict, output: Path, progress: dict) -> Path | None:
    record = progress.get(lesson_key(lesson), {})
    path = (output / record.get("file", "__missing__")).resolve()
    if not path.is_relative_to(output.resolve()):
        raise ValueError("Caminho de progresso fora da pasta de downloads.")
    if record.get("status") == "done" and path.is_file() and path.stat().st_size == record.get("bytes") and media_info(path):
        return path
    return None


def download_lesson(lesson: dict, output: Path, progress: dict, user_agent: str = "Mozilla/5.0") -> None:
    from yt_dlp import YoutubeDL

    if saved_video(lesson, output, progress):
        print(f"Já baixada: {lesson['title']}", flush=True)
        return
    if lesson.get("drm") or lesson.get("encryption"):
        raise ProtectedVideo("Aula marcada como DRM/proteção proprietária; download não iniciado.")
    headers = {"Referer": REFERER, "User-Agent": user_agent}
    check_manifests(lesson["url"], headers)
    key = lesson_key(lesson)
    module = f"{lesson.get('module_index', 1):02d} - {safe_name(lesson.get('module', 'Aulas'))}"
    directory = output / module
    directory.mkdir(parents=True, exist_ok=True)
    staging = directory / ".partial"
    staging.mkdir(exist_ok=True)
    filename = f"{lesson['index']:03d} - {safe_name(lesson['title'])} [{key}].mp4"
    last_update = 0.0

    def update(data):
        nonlocal last_update
        if data.get("status") == "downloading" and time.monotonic() - last_update >= 5:
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            amount = data.get("downloaded_bytes", 0)
            print(f"  {amount / total:.0%}" if total else f"  {amount / 1024**2:.1f} MB", flush=True)
            last_update = time.monotonic()

    options = {
        "format": "bv*+ba/b", "merge_output_format": "mp4", "outtmpl": str(staging / filename),
        "http_headers": headers, "concurrent_fragment_downloads": 4, "retries": 5, "fragment_retries": 5,
        "skip_unavailable_fragments": False, "continuedl": True, "noplaylist": True,
        "quiet": True, "noprogress": True, "logger": QuietLogger(), "progress_hooks": [update],
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
    }
    print(f"Baixando {lesson['index']:03d}: {lesson['title']}", flush=True)
    with YoutubeDL(options) as downloader:
        downloader.download([lesson["url"]])
    complete = staging / filename
    info = media_info(complete)
    if not info or not any(s.get("codec_type") == "audio" for s in info["streams"]):
        raise RuntimeError("Arquivo não passou na validação de vídeo e áudio com ffprobe.")
    duration = float(info["format"]["duration"])
    if lesson.get("duration") and abs(duration - float(lesson["duration"])) > 3:
        raise RuntimeError("Duração do arquivo diverge da duração fornecida pelo player.")
    target = directory / filename
    complete.replace(target)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    progress[key] = {"status": "done", "file": str(target.relative_to(output)), "title": lesson["title"],
                     "module": lesson.get("module"), "bytes": target.stat().st_size, "duration": duration,
                     "width": video.get("width"), "height": video.get("height"), "audio": True}
    private_json(output / "progress.json", progress)
    print(f"Concluída: {target.relative_to(output)}", flush=True)


def validate_lesson(lesson: dict, user_agent: str = "Mozilla/5.0") -> dict:
    """Check actual playlists and offered formats without transferring video segments."""
    from yt_dlp import YoutubeDL

    if lesson.get("drm") or lesson.get("encryption"):
        raise ProtectedVideo("Aula marcada como DRM/proteção proprietária.")
    headers = {"Referer": REFERER, "User-Agent": user_agent}
    check_manifests(lesson["url"], headers)
    with YoutubeDL({"quiet": True, "logger": QuietLogger(), "http_headers": headers, "noplaylist": True}) as downloader:
        info = downloader.extract_info(lesson["url"], download=False)
    formats = [f for f in info.get("formats", []) if not f.get("has_drm") and f.get("vcodec") not in (None, "none")]
    if not formats:
        raise ValueError("Nenhum formato de vídeo sem DRM foi oferecido.")
    heights = sorted({f["height"] for f in formats if f.get("height")})
    print(f"Validada sem baixar segmentos: {lesson['title']} ({heights})", flush=True)
    return {"heights": heights, "duration": lesson.get("duration"), "segments_downloaded": False}


LESSONS_SCRIPT = """() => [...document.querySelectorAll('button[aria-controls^="sectionId_"]')]
 .flatMap((b, m) => {
   const section = document.getElementById(b.getAttribute('aria-controls'));
   const module = b.querySelector('[data-test="module-item-name"]')?.textContent?.trim() || `Módulo ${m+1}`;
   return [...(section?.querySelectorAll('a[href*="/content/"]') || [])].map(a => {
     const url = new URL(a.getAttribute('href'), location.href); url.search=''; url.hash='';
     const thumb = a.querySelector('[data-test="content-background-thumbnail"]')?.getAttribute('src');
     const media = thumb?.match(/\\/thumbnail\\/([^/]+)\\//)?.[1];
     return {title:a.querySelector('span[title]')?.getAttribute('title')?.trim() || a.innerText.trim(),
       page_url:url.href, module, module_index:m+1, expected_media:media || null};
   });
 })"""


def expand_modules(page, timeout: int) -> list[dict]:
    selector = 'button[aria-controls^="sectionId_"]'
    page.locator(selector).first.wait_for(state="attached", timeout=timeout * 1000)
    controls = page.locator(selector).all()
    for button in controls:
        if button.get_attribute("aria-expanded") == "false":
            button.click()
            deadline = time.monotonic() + timeout
            while button.get_attribute("aria-expanded") != "true":
                if time.monotonic() > deadline:
                    raise RuntimeError("Um módulo não expandiu. Nenhum inventário incompleto foi aceito.")
                page.wait_for_timeout(100)
    # Wait for delayed lesson lists; the inventory must be stable, including every module.
    last = None
    stable = 0
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        items = page.evaluate(LESSONS_SCRIPT)
        signature = [x["page_url"] for x in items]
        stable = stable + 1 if signature == last and signature else 0
        last = signature
        if stable >= 4:
            if len(set(signature)) != len(signature):
                raise RuntimeError("A lista contém aulas duplicadas; inventário precisa de revisão.")
            return [{**item, "index": i} for i, item in enumerate(items, 1)]
        page.wait_for_timeout(250)
    raise RuntimeError("Lista de aulas não estabilizou.")


def capture_lesson(page, item: dict, timeout: int) -> list[dict]:
    page.goto(item["page_url"], wait_until="domcontentloaded")
    page.get_by_role("heading", name=item["title"], exact=True).wait_for(timeout=timeout * 1000)
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        frames = [f for f in page.frames if urlsplit(f.url).hostname and urlsplit(f.url).hostname.endswith(".play.hotmart.com")]
        result = []
        for frame in frames:
            try:
                script = frame.locator('script[type="application/json"]')
                if script.count() != 1:
                    continue
                data = json.loads(script.inner_text())
                player = parse_player(data, item.get("expected_media") if len(frames) == 1 else None)
                # Stop ordinary playback while downloading so autoplay doesn't advance lessons.
                video = frame.locator("video")
                video.first.wait_for(state="attached", timeout=5000)
                video.evaluate_all("videos => videos.forEach(v => v.pause())")
                result.append({**item, **player})
            except ProtectedVideo:
                raise
            except Exception as exc:
                last_error = exc
        if result and len(result) == len(frames):
            return result
        page.wait_for_timeout(250)
    raise RuntimeError("Player nativo não carregou uma configuração suportada. " + redact(last_error or "Pode ser um player externo."))


def browser_run(args, output: Path, progress: dict) -> int:
    from playwright.sync_api import sync_playwright

    scope = course_path(args.url)
    profile = Path(args.profile).resolve()
    profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(profile, 0o700)
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(str(profile), headless=False,
                    chromium_sandbox=True, channel="chrome")
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(args.url, wait_until="domcontentloaded")
            print("Faça login no Chrome aberto e deixe o seu curso Hotmart visível.")
            input("Pressione Enter aqui quando estiver pronto: ")
            if course_path(page.url).lower() != scope.lower():
                raise ValueError("O navegador não está no curso solicitado.")
            count_match = re.search(r"\d+/(\d+)\s+conteúdos", page.locator("body").inner_text())
            expected = args.expected_count or (int(count_match.group(1)) if count_match else None)
            if "/content/" not in urlsplit(page.url).path:
                page.get_by_role("button", name="Continuar assistindo", exact=True).click()
            items = expand_modules(page, args.timeout)
            if expected and len(items) != expected:
                raise RuntimeError(f"Inventário incompleto: {len(items)} aulas encontradas; esperado {expected}.")
            for item in items:
                if course_path(item["page_url"]).lower() != scope.lower():
                    raise ValueError("A lista contém link para outro curso.")
            private_json(output / "inventory.json", items)
            print(f"Inventário: {len(items)} aulas em {len(set(x['module_index'] for x in items))} módulos.")
            captured, report = [], []
            user_agent = page.evaluate("navigator.userAgent")
            for item in items[:args.limit or None]:
                try:
                    lessons = capture_lesson(page, item, args.timeout)
                    captured.extend(lessons)
                    private_json(output / "streams.private.json", captured)
                    for lesson in lessons:
                        validation = None
                        if args.command == "validate":
                            validation = validate_lesson(lesson, user_agent)
                        if args.command == "download":
                            for attempt in range(2):
                                try:
                                    download_lesson(lesson, output, progress, user_agent)
                                    break
                                except ProtectedVideo:
                                    raise
                                except Exception:
                                    if attempt:
                                        raise
                                    print("  Atualizando a reprodução autenticada e tentando novamente...")
                                    fresh = capture_lesson(page, item, args.timeout)
                                    lesson.update(next(x for x in fresh if x["playback_id"] == lesson["playback_id"]))
                                    private_json(output / "streams.private.json", captured)
                    status = {"download": "done", "inspect": "captured", "validate": "validated"}[args.command]
                    report.append({"index": item["index"], "title": item["title"], "status": status})
                except Exception as exc:
                    status = "protected" if isinstance(exc, ProtectedVideo) else "failed"
                    report.append({"index": item["index"], "title": item["title"], "status": status, "reason": redact(exc)})
                    print(f"{status}: {item['title']}: {redact(exc)}", file=sys.stderr)
                private_json(output / "report.json", report)
            failed = sum(x["status"] in ("failed", "protected") for x in report)
            print(f"{len(report) - failed} aulas OK; {failed} não baixadas. Detalhes em report.json.")
            return 1 if failed else 0
        finally:
            context.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("download", "inspect", "validate"):
        p = sub.add_parser(command)
        p.add_argument("url", nargs="?", default=DEFAULT_URL)
        p.add_argument("--profile", default=".hotmart-profile")
        p.add_argument("--timeout", type=int, default=30)
        p.add_argument("--expected-count", type=int)
        p.add_argument("--output", help="Padrão: downloads/Hotmart/<slug do curso>")
        p.add_argument("--limit", type=int, default=1 if command == "validate" else 0)
    p = sub.add_parser("from-manifest")
    p.add_argument("manifest", type=Path)
    p.add_argument("--output", help="Padrão: downloads/Hotmart/<slug do curso>")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--user-agent", default="Mozilla/5.0")
    args = parser.parse_args(argv)
    if args.limit < 0:
        parser.error("--limit deve ser >= 0")
    if args.command in ("download", "from-manifest") and any(not shutil.which(c) for c in ("ffmpeg", "ffprobe")):
        parser.error("Instale FFmpeg (inclui ffprobe).")
    try:
        lessons = json.loads(args.manifest.read_text()) if args.command == "from-manifest" else None
        if lessons is not None and (not isinstance(lessons, list) or not lessons):
            raise ValueError("O manifesto deve conter uma lista de aulas.")
        requested_url = lessons[0]["page_url"] if lessons else args.url
        output = Path(args.output or default_output(requested_url)).resolve()
        output.mkdir(parents=True, exist_ok=True)
        progress_path = output / "progress.json"
        progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
        if args.command != "from-manifest":
            return browser_run(args, output, progress)
        report = []
        for lesson in lessons[:args.limit or None]:
            try:
                course_path(lesson["page_url"])
                download_lesson(lesson, output, progress, args.user_agent)
                report.append({"index": lesson["index"], "title": lesson["title"], "status": "done"})
            except Exception as exc:
                report.append({"index": lesson.get("index"), "title": lesson.get("title"),
                               "status": "protected" if isinstance(exc, ProtectedVideo) else "failed", "reason": redact(exc)})
                print(f"Falhou: {lesson.get('title')}: {redact(exc)}", file=sys.stderr)
            private_json(output / "report.json", report)
        failed = sum(x["status"] != "done" for x in report)
        print(f"{len(report) - failed} vídeos OK; {failed} não baixados.")
        return 1 if failed else 0
    except (KeyboardInterrupt, EOFError):
        print("Interrompido. Execute novamente para retomar.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(redact(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
