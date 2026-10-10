import json
import os
import threading
import unittest
from http.client import HTTPConnection
from unittest.mock import patch
from http.server import ThreadingHTTPServer

from resolver.app import Handler
from resolver.formats import allowed_url, normalize, MediaUnavailable
from resolver.validate import classify, InvalidLink

MP4 = "https://video.xx.fbcdn.net/v/t1.mp4"
MP4_SD = "https://video.xx.fbcdn.net/v/t2.mp4"
POSTER = "https://scontent.cdninstagram.com/poster.jpg"
IMAGE = "https://scontent.cdninstagram.com/full.jpg"


class ValidationTests(unittest.TestCase):
    def test_urls(self):
        cases = [("https://www.facebook.com/reel/123", ("facebook", "reel")),
                 ("https://fb.watch/AbCdE/", ("facebook", "video")),
                 ("https://instagram.com/reel/Cabc123/", ("instagram", "reel")),
                 ("https://www.instagram.com/p/Cabc123/", ("instagram", "photo"))]
        for url, expected in cases:
            self.assertEqual(classify(url)[:2], expected)

    def test_ssrf_rejections(self):
        for url in ["https://instagram.com.evil.test/p/x", "http://instagram.com/p/x",
                    "https://facebook.com:8000/reel/x", "https://127.0.0.1/private",
                    "https://www.facebook.com.evil.org/reel/123"]:
            with self.assertRaises(InvalidLink):
                classify(url)

    def test_cdn_allowlist(self):
        self.assertTrue(allowed_url(IMAGE))
        self.assertFalse(allowed_url("https://fbcdn.net.attacker.invalid/a.mp4"))
        self.assertFalse(allowed_url("https://127.0.0.1/test.mp4"))
        self.assertFalse(allowed_url("http://video.xx.fbcdn.net/v.mp4"))

    def test_progressive_video_selection(self):
        data = {"extractor_key": "Facebook", "title": "Video", "thumbnail": POSTER,
                "formats": [{"url": MP4, "ext": "mp4", "height": 1080, "acodec": "aac", "vcodec": "h264", "protocol": "https"},
                            {"url": MP4_SD, "ext": "mp4", "height": 480, "acodec": "aac", "vcodec": "h264", "protocol": "https"},
                            {"url": "https://x.fbcdn.net/hls.m3u8", "ext": "mp4", "height": 720, "protocol": "m3u8_native"},
                            {"url": "https://x.fbcdn.net/novol.mp4", "ext": "mp4", "height": 720, "acodec": "none"}]}
        result = normalize(data, "facebook", "video")
        self.assertEqual([v["label"] for v in result["items"][0]["variants"]], ["HD · 1080p", "SD · 480p"])

    def test_image_and_carousel(self):
        one = {"formats": [{"url": IMAGE, "ext": "jpg", "width": 1080, "height": 1080}]}
        data = {"extractor_key": "Instagram", "_type": "playlist", "title": "Photo",
                "entries": [one, one]}
        result = normalize(data, "instagram", "photo")
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["items"][0]["variants"][0]["mime"], "image/jpeg")

    def test_no_thumbnail_as_full_resolution(self):
        with self.assertRaises(MediaUnavailable):
            normalize({"extractor_key": "Instagram", "thumbnail": IMAGE}, "instagram", "photo")

    def test_profile_rejected(self):
        with self.assertRaises(MediaUnavailable):
            normalize({"extractor_key": "Instagram"}, "instagram", "profile")

    def test_video_only_rejected(self):
        with self.assertRaises(MediaUnavailable):
            normalize({"extractor_key": "Facebook", "thumbnail": POSTER, "formats": [
                {"url": MP4, "ext": "mp4", "acodec": "none"}]}, "facebook", "video")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def call(self, path, payload=None, key="x" * 40):
        conn = HTTPConnection("127.0.0.1", self.server.server_port, timeout=4)
        data = None if payload is None else json.dumps(payload)
        headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
        conn.request("GET" if payload is None else "POST", path, data, headers)
        res = conn.getresponse()
        obj = json.loads(res.read())
        status = res.status
        conn.close()
        return status, obj

    def test_health(self):
        code, obj = self.call("/health")
        self.assertEqual(code, 200)
        self.assertEqual(obj["status"], "ok")

    def test_auth_and_link_validation(self):
        p = {"url": "https://instagram.com/p/a1/", "platform": "instagram", "type": "photo"}
        with patch.dict(os.environ, {"RESOLVER_API_KEY": "x" * 40}):
            self.assertEqual(self.call("/api/resolve", p, key="incorrect")[0], 401)
            self.assertEqual(self.call("/api/resolve", {**p, "type": "video"})[0], 400)
            self.assertEqual(self.call("/api/resolve", {**p, "url": "https://evil.test/"})[0], 400)

    def test_profile_is_not_faked(self):
        with patch.dict(os.environ, {"RESOLVER_API_KEY": "x" * 40}):
            code, obj = self.call("/api/resolve", {"url": "https://www.instagram.com/user/", "platform": "instagram", "type": "profile"})
            self.assertEqual(code, 422)
            self.assertEqual(obj["code"], "PROFILE_UNAVAILABLE")

    def test_success_adapter(self):
        from unittest.mock import Mock
        body = json.dumps({"title": "Video", "items": [{"kind": "video"}]})
        with patch.dict(os.environ, {"RESOLVER_API_KEY": "x" * 40}), patch("resolver.app.subprocess.run", return_value=Mock(returncode=0, stdout=body)):
            code, obj = self.call("/api/resolve", {"url": "https://facebook.com/reel/123", "platform": "facebook", "type": "reel"})
            self.assertEqual(code, 200)
            self.assertEqual(obj["title"], "Video")


