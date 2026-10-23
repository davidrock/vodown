"""Optional real Chrome test: WHOP_BROWSER_TEST=1 python -m unittest discover -s tests."""
import os
import unittest

from whop_downloader import PLAYER_SCRIPT, LESSON_SCRIPT, lesson_button, select_player


@unittest.skipUnless(os.environ.get("WHOP_BROWSER_TEST") == "1", "Teste opcional com Chrome instalado")
class BrowserTests(unittest.TestCase):
    def test_multiline_lesson_labels_and_delayed_shadow_dom_stream(self):
        from playwright.sync_api import sync_playwright

        html = '''
        <button onclick="switchLesson()">
          <img alt="Next lesson" src="https://image.mux.com/new-id/thumbnail.webp">
          <div><span>Next lesson</span><br><span>Multimedia • 1:00</span></div>
        </button>
        <mux-player title="Previous lesson" playback-id="old-id"></mux-player>
        <script>
        const p=document.querySelector('mux-player');
        const v=document.createElement('mux-video');
        v.setAttribute('src','https://stream.mux.com/old-id.m3u8?token=old');
        p.attachShadow({mode:'open'}).append(v);
        function switchLesson(){
          p.setAttribute('title','Next lesson');
          p.setAttribute('playback-id','new-id');
          setTimeout(()=>v.setAttribute('src','https://stream.mux.com/new-id.m3u8?token=current'),1000);
        }
        </script>'''
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=True, chromium_sandbox=True)
            try:
                page = browser.new_page()
                # All requests are fulfilled locally, including the dummy thumbnail.
                page.route("**/*", lambda route: route.fulfill(status=200, body=""))
                page.set_content(html)
                lessons = page.main_frame.evaluate(LESSON_SCRIPT)
                self.assertEqual(len(lessons), 1)
                self.assertEqual(lessons[0]["playback_id"], "new-id")
                button = lesson_button(page.main_frame, lessons[0]["label"])
                self.assertEqual(button.count(), 1)
                button.click()
                self.assertIsNone(select_player(page.main_frame.evaluate(PLAYER_SCRIPT), "Next lesson", "new-id"))
                page.wait_for_timeout(1250)
                selected = select_player(page.main_frame.evaluate(PLAYER_SCRIPT), "Next lesson", "new-id")
                self.assertIsNotNone(selected)
                self.assertIn("token=current", selected["url"])
            finally:
                browser.close()
