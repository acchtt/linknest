"""One isolated yt-dlp metadata job; stdout is a small JSON payload, never media bytes."""
from __future__ import annotations
import json
import sys
from .formats import normalize, MediaUnavailable
from .validate import classify, InvalidLink


def extract(url: str):
    platform, kind, normalized = classify(url)
    if kind == "profile":
        raise MediaUnavailable("Full-size profile pictures are not available through this public-only resolver.")
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError("yt-dlp dependency is missing") from exc
    options = {
        "quiet": True, "no_warnings": True, "noplaylist": False,
        "playlistend": 10, "skip_download": True,
        "extract_flat": False, "cachedir": False,
        "socket_timeout": 7, "retries": 0, "extractor_retries": 0,
        "ignoreerrors": False, "nocheckcertificate": False,
        "load_pages": False,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        try:
            info = ydl.extract_info(normalized, download=False)
        except yt_dlp.utils.DownloadError as exc:
            raise MediaUnavailable("Content is private, unavailable, rate-limited, or unsupported by the public extractor.") from exc
    return normalize(info, platform, kind)


if __name__ == "__main__":
    try:
        result = extract(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    except (MediaUnavailable, InvalidLink) as exc:
        print(json.dumps({"error": str(exc), "code": "MEDIA_UNAVAILABLE"}))
        sys.exit(2)
    except Exception:
        print(json.dumps({"error": "The extractor could not process this post.", "code": "EXTRACTOR_FAILED"}))
        sys.exit(3)