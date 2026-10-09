# LinkNest — Facebook & Instagram Media Downloader UI

A responsive, privacy-conscious web app with **vanilla JavaScript, HTML/CSS, and a Node.js/Express backend**. No database, accounts, cookies, request logs, analytics, or saved link history.

**Important:** The project works out of the box in **clearly labelled DEMO MODE**. This lets you test detection, previews, quality selection, downloading, error handling and responsiveness with original sample files. Real Facebook/Instagram media retrieval requires an **authorized resolver** configured through environment variables. Do not mistake sample files for content fetched from a pasted link. Official platform API access is permission-scoped and does not offer unrestricted downloads for arbitrary public posts or full-sized personal profile pictures.

## Features

- Responsive landing page, polished result cards, dark/light theme switch (no preference stored).
- Auto-detects supported Facebook/Instagram URLs as you type or paste.
- Supports Facebook videos/Reels and Instagram Reels/photo posts/profile-picture links in the interface.
- Video thumbnails and HD/SD buttons **when provided** by the resolver; direct image download for photos/profile pictures.
- Supports Instagram photo carousels returned as multiple `items` by the resolver.
- Helpful errors for invalid, private, removed, restricted, unsupported media.
- Server-side tokenized media proxy, upstream HTTPS hostname allowlist, redirect validation, short-lived HMAC tokens, content type restrictions and size cap.
- Demo previews/MP4s are original local assets and work without API keys.

## Run locally

Requires **Node.js 20.11+** (tested with Node.js 22).

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open **http://localhost:3000**. For production-style startup, run `npm start`. For unit tests, run `npm test`.

Without `RESOLVER_API_URL`, use the sample-link chips under the input to see a real demo preview and to download the bundled MP4/JPG sample files. You can also paste any syntactically supported URL in demo mode, but its actual post content **will not** be fetched.

## Enable real media fetching

Integrate with a service you operate or are expressly authorized to use. The server calls the resolver with its bearer key; the browser never sees that key. Set `.env`:

```env
RESOLVER_API_URL=https://your-authorized-resolver.example/api/resolve
RESOLVER_API_KEY=your-secret-access-token
MEDIA_HOSTS=fbcdn.net,cdninstagram.com,media.your-authorized-resolver.example
```

`RESOLVER_API_URL` must be your **trusted** service. Use HTTPS outside of local development. It must accept this request:

```http
POST /api/resolve
Authorization: Bearer your-secret-access-token
Content-Type: application/json
```

```json
{
  "url": "https://www.instagram.com/reel/EXAMPLE/",
  "platform": "instagram",
  "type": "reel"
}
```

The response should contain authorized, temporary, **direct HTTPS media URLs**, with `url` and `thumbnailUrl` pointing to content delivered by allowed CDN hostnames:

```json
{
  "title": "Your saved reel",
  "items": [
    {
      "kind": "video",
      "thumbnailUrl": "https://media.your-authorized-resolver.example/poster.jpg",
      "thumbnailMime": "image/jpeg",
      "variants": [
        { "label": "HD · 1080p", "url": "https://media.your-authorized-resolver.example/video-hd.mp4", "mime": "video/mp4", "filename": "my-reel-hd.mp4", "sizeBytes": 8204000 },
        { "label": "SD · 480p", "url": "https://media.your-authorized-resolver.example/video-sd.mp4", "mime": "video/mp4", "filename": "my-reel-sd.mp4" }
      ]
    }
  ]
}
```

For photos and full-sized profile pictures, use `kind: "image"`, an `imageUrl`, and one or more image variants with `image/jpeg`, `image/png`, `image/webp` or `image/gif` MIME type. For a carousel, return one item per photo (up to 10). If the upstream only exposes one video resolution, return only that resolution; **do not invent quality options**. Resolving a profile requires provider permission to access the image; the app will not bypass platform restrictions. Only use media you own, have permission to access, or are otherwise authorized to download.

The resolver should return **404/422** for unavailable/private/unsupported media. The app shows an appropriate message. The app will reject unknown media hosts until you explicitly add their hostname to `MEDIA_HOSTS`; subdomains of allowed hosts are permitted. The app will **not** scrape HTML pages, use login cookies, circumvent privacy controls, or bypass anti-bot mechanisms. A normal page URL is not a direct media URL.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Website |
| `GET /api/config` | Public demo status only |
| `GET /api/health` | Health check |
| `POST /api/resolve` | Classify and resolve a pasted social URL |
| `GET /api/preview/:token` | Stream signed image preview |
| `GET /api/download/:token` | Stream signed media as attachment |

Tokens expire after 10 minutes and are invalid when the process restarts. The app keeps no download database. The signed token does contain an encoded direct URL when using a provider; therefore, **treat each link as sensitive and short-lived**. The external resolver and CDN will necessarily receive network requests, so check their data processing policies and do not claim that those services avoid logging.

## Production deployment notes

1. Restrict the resolver to approved use cases and obtain appropriate API access/permission. Never request user credentials or cookies. Never expose `RESOLVER_API_KEY` in client code.
2. Serve with HTTPS behind a trusted reverse proxy; implement upstream request rate limits and abuse detection suitable for your environment without storing post/user URLs. Rate-limit by an ephemeral in-memory count or edge gateway, not persistent user tracking.
3. Keep `MEDIA_HOSTS` narrow, audit the provider response schema, and update allowed domains deliberately.
4. Signed proxy URLs allow downloads until they expire; protect your site's bandwidth and set a suitable `MAX_DOWNLOAD_MB`. The app checks length and limits streams, but does not implement monthly quotas or auth.
5. Check the platform API terms, privacy, copyright and developer policies before using this for real traffic. User authorization for arbitrary content is not automatically granted by a public URL.

## File map

```text
linknest-downloader/
├── server.js                 # Express routes and security headers
├── src/
│   ├── config.js            # Environment config
│   ├── resolver.js          # Resolver adapter, response validation, demo data
│   ├── stream.js            # Secure media streaming and redirect checks
│   └── tokens.js            # HMAC-signed 10-minute media tokens
├── public/
│   ├── index.html           # Semantic frontend
│   ├── styles.css           # Responsive dark/light styling
│   ├── app.js               # Fetch, previews, theme, interactions
│   ├── links.js             # Shared Facebook/Instagram URL classifier
│   ├── favicon.svg
│   └── demo/                # Original demo JPG/MP4 files
├── tests/                   # Node.js built-in test suite
├── .env.example
├── package.json
└── README.md
```

## Disclaimer

**For personal use only.** Only download media you own or have permission to save. Respect creators' copyright, other people's privacy, and the applicable Facebook and Instagram terms. LinkNest is not affiliated with Meta.