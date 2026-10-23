"""Capture normal Whop playback, then download unencrypted HLS locally."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

DEFAULT_URL = "https://whop.com/ecomparadise-pro/exp_KonHrRHXqBBimy/app/courses/cors_2QlPwjJrsJXbjrRbaV4Cnz/lessons/lesn_4bmVM8RDwDWSy94PcOefJ7/"
DEFAULT_UA = "Mozilla/5.0"


class ProtectedVideo(RuntimeError):
    pass


def safe_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r'[\x00-\x1f/\\:*?"<>|]', "-", value)
    return value.strip(" .")[:100] or "Aula"


def lesson_key(lesson: dict) -> str:
    # URLs have expiring query strings; identify the lesson independently of them.
    page_id = re.search(r"/lessons/(lesn_[A-Za-z0-9]+)/?", lesson.get("page_url", ""))
    identity = page_id.group(1) if page_id else lesson.get("playback_id") or urlsplit(lesson["url"]).path
    return hashlib.sha256(identity.encode()).hexdigest()[:12]


def private_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def redact(message: object) -> str:
    return re.sub(r"https?://\S+", "[URL omitida]", str(message))


def validate_stream(url: str) -> None:
    parsed = urlsplit(url)
    # Only the Mux provider observed in this course is supported.
    if parsed.scheme != "https" or parsed.hostname != "stream.mux.com" or not parsed.path.endswith(".m3u8"):
        raise ValueError("Esperava um manifesto HTTPS em stream.mux.com (.m3u8).")


def assert_unencrypted(text: str) -> None:
    if not text.lstrip().startswith("#EXTM3U"):
        raise ValueError("A resposta não é um manifesto HLS.")
    for line in text.splitlines():
        if line.startswith(("#EXT-X-KEY:", "#EXT-X-SESSION-KEY:")):
            if not re.search(r"(?:^|[:,])METHOD=NONE(?:,|$)", line):
                raise ProtectedVideo("Vídeo criptografado/DRM: download interrompido.")


def check_manifests(url: str, headers: dict) -> None:
    """Inspect master and rendition playlists before starting any media transfer."""
    validate_stream(url)
    seen: set[str] = set()

    def visit(current: str, depth: int) -> None:
        if current in seen:
            return
        if depth > 3 or len(seen) >= 40:
            raise ValueError("Manifesto excessivamente complexo; inspeção interrompida.")
        parsed = urlsplit(current)
        if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".mux.com"):
            raise ValueError("Manifesto fora do provedor Mux suportado.")
        seen.add(current)
        with urlopen(Request(current, headers=headers), timeout=30) as response:
            text = response.read(2_000_001).decode("utf-8")
        if len(text) > 2_000_000:
            raise ValueError("Manifesto grande demais.")
        assert_unencrypted(text)
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("#EXT-X-STREAM-INF:"):
                target = next((s.strip() for s in lines[i + 1:] if s.strip() and not s.startswith("#")), None)
                if target:
                    visit(urljoin(current, target), depth + 1)
            if line.startswith("#EXT-X-MEDIA:"):
                match = re.search(r'URI="([^"]+)"', line)
                if match:
                    visit(urljoin(current, match.group(1)), depth + 1)

    visit(url, 0)


def media_info(path: Path) -> dict | None:
    if not path.is_file():
        return None
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
        "-of", "json", str(path),
    ], capture_output=True, text=True)
    if result.returncode:
        return None
    try:
        data = json.loads(result.stdout)
        if float(data["format"]["duration"]) <= 0 or not any(s["codec_type"] == "video" for s in data["streams"]):
            return None
        return data
    except (KeyError, ValueError, TypeError):
        return None


class QuietLogger:
    def debug(self, message):
        pass

    def warning(self, message):
        print("Aviso:", redact(message), file=sys.stderr)

    def error(self, message):
        print("Erro:", redact(message), file=sys.stderr)


def download_lesson(lesson: dict, output: Path, progress: dict, user_agent: str) -> bool:
    from yt_dlp import YoutubeDL

    key = lesson_key(lesson)
    saved = progress.get(key, {})
    existing = output / Path(saved.get("file", "__missing__")).name
    info = media_info(existing)
    if saved.get("status") == "done" and info and existing.stat().st_size == saved.get("bytes"):
        print(f"Já baixada: {lesson['title']}")
        return True
    if lesson.get("drm"):
        raise ProtectedVideo("O player informou DRM; download interrompido.")
    headers = {"Referer": "https://whop.com/", "User-Agent": user_agent}
    check_manifests(lesson["url"], headers)
    filename = f"{lesson['index']:03d} - {safe_name(lesson['title'])} [{key}].mp4"
    target = output / filename
    # Separate completed files from fragments; an interrupted transfer isn't marked done.
    staging = output / ".partial"
    staging.mkdir(exist_ok=True)
    last_update = 0.0

    def on_progress(data):
        nonlocal last_update
        now = time.monotonic()
        if data.get("status") == "downloading" and now - last_update >= 5:
            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
            amount = data.get("downloaded_bytes", 0)
            label = f"{amount / total:.0%}" if total else f"{amount / 1024**2:.1f} MB"
            print(f"  {label}", flush=True)
            last_update = now

    opts = {
        "format": "bv*+ba/b", "merge_output_format": "mp4",
        "outtmpl": str(staging / filename), "http_headers": headers,
        "concurrent_fragment_downloads": 4, "retries": 5, "fragment_retries": 5,
        "skip_unavailable_fragments": False, "continuedl": True,
        "quiet": True, "noprogress": True, "logger": QuietLogger(),
        "progress_hooks": [on_progress], "noplaylist": True,
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
    }
    print(f"Baixando {lesson['index']:03d}: {lesson['title']}", flush=True)
    with YoutubeDL(opts) as downloader:
        downloader.download([lesson["url"]])
    completed = staging / filename
    info = media_info(completed)
    if not info:
        raise RuntimeError("O arquivo não passou na validação de vídeo com ffprobe.")
    completed.replace(target)
    progress[key] = {"status": "done", "file": filename, "title": lesson["title"],
                     "bytes": target.stat().st_size, "duration": float(info["format"]["duration"])}
    private_json(output / "progress.json", progress)
    print(f"Concluída: {filename}", flush=True)
    return True


# Read only DOM attributes, including the Mux web component's open shadow tree.
PLAYER_SCRIPT = """() => {
  const players = [...document.querySelectorAll('mux-player')];
  return players.map(p => {
    const v = p.shadowRoot?.querySelector('mux-video');
    return {title:p.getAttribute('title'), playback_id:p.getAttribute('playback-id'),
      url:v?.getAttribute('src') || p.getAttribute('src'),
      drm:p.hasAttribute('drm-token') || !!v?.hasAttribute('drm-token')};
  });
}"""
LESSON_SCRIPT = """() => [...document.querySelectorAll('button')]
  .filter(b => /Multimedia\\s*•/.test(b.innerText))
  .map(b => {
    const image = b.querySelector('img');
    const src = image?.getAttribute('src');
    const url = src ? new URL(src, location.href) : null;
    return {label:b.innerText, title:b.innerText.split('\\n')[0].trim(),
      playback_id: url?.hostname === 'image.mux.com' ? url.pathname.split('/')[1] : null};
  })"""


def select_player(players: list[dict], title: str, playback_id: str | None = None) -> dict | None:
    matches = [p for p in players if p.get("title") == title
               and p.get("playback_id") and p.get("url")
               and (not playback_id or p["playback_id"] == playback_id)
               and urlsplit(p["url"]).path == f"/{p['playback_id']}.m3u8"]
    return matches[0] if len(matches) == 1 else None


def lesson_button(frame, label: str):
    # innerText includes visual line breaks; locator textContent may concatenate spans.
    pattern = re.compile(r"\s*".join(re.escape(part) for part in label.split()))
    return frame.get_by_role("button").filter(has_text=pattern)


def collect_and_download(args, output: Path, progress: dict) -> int:
    from playwright.sync_api import sync_playwright

    url = urlsplit(args.url)
    if url.scheme != "https" or url.hostname != "whop.com" or "/courses/" not in url.path:
        raise ValueError("Forneça a URL HTTPS de uma aula/curso em whop.com.")
    profile = Path(args.profile).resolve()
    profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(profile, 0o700)
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(str(profile), headless=False, chromium_sandbox=True,
                    **({"channel": "chrome"} if args.chrome else {}))
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(args.url, wait_until="domcontentloaded")
            print("No navegador aberto, faça login e deixe a lista de aulas visível.")
            input("Pressione Enter aqui quando o curso estiver aberto: ")
            page.wait_for_timeout(1000)
            frame = next((f for f in page.frames if f.locator("mux-player").count()), None)
            if not frame:
                raise RuntimeError("Mux Player não encontrado. Abra uma aula de vídeo e tente novamente.")
            lessons = frame.evaluate(LESSON_SCRIPT)
            if not lessons:
                raise RuntimeError("Lista de aulas não encontrada. Expanda os módulos do curso.")
            print(f"Encontradas {len(lessons)} aulas de vídeo visíveis.")
            user_agent = page.evaluate("navigator.userAgent")
            captured = []
            failed = 0
            for index, item in enumerate(lessons, 1):
                if args.limit and index > args.limit:
                    break
                try:
                    # Exact rendered label avoids clicking 'next' or unrelated controls.
                    button = lesson_button(frame, item["label"])
                    if button.count() != 1:
                        raise RuntimeError("Controle da aula ambíguo; navegação interrompida.")
                    button.click()
                    deadline = time.monotonic() + args.timeout
                    player = None
                    while time.monotonic() < deadline:
                        players = frame.evaluate(PLAYER_SCRIPT)
                        player = select_player(players, item["title"], item.get("playback_id"))
                        if player:
                            break
                        page.wait_for_timeout(250)
                    if not player:
                        raise RuntimeError("Player não carregou a aula esperada; nenhum vídeo foi atribuído a ela.")
                    lesson = {**player, "index": index, "page_url": page.url}
                    validate_stream(lesson["url"])
                    captured.append(lesson)
                    private_json(output / "streams.private.json", captured)
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
                                # Normal authenticated reload obtains a fresh signed playback URL.
                                print("  Atualizando a URL de reprodução e tentando novamente...")
                                page.reload(wait_until="domcontentloaded")
                                deadline = time.monotonic() + args.timeout
                                while time.monotonic() < deadline:
                                    frame = next((f for f in page.frames if f.locator("mux-player").count()), None)
                                    players = frame.evaluate(PLAYER_SCRIPT) if frame else []
                                    fresh = select_player(players, lesson["title"], lesson["playback_id"])
                                    if fresh:
                                        lesson.update(fresh)
                                        captured[-1] = lesson
                                        private_json(output / "streams.private.json", captured)
                                        break
                                    page.wait_for_timeout(250)
                                else:
                                    raise RuntimeError("Não foi possível renovar o acesso ao vídeo.")
                except Exception as exc:
                    failed += 1
                    print(f"Falhou: {item['title']}: {redact(exc)}", file=sys.stderr)
            print(f"{len(captured)} aulas capturadas; {failed} falhas.")
            return 1 if failed else 0
        finally:
            context.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("download", "inspect"):
        p = sub.add_parser(name, help="Abrir navegador e baixar/capturar as aulas visíveis")
        p.add_argument("url", nargs="?", default=DEFAULT_URL)
        p.add_argument("--profile", default=".whop-profile")
        p.add_argument("--chrome", action="store_true", help="Usar Chrome instalado com perfil isolado")
        p.add_argument("--timeout", type=int, default=30)
        p.add_argument("--limit", type=int, default=0)
        p.add_argument("--output", default="downloads/Ecom Paradise")
    p = sub.add_parser("from-manifest", help="Baixar URLs já capturadas em JSON local")
    p.add_argument("manifest", type=Path)
    p.add_argument("--user-agent", default=DEFAULT_UA)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--output", default="downloads/Ecom Paradise")
    args = parser.parse_args(argv)
    if args.limit < 0:
        parser.error("--limit deve ser >= 0")
    if args.command != "inspect" and any(not shutil.which(c) for c in ("ffmpeg", "ffprobe")):
        parser.error("Instale FFmpeg (inclui ffprobe): brew install ffmpeg")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    progress_path = output / "progress.json"
    progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
    try:
        if args.command != "from-manifest":
            return collect_and_download(args, output, progress)
        lessons = json.loads(args.manifest.read_text())
        if not isinstance(lessons, list) or not lessons:
            raise ValueError("O JSON precisa ser uma lista de aulas.")
        failed = 0
        for lesson in lessons[:args.limit or None]:
            try:
                download_lesson(lesson, output, progress, args.user_agent)
            except Exception as exc:
                failed += 1
                print(f"Falhou: {lesson.get('title', 'Aula')}: {redact(exc)}", file=sys.stderr)
        print(f"{min(args.limit or len(lessons), len(lessons)) - failed} aulas OK; {failed} falhas.")
        return 1 if failed else 0
    except (KeyboardInterrupt, EOFError):
        print("Interrompido. Execute novamente para retomar.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(redact(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
