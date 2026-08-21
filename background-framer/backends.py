"""
The upstream background-removal call, pluggable behind one interface.

This exists so app.py and frame.py never have to know or care whether the
actual segmentation is happening on this machine or in the cloud -- they
just get a cutout PNG back. That matters because this whole service is
expected to outlive its first backend: it starts out pointed at the
self-hosted, free, open-weights withoutBG container running on this Mac
Mini, but the plan is to move onto a paid Apple Developer account and TestFlight
at some point, and a Mac Mini staying always-on as a personal server stops
being the right shape of thing once the app has users other than its own
developer. At that point this switches to withoutBG's hosted Pro Model API
(or another provider) purely by changing environment variables -- see
backend_from_env() -- with no change to frame.py's cropping/framing logic
and no change to the mobile app at all, since the app only ever talks to
*this* service's stable /v1/remove-background contract.
"""

import os

import httpx


class BackgroundRemovalError(Exception):
    """The upstream backend failed to remove the background."""


class SelfHostedBackend:
    """
    Calls a self-hosted withoutBG open-weights container
    (github.com/withoutbg/withoutbg-inference) reachable at `base_url`.

    Free, no API key, no per-image cost, but only as available as this
    machine is -- fine for a personal build, not for distributing the app.
    """

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def remove_background(self, image_bytes: bytes, content_type: str) -> bytes:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/v1/remove-background",
                params={"output": "cutout"},
                content=image_bytes,
                headers={"Content-Type": content_type},
            )
        if response.status_code != 200:
            raise BackgroundRemovalError(
                f"self-hosted backend responded {response.status_code}: {response.text}"
            )
        return response.content


class CloudBackend:
    """
    Calls withoutBG's hosted Pro Model API.

    NOT YET EXERCISED END-TO-END -- this is written against withoutBG's
    published API docs (POST {base_url}/v1.0/image-without-background,
    Authorization: Bearer <api_key>, same request/response shape as the
    self-hosted service), but nobody has run a real request through this
    class yet. Verify the exact request/response shape against a live key
    before relying on it: check the docs at withoutbg.com, or hit the
    endpoint directly with curl, the same way SelfHostedBackend's contract
    was verified against the running container before this service was
    built around it.
    """

    def __init__(self, api_key: str, base_url: str = "https://api.withoutbg.com"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    async def remove_background(self, image_bytes: bytes, content_type: str) -> bytes:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/v1.0/image-without-background",
                content=image_bytes,
                headers={
                    "Content-Type": content_type,
                    "Authorization": f"Bearer {self.api_key}",
                },
            )
        if response.status_code != 200:
            raise BackgroundRemovalError(
                f"cloud backend responded {response.status_code}: {response.text}"
            )
        return response.content


def backend_from_env():
    """
    Selects which background-removal backend to call, from environment
    variables set on this service's container -- so moving from the
    self-hosted model to the cloud API is a deploy-time config change here,
    not a code change, and not a change to the mobile app at all.

    BG_REMOVAL_BACKEND: "self-hosted" (default) or "cloud".
    BG_REMOVAL_SELF_HOSTED_URL: base URL of the withoutBG container.
    BG_REMOVAL_API_KEY / BG_REMOVAL_CLOUD_URL: required only for "cloud".
    """
    kind = os.environ.get("BG_REMOVAL_BACKEND", "self-hosted")
    if kind == "cloud":
        api_key = os.environ["BG_REMOVAL_API_KEY"]
        base_url = os.environ.get("BG_REMOVAL_CLOUD_URL", "https://api.withoutbg.com")
        return CloudBackend(api_key, base_url)
    base_url = os.environ.get("BG_REMOVAL_SELF_HOSTED_URL", "http://host.docker.internal:8091")
    return SelfHostedBackend(base_url)
