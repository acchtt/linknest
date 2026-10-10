"""Minimal Railway-compatible authenticated resolver. No stored requests or media."""
from __future__ import annotations
import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .validate import classify, InvalidLink

CAPACITY = threading.BoundedSemaphore(2)
MAX_BODY = 4096


class Handler(BaseHTTPRequestHandler):
    server_version = "LinkNestResolver"
    sys_version = ""

    # Keep user URLs, media URLs and auth tokens out of server logs.
    def log_message(self, *_args):
        return

    def respond(self, status: int, data: dict) -> None:
        raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok", "engine": "yt-dlp"})
        else:
            self.respond(404, {"error": "Not found", "code": "NOT_FOUND"})

    def do_POST(self):
        if self.path != "/api/resolve":
            return self.respond(404, {"error": "Not found", "code": "NOT_FOUND"})
        key = os.getenv("RESOLVER_API_KEY", "")
        supplied = self.headers.get("Authorization", "")
        if len(key) < 32 or not hmac.compare_digest(supplied, f"Bearer {key}"):
            return self.respond(401, {"error": "Unauthorized", "code": "UNAUTHORIZED"})
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            return self.respond(415, {"error": "Expected JSON", "code": "INVALID_REQUEST"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = -1
        if not 0 < size <= MAX_BODY:
            return self.respond(413, {"error": "Invalid request size", "code": "INVALID_REQUEST"})
        try:
            body = json.loads(self.rfile.read(size))
            platform, kind, normalized = classify(body.get("url"))
            if body.get("platform") != platform or body.get("type") != kind:
                raise InvalidLink("Platform or media type mismatch.")
        except (InvalidLink, ValueError, TypeError, AttributeError):
            return self.respond(400, {"error": "Invalid or unsupported media link", "code": "INVALID_URL"})
        if kind == "profile":
            return self.respond(422, {"error": "Full-size public profile pictures need an authorized account API.", "code": "PROFILE_UNAVAILABLE"})
        if not CAPACITY.acquire(blocking=False):
            return self.respond(429, {"error": "Service is busy; retry later.", "code": "BUSY"})
        try:
            # Run each extraction in a bounded subprocess so overlong jobs can be killed.
            try:
                done = subprocess.run([sys.executable, "-m", "resolver.extract", normalized],
                                      capture_output=True, text=True, timeout=28, check=False)
            except subprocess.TimeoutExpired:
                return self.respond(503, {"error": "Media service timed out.", "code": "TIMEOUT"})
            try:
                payload = json.loads(done.stdout[:128_000])
            except (json.JSONDecodeError, ValueError):
                return self.respond(502, {"error": "Media extraction failed.", "code": "EXTRACTOR_FAILED"})
            if done.returncode == 2:
                return self.respond(422, {"error": payload.get("error", "Public media unavailable"),
                                          "code": "PHOTO_EXTRACTION_UNAVAILABLE" if platform == "instagram" and kind == "photo" else "MEDIA_UNAVAILABLE"})
            if done.returncode != 0:
                return self.respond(502, {"error": "Media extraction failed.", "code": "EXTRACTOR_FAILED"})
            return self.respond(200, payload)
        finally:
            CAPACITY.release()


def run():
    port = int(os.getenv("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    run()