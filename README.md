# LinkNest — Facebook & Instagram Media Downloader UI

A responsive, privacy-conscious web app with **vanilla JavaScript, HTML/CSS, Cloudflare Pages Functions and an optional Node.js/Express local backend**. No database, accounts, cookies, request logs, analytics, or saved link history.

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

## Deploy on Cloudflare Pages (GitHub)

The repository is **prepared for Cloudflare Pages**, with a static `public/` site and serverless API endpoints in the root `functions/` directory. This does **not** require a separate Express deployment. The Express backend remains for optional local use.

1. Go to **Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git**.
2. Connect your GitHub account and choose **`acchtt/linknest`**, branch **`main`**.
3. For the build settings use:

   | Cloudflare setting | Value |
   | --- | --- |
   | Framework preset | `None` |
   | Build command | Leave blank (no build needed) |
   | Build output directory | `public` |
   | Root directory | `/` (repository root) |

4. Deploy. Cloudflare automatically picks up the root `functions/` directory for `/api/config`, `/api/resolve`, `/api/health`, `/api/preview/:token`, and `/api/download/:token`. Static sample JPG/MP4 files are served directly from `public/demo/`. Routing is restricted to `/api/*` in `public/_routes.json` to avoid charging Function invocations for static assets.
5. Open your assigned `https://<project>.pages.dev` URL. Initially, the site is in clearly marked **DEMO MODE** with working sample preview and download links.

**Real media integration (optional):** In **Workers & Pages → your Pages project → Settings → Variables and Secrets**, add these in the desired environment, then redeploy:

| Binding name | Kind | Value |
| --- | --- | --- |
| `RESOLVER_API_URL` | Variable | HTTPS endpoint of a resolver you operate/are authorized to use |
| `RESOLVER_API_KEY` | **Encrypted secret** | Resolver authorization key, if required |
| `DOWNLOAD_SIGNING_SECRET` | **Encrypted secret** | Random string **32+ characters**; keep unchanged across deployments |
| `MEDIA_HOSTS` | Variable | Comma-separated HTTPS CDN hostnames for authorized returned media |
| `MAX_DOWNLOAD_MB` | Variable | Download size cap, default `100` in Pages Functions (up to `350`) |

Generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Do **not** commit it to GitHub, put it in browser JavaScript, or place it in your Cloudflare `public/` directory. A missing/invalid resolver endpoint or a signing secret shorter than 32 characters causes real-mode requests to return a configuration error; no silent demo fallback when a resolver is configured.

**Cloudflare limits:** Large file streaming and bandwidth are subject to Cloudflare's active service terms and plan limits. For heavy traffic, add Cloudflare edge rate-limiting/WAF protection on `/api/resolve` and `/api/download/*`; limit access without storing URL histories. Uploads and public/private content access are not supported. A static Cloudflare Pages deployment without Functions would only show UI and would not process real URLs.

**Local Pages Functions development:** Install dependencies and run:

```bash
npm install
npm run dev:pages
```

Visit the URL printed by Wrangler (usually `http://localhost:8788`). For local real-resolver testing, put `RESOLVER_API_URL`, `RESOLVER_API_KEY`, `DOWNLOAD_SIGNING_SECRET`, and `MEDIA_HOSTS` in a git-ignored `.dev.vars` file. Cloudflare reads it via `context.env`. To run just the legacy Express backend, use `npm run dev` (default `http://localhost:3000`) with `.env` instead. Both modes remain supported, but signed tokens are not interchangeable between Node and Cloudflare.

**Tests:** `npm test` checks the URL classifier, Node tokens, and Cloudflare Pages Function contracts (including demo mode, HMAC expiry, allowlist, proxy headers, and security errors). Tests do not substitute for an actual Cloudflare staging deployment or authorized live-provider integration.


## Deploy the public-only resolver on Railway

The **Railway resolver** is separate from the Cloudflare Pages website. It uses `yt-dlp` to inspect **publicly accessible** Facebook videos/Reels and Instagram Reels, and `gallery-dl` to inspect public Instagram photo posts/carousels, returning direct CDN URLs **only when the platform makes them available without login**. The resolver does not ask for social credentials, load cookie jars, bypass private content, download/transcode files, or store link histories. Real platform restrictions and rate limits mean successful extraction cannot be guaranteed. Instagram **full-size profile pictures remain unsupported** without an appropriately authorized account API. Only use this for content you have rights to download and when allowed by applicable platform terms.

1. In Railway, create a project from **GitHub repository `acchtt/linknest`**, branch `main`. Set the **root directory to the repository root `/`**. Railway will detect the root `Dockerfile`; `railway.json` sets the health check to `GET /health`. This service hosts the Python resolver, **not** the Cloudflare frontend.
2. In your Railway service's **Variables**, set `RESOLVER_API_KEY` to a **random 32+-character secret**. For example, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` locally to create one. Do **not** commit the value to the repository. Optional: set `MEDIA_HOSTS=fbcdn.net,cdninstagram.com` (default). Railway supplies `PORT` automatically.
3. In **Railway → Service → Settings → Networking**, generate a **public HTTPS domain**. Verify `https://YOUR-RAILWAY-DOMAIN/health` returns JSON with `status: ok`. The `/api/resolve` endpoint requires your bearer key; `/health` does not.
4. In **Cloudflare Pages → linknest-3bg → Settings → Variables and Secrets** (production environment), configure:

   | Variable | Value | Confidential? |
   | --- | --- | --- |
   | `RESOLVER_API_URL` | `https://YOUR-RAILWAY-DOMAIN/api/resolve` | No |
   | `RESOLVER_API_KEY` | **Exactly the same random key** as Railway | **Yes, encrypted** |
   | `DOWNLOAD_SIGNING_SECRET` | A **different** random 32+-character secret | **Yes, encrypted** |
   | `MEDIA_HOSTS` | `fbcdn.net,cdninstagram.com` | No |
   | `MAX_DOWNLOAD_MB` | e.g. `100` | No |

