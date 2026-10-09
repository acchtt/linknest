"""Small, conservative metadata adapter for publicly accessible media.

Only directly downloadable HTTPS media on approved CDN hosts are returned.
No auth headers/cookies, manifests, segmented streams, or transcodes are supplied.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit

DEFAULT_HOSTS = "fbcdn.net,cdninstagram.com"
IMAGE_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


class MediaUnavailable(Exception):
    pass


def allowed_url(raw: str, allowed_hosts: str | None = None) -> bool:
    if not isinstance(raw, str) or not raw or len(raw) > 4096:
        return False
    try:
        url = urlsplit(raw)
        if (url.scheme != "https" or not url.hostname or url.username or url.password or
                url.port is not None or url.fragment):
            return False
        hostname = url.hostname.lower()
        configured = allowed_hosts if allowed_hosts is not None else os.getenv("MEDIA_HOSTS", DEFAULT_HOSTS)
        hosts = [h.strip().lower() for h in configured.split(",") if h.strip()]
        return any(hostname == h or hostname.endswith("." + h) for h in hosts)
    except ValueError:
        return False


def picture_mime(url: str, fallback: str = "image/jpeg") -> str:
    suffix = urlsplit(url).path.rsplit(".", 1)[-1].lower()
    return IMAGE_EXT.get(suffix, fallback)


def picture_candidates(info: dict, allowed_hosts: str | None = None):
    """Only genuine image formats, never assume a thumbnail is full size."""
    formats = info.get("formats") or []
    candidates = list(formats)
    if info.get("url") and info.get("ext") in IMAGE_EXT:
        candidates.append(info)
    result = []
    for f in candidates:
        if not isinstance(f, dict):
            continue
        ext = str(f.get("ext", "")).lower()
        url = f.get("url")
        if ext in IMAGE_EXT and allowed_url(url, allowed_hosts) and f.get("protocol") in (None, "http", "https"):
            result.append((int(f.get("width") or 0) * int(f.get("height") or 0), url, IMAGE_EXT[ext]))
    return sorted(result, reverse=True)


def video_candidates(info: dict, allowed_hosts: str | None = None):
    formats = list(info.get("formats") or [])
    if info.get("url") and info.get("ext") == "mp4":
        formats.append(info)
    seen = set()
    result = []
    for f in formats:
        if not isinstance(f, dict):
            continue
        url = f.get("url")
        # Only progressive MP4 files; segmented DASH/HLS cannot be sent as an MP4.
        if (str(f.get("ext", "")).lower() != "mp4" or
                f.get("protocol") not in (None, "https", "http") or
                f.get("vcodec") == "none" or f.get("acodec") == "none" or
                f.get("has_drm") or not allowed_url(url, allowed_hosts) or url in seen):
            continue
        seen.add(url)
        height = int(f.get("height") or 0)
        result.append((height, int(f.get("filesize") or f.get("filesize_approx") or 0), url))
    return sorted(result, reverse=True)


def single_item(info: dict, allowed_hosts: str | None = None) -> dict:
    video = video_candidates(info, allowed_hosts)
    if video:
        selected = []
        seen_bands = set()
        for height, size, url in video:
            band = "HD" if height >= 720 else "SD" if height else "MP4"
            if band in seen_bands:
                continue
            seen_bands.add(band)
            label = f"{band} · {height}p" if height else "MP4 · available quality"
            selected.append({"label": label, "url": url, "mime": "video/mp4",
                             **({"sizeBytes": size} if size else {})})
            if len(selected) == 2:
                break
        thumbnails = [info.get("thumbnail")]
        thumbnails.extend(t.get("url") for t in info.get("thumbnails") or [] if isinstance(t, dict))
        image_url = next((u for u in thumbnails if allowed_url(u, allowed_hosts)), None)
        # A preview is mandatory in LinkNest's existing Pages contract.
        if not image_url:
            raise MediaUnavailable("No public preview for this video.")
        return {"kind": "video", "thumbnailUrl": image_url,
                "thumbnailMime": picture_mime(image_url), "variants": selected}

    images = picture_candidates(info, allowed_hosts)
    if images:
        _, url, mime = images[0]
        return {"kind": "image", "imageUrl": url, "thumbnailUrl": url,
                "thumbnailMime": mime, "variants": [{"label": "Best available image", "url": url, "mime": mime}]}
    raise MediaUnavailable("No supported public MP4 or image file was found.")


def normalize(info: dict, platform: str, kind: str, allowed_hosts: str | None = None) -> dict:
    if not isinstance(info, dict):
        raise MediaUnavailable("No public media was returned.")
    root_extractor = str(info.get("extractor_key") or info.get("extractor") or "")
    if root_extractor:
        expected = "instagram" if platform == "instagram" else "facebook"
        if expected not in root_extractor.lower():
            raise MediaUnavailable("The resolved content came from an unsupported source.")
    if kind == "profile":
        # yt-dlp has no reliable authorized full-size public profile-photo endpoint.
        raise MediaUnavailable("Full-size Instagram profile photos require account-authorized API access.")

    entries = info.get("entries") if info.get("_type") in ("playlist", "multi_video") else None
    sources = entries if entries is not None else [info]
    if not sources or len(sources) > 10:
        raise MediaUnavailable("No media or too many carousel items were returned.")
    items = []
    for candidate in sources:
        if candidate is None:
            continue
        try:
            items.append(single_item(candidate, allowed_hosts))
        except MediaUnavailable:
            continue
    if not items:
        raise MediaUnavailable("The post is private, unavailable, or has no supported direct media files.")
    title = str(info.get("title") or info.get("description") or "Public media")[:120]
    return {"title": title, "items": items}