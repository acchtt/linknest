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