5. **Redeploy Cloudflare Pages** after saving environment variables. Verify `https://linknest-3bg.pages.dev/api/health` shows `{ "status": "ok", "demo": false }` and `GET /api/config` shows `{ "demo": false }`. The site will now attempt permitted public extraction instead of serving sample content.
6. Test with **one public post that you own or have permission to download**. If the upstream requests login or blocks CDN access, the site should show a clear error; it must **not** pretend to have downloaded the original. A Reel's separate HD/SD options appear only when progressive MP4s with audio are actually available. Instagram post carousels are capped at 10 items.

**Security and operations:** Never use social platform account cookies or private content. Rate-limit `/api/resolve` at Cloudflare (e.g. WAF/Rate Limiting); requests invoke a short-lived subprocess with a hard timeout and a concurrency limit of two. The public Railway domain is not a general-purpose open proxy: its resolve endpoint requires a server-to-server bearer secret. Keep keys in the platform secret stores, not in source, client JavaScript, or build logs. Rotating either secret invalidates in-flight download links. Cloudflare and Railway may have their own service metadata/access logs even though application URL histories are not stored.

To test the resolver locally without installing `yt-dlp` (using mocked metadata):

```bash
python -m unittest discover -s tests -p 'test_resolver.py' -v
```

For actual extraction, install `pip install -r resolver/requirements.txt`, run `RESOLVER_API_KEY=<your_random_key> python -m resolver.app`, and make an authenticated POST to `http://localhost:8080/api/resolve`. The service reads `PORT` when provided. An authenticated API response is metadata only, not the media file itself.

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

Tokens expire after 10 minutes. Cloudflare-signed links remain valid across requests and deploys while `DOWNLOAD_SIGNING_SECRET` is unchanged; legacy local Express tokens may become invalid after a restart if its signing secret is not configured. The app keeps no download database. The signed token does contain an encoded direct URL when using a provider; therefore, **treat each link as sensitive and short-lived**. The external resolver and CDN will necessarily receive network requests, so check their data processing policies and do not claim that those services avoid logging.

## Production deployment notes

1. Restrict the resolver to approved use cases and obtain appropriate API access/permission. Never request user credentials or cookies. Never expose `RESOLVER_API_KEY` in client code.
2. Serve with HTTPS behind a trusted reverse proxy; implement upstream request rate limits and abuse detection suitable for your environment without storing post/user URLs. Rate-limit by an ephemeral in-memory count or edge gateway, not persistent user tracking.
3. Keep `MEDIA_HOSTS` narrow, audit the provider response schema, and update allowed domains deliberately.
4. Signed proxy URLs allow downloads until they expire; protect your site's bandwidth and set a suitable `MAX_DOWNLOAD_MB`. The app checks length and limits streams, but does not implement monthly quotas or auth.
5. Check the platform API terms, privacy, copyright and developer policies before using this for real traffic. User authorization for arbitrary content is not automatically granted by a public URL.

## File map

```text
linknest-downloader/
├── railway.json              # Railway Docker deployment and health check
├── Dockerfile                # Python resolver Docker container
├── resolver/                 # Authenticated, public-only media metadata resolver
├── functions/                # Cloudflare Pages API routes and Web Crypto helpers
├── server.js                 # Optional Express routes and security headers
├── src/
│   ├── config.js            # Environment config
│   ├── resolver.js          # Resolver adapter, response validation, demo data
│   ├── stream.js            # Secure media streaming and redirect checks
│   └── tokens.js            # HMAC-signed 10-minute media tokens
├── public/
│   ├── _routes.json         # Only route /api/* through Pages Functions
│   ├── _headers             # CSP/security headers for static assets
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
## Instagram photo posts (image extractor)

Image-only Instagram posts were previously passed through `yt-dlp`, which is a video tool and rejects image-only posts. The Python Railway resolver now routes Instagram `/p/.../` URLs through **gallery-dl** for images and carousels. This processes public metadata only: no account cookies, authentication, file downloads or storage. It selects direct HTTPS photo URLs only on approved CDN hosts, up to 10 items. A photo extractor failure is reported as `PHOTO_EXTRACTION_UNAVAILABLE`, **not** a claim that the Instagram post is private. Instagram may deny unauthenticated API access to otherwise public posts, so successful extraction cannot be guaranteed on every link. Mixed carousel videos are not returned by this photo-only path. The Cloudflare request timeout is 35 seconds and the frontend wait is 45 seconds to accommodate photo extraction.

### Public Instagram photo extraction diagnostics

The image extractor now distinguishes `PHOTO_LOGIN_GATE` (the *server* is redirected to a login page), `PHOTO_RATE_LIMITED`, `PHOTO_CHALLENGE`, `PHOTO_ACCESS_BLOCKED`, `PHOTO_NO_DIRECT_IMAGES`, and `PHOTO_EXTRACTOR_ERROR`. A public post viewed in an ordinary browser can still be login-gated from a cloud server. No account cookies or bypasses are used or stored. These codes do not imply the post itself is private. The status describes the extractor request, not content visibility.
