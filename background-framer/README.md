# background-framer

Wraps a background-removal backend and returns a cutout that's already
cropped to the garment's real edges and framed onto a margined 3:4 canvas —
see `frame.py` for why that has to happen server-side (it needs the alpha
channel's actual pixel data, which nothing in the mobile app can read without
a native dependency), and `backends.py` for why the backend it wraps is
swappable.

Same wire contract as the self-hosted withoutBG service it sits in front of:
`POST /v1/remove-background?output=cutout`, raw image bytes or
`multipart/form-data` in, a PNG out. The mobile app's
`services/backgroundRemoval.ts` doesn't need to know this service exists
versus talking to withoutBG directly — only the URL in `.env` changes.

## Running it

Requires the withoutBG container already running (see the repo root
`README.md`'s "Background removal setup").

```bash
docker build -t wardrobe-background-framer .
docker run -d --restart unless-stopped -p 8092:8000 \
  -e BG_REMOVAL_SELF_HOSTED_URL=http://host.docker.internal:8091 \
  --name background-framer \
  wardrobe-background-framer
```

Then point the app's `EXPO_PUBLIC_BACKGROUND_REMOVAL_URL` at this service's
port (8092) instead of withoutBG's (8091) directly.

## Moving to the cloud API later

When a paid Apple Developer account and TestFlight/App Store distribution
mean an always-on Mac Mini stops being the right shape of server, switch the
backend without touching the app or `frame.py`:

```bash
docker run -d --restart unless-stopped -p 8092:8000 \
  -e BG_REMOVAL_BACKEND=cloud \
  -e BG_REMOVAL_API_KEY=sk_... \
  --name background-framer \
  wardrobe-background-framer
```

`backends.py`'s `CloudBackend` is written against withoutBG's published API
docs but has not been exercised against a real key — verify it against the
live API before relying on it.

## Config

- `BG_REMOVAL_BACKEND`: `self-hosted` (default) or `cloud`.
- `BG_REMOVAL_SELF_HOSTED_URL`: base URL of the withoutBG container. Defaults
  to `http://host.docker.internal:8091`.
- `BG_REMOVAL_API_KEY`, `BG_REMOVAL_CLOUD_URL`: required only for `cloud`.
- `FRAME_MARGIN`: fraction of the canvas reserved as margin on the
  constraining axis. Defaults to `0.07` (7% per side, 14% total).
- `FRAME_ASPECT`: target canvas width/height. Defaults to `0.75` (3:4).

## Tests

```bash
docker run --rm -v "$PWD":/app -w /app python:3.12-slim \
  sh -c "pip install --quiet -r requirements.txt pytest && python -m pytest test_frame.py -v"
```
