import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from hotmart_downloader import (ProtectedVideo, check_manifests, check_playlist, course_path,
                               default_output, lesson_key, main, parse_player, saved_video, trusted_media_url, validate_lesson)

BASE = "https://vod-akm.play.hotmart.com/video/abc/hls/master.m3u8?hdnts=temporary"
KEY = "https://contentplayer.hotmart.com/video/abc/mp4/key/abc.key?token=authorized"


def player_data(**changes):
    app = {"mediaCode": "abc", "mediaDuration": 60, "isDrmEnabled": False,
           "flags": {"ENABLE_PLAYER_V4_ENCRYPTION": False},
           "mediaAssets": [{"url": BASE, "height": 1080, "urlEncrypted": "https://evil.invalid/encrypted.m3u8"}]}
    app.update(changes)
    return {"props": {"pageProps": {"applicationData": app}}}


class Response(io.BytesIO):
    def __init__(self, url, body):
        super().__init__(body.encode())
        self.url = url

    def geturl(self):
        return self.url


class HotmartTests(unittest.TestCase):
    def test_standard_hls_aes128_uses_normal_authorized_key_uri(self):
        self.assertEqual(check_playlist(f'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="{KEY}"\n#EXTINF:5\nchunk.ts', BASE), [])

    def test_reject_drm_methods_and_key_formats(self):
        for line in [
            f'#EXT-X-KEY:METHOD=SAMPLE-AES,URI="{KEY}"',
            '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT="urn:uuid:edef8ba9",URI="license"',
            f'#EXT-X-KEY:METHOD=AES-128,KEYFORMAT="com.apple.streamingkeydelivery",URI="{KEY}"',
        ]:
            with self.subTest(line=line), self.assertRaises(ProtectedVideo):
                check_playlist("#EXTM3U\n" + line, BASE)

    def test_untrusted_key_is_rejected(self):
        with self.assertRaises(ValueError):
            check_playlist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.invalid/key"', BASE)

    def test_trusted_hosts_require_https_and_exact_suffix(self):
        trusted_media_url(KEY)
        for url in ["http://vod-akm.play.hotmart.com/a", "https://play.hotmart.com.evil.invalid/a",
                    "https://contentplayer.hotmart.com.evil.invalid/a", "https://user:pass@vod-akm.play.hotmart.com/a"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                trusted_media_url(url)

    def test_player_flags_have_priority_over_url_availability(self):
        for data in [player_data(isDrmEnabled=True), player_data(isDrmEnabled=None),
                     player_data(flags={"ENABLE_PLAYER_V4_ENCRYPTION": True})]:
            with self.subTest(data=data), self.assertRaises(ProtectedVideo):
                parse_player(data)

    def test_player_captures_exact_url_without_editing_signature(self):
        result = parse_player(player_data(), "abc")
        self.assertEqual(result["url"], BASE)
        self.assertEqual(result["duration"], 60)

    def test_old_player_cannot_be_associated_with_new_lesson(self):
        with self.assertRaises(ValueError):
            parse_player(player_data(), "next-media")

    def test_drm_in_child_audio_playlist_is_detected_before_download(self):
        audio = "https://vod-akm.play.hotmart.com/video/abc/hls/audio.m3u8"
        docs = {BASE: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"',
                audio: f'#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="{KEY}"'}
        calls = []

        class Opener:
            def open(self, request, timeout):
                calls.append(request.full_url)
                return Response(request.full_url, docs[request.full_url])

        with patch("hotmart_downloader.build_opener", return_value=Opener()), self.assertRaises(ProtectedVideo):
            check_manifests(BASE, {})
        self.assertEqual(calls, [BASE, audio])

    def test_broken_seek_preview_is_not_needed_for_full_video(self):
        master = f'#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="{KEY}"\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="missing-preview.m3u8"'
        self.assertEqual(check_playlist(master, BASE), [])

    def test_identity_ignores_signed_url_expiry_but_includes_lesson_and_video(self):
        lesson = {"page_url": "https://hotmart.com/pt-br/club/test/products/123/content/one", "playback_id": "abc", "url": BASE}
        self.assertEqual(lesson_key(lesson), lesson_key({**lesson, "url": BASE + "&new=token"}))
        self.assertNotEqual(lesson_key(lesson), lesson_key({**lesson, "playback_id": "def"}))

    def test_course_scope_cannot_escape_hotmart(self):
        self.assertEqual(course_path("https://hotmart.com/pt-BR/club/test/products/123/content/one"), "/pt-BR/club/test/products/123")
        with self.assertRaises(ValueError):
            course_path("https://evil.invalid/pt-BR/club/test/products/123/content/one")

    def test_progress_path_cannot_traverse_outside_output(self):
        lesson = {"page_url": "https://hotmart.com/pt-BR/club/test/products/123/content/one", "playback_id": "abc"}
        with tempfile.TemporaryDirectory() as temp:
            progress = {lesson_key(lesson): {"file": "../outside.mp4", "status": "done"}}
            with self.assertRaises(ValueError):
                saved_video(lesson, Path(temp), progress)

    def test_another_course_gets_its_own_folder(self):
        first = default_output("https://hotmart.com/pt-br/club/first-course/products/123")
        second = default_output("https://hotmart.com/en/club/second-course/products/456/content/lesson")
        self.assertEqual(first, Path("downloads/Hotmart/first-course"))
        self.assertEqual(second, Path("downloads/Hotmart/second-course"))
        self.assertNotEqual(first, second)

    def test_validation_checks_formats_without_downloading_segments(self):
        lesson = {"url": BASE, "title": "Aula de teste", "duration": 60, "drm": False}
        with patch("hotmart_downloader.check_manifests") as check, patch("yt_dlp.YoutubeDL") as factory:
            engine = factory.return_value.__enter__.return_value
            engine.extract_info.return_value = {"formats": [{"height": 1080, "vcodec": "h264", "has_drm": False}]}
            result = validate_lesson(lesson)
            self.assertFalse(result["segments_downloaded"])
            self.assertEqual(result["heights"], [1080])
            engine.extract_info.assert_called_once_with(BASE, download=False)
            engine.download.assert_not_called()
            check.assert_called_once()

    def test_validate_command_defaults_to_one_lesson_for_any_course(self):
        url = "https://hotmart.com/en/club/another-course/products/999"
        with tempfile.TemporaryDirectory() as temp, patch("hotmart_downloader.browser_run", return_value=0) as browser:
            self.assertEqual(main(["validate", url, "--output", temp]), 0)
            args = browser.call_args.args[0]
            self.assertEqual(args.url, url)
            self.assertEqual(args.command, "validate")
            self.assertEqual(args.limit, 1)


@unittest.skipUnless(os.environ.get("WHOP_BROWSER_TEST") == "1", "Teste opcional com Chrome instalado")
class HotmartBrowserTests(unittest.TestCase):
    def test_module_inventory_and_native_iframe_capture(self):
        from playwright.sync_api import sync_playwright
        from hotmart_downloader import capture_lesson, expand_modules

        lesson_url = "https://hotmart.com/pt-BR/club/test/products/123/content/one"
        inventory_html = '''<button aria-expanded="false" aria-controls="sectionId_1"
          onclick="this.setAttribute('aria-expanded','true')">
          <span data-test="module-item-name">Módulo 1</span></button>
          <section id="sectionId_1"><a href="https://hotmart.com/pt-BR/club/test/products/123/content/one?source=CLASS_MODULES_LIST">
          <img data-test="content-background-thumbnail" src="https://api-player-thumbnail.hotmart.com/rest/v1/thumbnail/abc/dimension">
          <span title="Aula 1">Aula 1</span></a></section>'''
        lesson_html = '<h1>Aula 1</h1><iframe src="https://cf-embed.play.hotmart.com/embed/abc"></iframe>'
        embed_html = '<video></video><script type="application/json">' + json.dumps(player_data()) + '</script>'
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
            try:
                page = browser.new_page()

                def route(request):
                    url = request.request.url
                    body = lesson_html if url == lesson_url else embed_html if "/embed/abc" in url else ""
                    request.fulfill(status=200, body=body, content_type="text/html")

                page.route("**/*", route)
                page.set_content(inventory_html)
                items = expand_modules(page, 5)
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]["page_url"], lesson_url)
                self.assertEqual(items[0]["expected_media"], "abc")
                lessons = capture_lesson(page, items[0], 5)
                self.assertEqual(len(lessons), 1)
                self.assertEqual(lessons[0]["url"], BASE)
                self.assertEqual(lessons[0]["module"], "Módulo 1")
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
