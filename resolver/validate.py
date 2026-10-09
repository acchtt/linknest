"""Strict input URL allowlist; source URLs are never used as arbitrary fetch targets."""
from __future__ import annotations
import re
from urllib.parse import urlsplit, urlunsplit

INSTAGRAM = {"www.instagram.com", "instagram.com", "m.instagram.com", "instagr.am"}
FACEBOOK = {"www.facebook.com", "facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"}

class InvalidLink(ValueError):
    pass


def classify(raw: str) -> tuple[str, str, str]:
    if not isinstance(raw, str) or len(raw) > 1500 or not raw.startswith("https://"):
        raise InvalidLink("A complete HTTPS Instagram/Facebook URL is required.")
    try:
        p = urlsplit(raw)
        if p.username or p.password or p.port is not None or p.fragment:
            raise InvalidLink("Invalid link.")
    except ValueError as ex:
        raise InvalidLink("Invalid link.") from ex
    hostname = (p.hostname or "").lower()
    path = p.path
    if hostname in INSTAGRAM:
        platform = "instagram"
        if re.fullmatch(r"/reels?/[A-Za-z0-9_-]+/?", path, re.I):
            kind = "reel"
        elif re.fullmatch(r"/p/[A-Za-z0-9_-]+/?", path, re.I):
            kind = "photo"
        elif re.fullmatch(r"/[A-Za-z0-9._]{1,30}/?", path) and path.strip("/").lower() not in {"p", "reel", "reels", "accounts", "explore", "stories", "direct", "about", "api", "web"}:
            kind = "profile"
        else:
            raise InvalidLink("Unsupported Instagram link.")
    elif hostname in FACEBOOK:
        platform = "facebook"
        if hostname == "fb.watch" and re.fullmatch(r"/[A-Za-z0-9_-]+/?", path):
            kind = "video"
        elif re.fullmatch(r"/(?:reel|share/r)/[A-Za-z0-9_-]+/?", path, re.I):
            kind = "reel"
        elif (re.fullmatch(r"/(?:watch|video.php)/?", path, re.I) and "v=" in p.query) or re.search(r"/videos/[A-Za-z0-9_-]+", path, re.I) or re.fullmatch(r"/share/v/[A-Za-z0-9_-]+/?", path, re.I):
            kind = "video"
        else:
            raise InvalidLink("Unsupported Facebook link.")
    else:
        raise InvalidLink("Only Facebook and Instagram links are supported.")
    return platform, kind, urlunsplit(("https", hostname, path, p.query, ""))