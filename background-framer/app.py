"""
Same wire contract as the self-hosted withoutBG service it wraps
(POST /v1/remove-background?output=cutout, raw PNG in, raw PNG out) so the
mobile app's services/backgroundRemoval.ts never has to change no matter
what runs behind this -- see backends.py for why that matters.
"""

import os

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.responses import Response

from backends import BackgroundRemovalError, backend_from_env
from frame import frame_cutout

app = FastAPI(title="wardrobe background-framer")
backend = backend_from_env()

MARGIN = float(os.environ.get("FRAME_MARGIN", "0.07"))
TARGET_ASPECT = float(os.environ.get("FRAME_ASPECT", str(3 / 4)))


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    return {"status": "ready"}


@app.post("/v1/remove-background")
async def remove_background(image: UploadFile = File(...), output: str = Query("cutout")):
    image_bytes = await image.read()
    content_type = image.content_type or "image/jpeg"

    try:
        cutout = await backend.remove_background(image_bytes, content_type)
    except BackgroundRemovalError as e:
        return Response(content=str(e), status_code=502)

    if output == "matte":
        # Framing only makes sense for the transparent cutout -- a raw matte
        # request passes through untouched, same as the self-hosted service.
        return Response(content=cutout, media_type="image/png")

    framed = frame_cutout(cutout, margin=MARGIN, target_aspect=TARGET_ASPECT)
    return Response(content=framed, media_type="image/png")
