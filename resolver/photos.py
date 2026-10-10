"""Instagram public photo-post metadata via gallery-dl. Does not download files.

Gallery-dl handles image posts/carousels; yt-dlp is a video extractor.
Do not load account cookies, login state or arbitrary URLs. All returned
media URLs must be on the existing approved HTTPS CDN allowlist.
"""
from __future__ import annotations

from urllib.parse import urlsplit
from .formats import IMAGE_EXT, MediaUnavailable, allowed_url


def parse_photo_messages(messages):
    """Convert gallery-dl URL messages to LinkNest's bounded media contract."""
    items = []
    seen = set()
    for message in messages:
        if not isinstance(message, (list, tuple)) or len(message) < 3:
            continue
        # gallery_dl.extractor.message.Message.Url is the stable value 3.
        if message[0] != 3:
            continue
        url, metadata = message[1], message[2]
        if not isinstance(metadata, dict) or not isinstance(url, str):
            continue
        ext = str(metadata.get("extension") or metadata.get("ext") or "").lower().lstrip(".")
        if not ext:
            ext = urlsplit(url).path.rsplit(".", 1)[-1].lower()
        if ext not in IMAGE_EXT or not allowed_url(url) or url in seen:
            continue
        seen.add(url)
        mime = IMAGE_EXT[ext]
        items.append({
            "kind": "image",
            "imageUrl": url,
            "thumbnailUrl": url,
            "thumbnailMime": mime,
            "variants": [{
                "label": "Best available photo",
                "url": url,
                "mime": mime,
            }],
        })
        if len(items) == 10:
            break
    if not items:
        raise MediaUnavailable("No direct public photo files were exposed by the Instagram image extractor.")
    return {"title": "Instagram photo post", "items": items}


def extract_photo_post(url):
    try:
        from gallery_dl import extractor
    except ImportError as exc:
        raise MediaUnavailable("Instagram photo extractor is not installed.") from exc
    try:
        image_extractor = extractor.find(url)
        if image_extractor is None or image_extractor.category != "instagram":
            raise MediaUnavailable("Unsupported Instagram photo extractor.")
        return parse_photo_messages(image_extractor.items())
    except MediaUnavailable:
        raise
    except Exception as exc:
        # Do not expose authentication cookies, post URLs or library traceback.
        raise MediaUnavailable("Instagram did not make photo metadata accessible to the public extractor.") from exc