if __name__ == "__main__":
    unittest.main()
class PhotoPostTests(unittest.TestCase):
    def test_image_messages_and_carousel(self):
        from resolver.photos import parse_photo_messages
        messages = [
            (2, "", {"id": "photo-post"}),
            (3, "https://scontent.cdninstagram.com/1.jpg?x=1", {"extension": "jpg", "num": 1}),
            (3, "https://scontent.cdninstagram.com/2.jpg?x=2", {"extension": "jpg", "num": 2}),
            (3, "https://scontent.cdninstagram.com/video.mp4", {"extension": "mp4", "num": 3}),
        ]
        result = parse_photo_messages(messages)
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["items"][0]["kind"], "image")
        self.assertEqual(result["items"][1]["variants"][0]["mime"], "image/jpeg")

    def test_rejects_non_cdn_and_empty(self):
        from resolver.photos import parse_photo_messages
        from resolver.formats import MediaUnavailable
        with self.assertRaises(MediaUnavailable):
            parse_photo_messages([(3, "https://evil.example/1.jpg", {"extension": "jpg"})])
        with self.assertRaises(MediaUnavailable):
            parse_photo_messages([])

    def test_rejects_duplicate_images_and_untrusted_media(self):
        from resolver.photos import parse_photo_messages
        url = "https://scontent.cdninstagram.com/1.jpg"
        output = parse_photo_messages([
            (3, url, {"extension": "jpg"}),
            (3, url, {"extension": "jpg"}),
            (3, "http://scontent.cdninstagram.com/2.jpg", {"extension": "jpg"}),
        ])
        self.assertEqual(len(output["items"]), 1)

    def test_gallery_extractor_must_initialize_before_items(self):
        from unittest.mock import patch
        from resolver.photos import extract_photo_post

        class FakeExtractor:
            category = "instagram"
            def __init__(self):
                self.initialized = False
            def initialize(self):
                self.initialized = True
            def items(self):
                if not self.initialized:
                    raise AttributeError("Instagram API client is uninitialized")
                yield (3, "https://scontent.cdninstagram.com/verified.jpg", {"extension": "jpg"})
            def __iter__(self):
                self.initialize()
                return self.items()

        fake = FakeExtractor()
        with patch("gallery_dl.extractor.find", return_value=fake):
            result = extract_photo_post("https://www.instagram.com/p/C123test/")
        self.assertTrue(fake.initialized)
        self.assertEqual(result["items"][0]["kind"], "image")
        self.assertEqual(len(result["items"]), 1)

    def test_installed_gallery_dl_matches_instagram_photo_posts(self):
        # Matcher only, does not access Instagram or retrieve media.
        from gallery_dl import extractor
        found = extractor.find("https://www.instagram.com/p/C123test/?img_index=1")
        self.assertIsNotNone(found)
        self.assertEqual(found.category, "instagram")

    def test_route_uses_gallery_for_instagram_photos(self):
        from unittest.mock import patch
        from resolver.extract import extract
        payload = {"title": "Photos", "items": [{"kind": "image"}]}
        with patch("resolver.photos.extract_photo_post", return_value=payload) as mocked:
            result = extract("https://www.instagram.com/p/DeRiLutEwdi/?img_index=1")
        self.assertEqual(result, payload)
        mocked.assert_called_once_with("https://www.instagram.com/p/DeRiLutEwdi/?img_index=1")


class PhotoAccessDiagnosticsTests(unittest.TestCase):
    def test_login_redirect_reports_server_login_gate(self):
        from resolver.photos import classified_failure
        error = classified_failure(RuntimeError("HTTP redirect to login page (https://www.instagram.com/accounts/login/)"))
        self.assertEqual(error.code, "PHOTO_LOGIN_GATE")
        self.assertNotIn("https:", str(error))
    def test_rate_limit_is_not_private(self):
        from resolver.photos import classified_failure
        error = classified_failure(RuntimeError("429 Too Many Requests"))
        self.assertEqual(error.code, "PHOTO_RATE_LIMITED")
    def test_forbidden_and_challenge(self):
        from resolver.photos import classified_failure
        self.assertEqual(classified_failure(RuntimeError("403 Forbidden")).code, "PHOTO_ACCESS_BLOCKED")
        self.assertEqual(classified_failure(RuntimeError("Challenge required")).code, "PHOTO_CHALLENGE")
    def test_unknown_error_is_not_labeled_private(self):
        from resolver.photos import classified_failure
        error = classified_failure(RuntimeError("upstream library error containing URL and token"))
        self.assertEqual(error.code, "PHOTO_EXTRACTOR_ERROR")
        self.assertNotIn("token", str(error))
