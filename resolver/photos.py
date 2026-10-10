"""Instagram public photo-post metadata via gallery-dl. Does not download files.

Gallery-dl handles image posts/carousels; yt-dlp is a video extractor.
Do not load account cookies, login state or arbitrary URLs. All returned
media URLs must be on the existing approved HTTPS CDN allowlist.
"""
from __future__ import annotations

from urllib.parse import urlsplit
from .formats import IMAGE_EXT, MediaUnavailable, allowed_url


class PhotoExtractionError(MediaUnavailable):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def classified_failure(exc):
    """Safe failure codes, never reveal cookies, post URLs, or platform responses."""
    detail = str(exc).lower()
    status = getattr(exc, "status", None)
    typename = type(exc).__name__.lower()
    if status == 429 or "429" in detail or "too many requests" in detail:
        return PhotoExtractionError("PHOTO_RATE_LIMITED", "Instagram temporarily rate-limited this server's requests.")
    if ("login" in detail or "authentication" in detail or "authrequired" in typename
            or "authorization" in typename or "401" in detail or status == 401):
        return PhotoExtractionError("PHOTO_LOGIN_GATE", "Instagram requires login for this server's metadata request. The public post itself may be accessible in a browser.")
    if ("challenge" in detail or "captcha" in detail):
        return PhotoExtractionError("PHOTO_CHALLENGE", "Instagram requires a verification challenge from this server.")
    if status == 403 or "403" in detail or "forbidden" in detail:
        return PhotoExtractionError("PHOTO_ACCESS_BLOCKED", "Instagram denied the server's photo metadata request.")
    return PhotoExtractionError("PHOTO_EXTRACTOR_ERROR", "The photo metadata request failed in the extractor; public availability was not determined.")


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
        raise PhotoExtractionError("PHOTO_NO_DIRECT_IMAGES", "The extractor did not return supported direct image URLs.")
    return {"title": "Instagram photo post", "items": items}


def extract_photo_post(url):
    try:
        from gallery_dl import extractor
    except ImportError as exc:
        raise PhotoExtractionError("PHOTO_EXTRACTOR_ERROR", "Instagram image extractor is not installed.") from exc
    try:
        image_extractor = extractor.find(url)
        if image_extractor is None or image_extractor.category != "instagram":
            raise PhotoExtractionError("PHOTO_EXTRACTOR_ERROR", "The Instagram photo link is not supported by the image extractor.")
        # gallery-dl's Extractor.__iter__ initializes the session, cookies
        # and Instagram API client before it calls .items().
        # Calling .items() directly raises an internal AttributeError.
        return parse_photo_messages(iter(image_extractor))
    except MediaUnavailable:
        raise
    except Exception as exc:
        # Do not expose authentication cookies, post URLs or library traceback.
        raise classified_failure(exc) from exc
