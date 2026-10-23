import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from whop_downloader import (ProtectedVideo, assert_unencrypted, check_manifests,
                             lesson_key, private_json, redact, safe_name, select_player, validate_stream)


class DownloaderTests(unittest.TestCase):
    def test_lesson_identity_survives_url_expiry(self):
        first = {"page_url": "https://whop.com/a/lessons/lesn_123/", "url": "https://stream.mux.com/abc.m3u8?token=old"}
        second = {**first, "url": first["url"].replace("old", "new")}
        self.assertEqual(lesson_key(first), lesson_key(second))
        self.assertNotEqual(lesson_key(first), lesson_key({**first, "page_url": "https://whop.com/a/lessons/lesn_456/"}))

    def test_names_cannot_escape_download_directory(self):
        self.assertNotIn("/", safe_name("../../video:name?"))
        self.assertNotIn("\\", safe_name("a\\b"))
        self.assertEqual(safe_name("..."), "Aula")

    def test_manifest_private_permissions_even_when_overwriting(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "streams.json"
            path.write_text("old")
            path.chmod(0o644)
            private_json(path, [{"token": "private"}])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), [{"token": "private"}])

    def test_reject_encryption_and_drm(self):
        for marker in [
            '#EXT-X-KEY:METHOD=AES-128,URI="key"',
            '#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd://key"',
            '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,URI="license"',
        ]:
            with self.subTest(marker=marker), self.assertRaises(ProtectedVideo):
                assert_unencrypted("#EXTM3U\n" + marker)

    def test_unencrypted_playlist_and_method_none(self):
        assert_unencrypted("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:5\nsegment.ts")

    def test_login_html_is_not_accepted_as_hls(self):
        with self.assertRaises(ValueError):
            assert_unencrypted("<html>Sign in</html>")

    def test_reject_untrusted_provider(self):
        for url in ["https://stream.mux.com.evil.invalid/a.m3u8", "http://stream.mux.com/a.m3u8", "https://example.com/a.m3u8"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_stream(url)

    def test_checks_encrypted_rendition_before_media_download(self):
        root = "https://stream.mux.com/a.m3u8?token=private"
        child = "https://manifest.edgemv.mux.com/video.m3u8"
        docs = {root: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123\n" + child,
                child: '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="license"'}
        calls = []

        def fetch(req, timeout):
            calls.append(req.full_url)
            return io.BytesIO(docs[req.full_url].encode())

        with patch("whop_downloader.urlopen", side_effect=fetch), self.assertRaises(ProtectedVideo):
            check_manifests(root, {})
        self.assertEqual(calls, [root, child])

    def test_checks_audio_rendition_too(self):
        root = "https://stream.mux.com/a.m3u8"
        docs = {root: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"',
                "https://stream.mux.com/audio.m3u8": '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"'}
        with patch("whop_downloader.urlopen", side_effect=lambda req, timeout: io.BytesIO(docs[req.full_url].encode())), self.assertRaises(ProtectedVideo):
            check_manifests(root, {})

    def test_reject_external_child_before_fetch(self):
        master = b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://evil.invalid/video.m3u8"
        with patch("whop_downloader.urlopen", return_value=io.BytesIO(master)) as fetch, self.assertRaises(ValueError):
            check_manifests("https://stream.mux.com/a.m3u8", {})
        self.assertEqual(fetch.call_count, 1)

    def test_error_logs_omit_signed_url(self):
        self.assertNotIn("private", redact("HTTP 403: https://stream.mux.com/a.m3u8?token=private"))

    def test_navigation_does_not_assign_previous_stream_to_new_lesson(self):
        old = {"title": "New lesson", "playback_id": "previous", "url": "https://stream.mux.com/previous.m3u8"}
        loading = {**old, "playback_id": "next"}
        ready = {**loading, "url": "https://stream.mux.com/next.m3u8?token=current"}
        self.assertIsNone(select_player([old], "New lesson", "next"))
        self.assertIsNone(select_player([loading], "New lesson", "next"))
        self.assertEqual(select_player([ready], "New lesson", "next"), ready)
        self.assertIsNone(select_player([ready, ready], "New lesson", "next"))


if __name__ == "__main__":
    unittest.main()
