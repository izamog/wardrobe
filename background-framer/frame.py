"""
Cropping a background-removed cutout to the garment's real edges, and
framing it onto a margined 3:4 canvas.

The crop here comes from the alpha channel the background-removal model
actually produced -- the exact boundary of the non-transparent pixels -- not
a separately-guessed bounding box. That is what makes this immune to the
class of bug a vision-model box guess is prone to (a box that stops short of
the real hem or waistband, silently cropping it away): there is nothing left
to guess. It is also what makes the margin exact and consistent regardless
of how the source photo was framed -- the garment is pasted onto a *new*
canvas sized from its own measured pixels, not cropped further out of
whatever background pixels the original photo happened to have around it.
"""

import io

from PIL import Image


def frame_cutout(png_bytes: bytes, margin: float, target_aspect: float) -> bytes:
    """
    Returns a new PNG: the input cropped to the bounding box of its
    non-transparent pixels, centred on a transparent canvas of `target_aspect`
    (width/height) sized so the garment occupies (1 - 2*margin) of whichever
    axis constrains it -- exactly `margin` on that axis, and necessarily more
    on the other, the same asymmetry a wide item (a jacket) or a tall one (a
    coat) shows in the reference this was designed to match.

    If the cutout has no non-transparent pixels at all (background removal
    found nothing), the input is returned unchanged rather than producing an
    empty canvas.
    """
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if bbox is None:
        return png_bytes

    cropped = img.crop(bbox)
    garment_w, garment_h = cropped.size

    # Two candidate canvases: one sized so width is the constrained axis, one
    # so height is. Each is guaranteed to contain the garment on both axes
    # (dividing by (1 - 2*margin) only ever grows a dimension), so the larger
    # of the two is the smallest canvas that respects margin as a *minimum* on
    # both axes and hits it exactly on whichever axis is actually tight.
    canvas_w_a = garment_w / (1 - margin * 2)
    canvas_h_a = canvas_w_a / target_aspect
    canvas_h_b = garment_h / (1 - margin * 2)
    canvas_w_b = canvas_h_b * target_aspect

    if canvas_w_a >= canvas_w_b:
        canvas_w, canvas_h = canvas_w_a, canvas_h_a
    else:
        canvas_w, canvas_h = canvas_w_b, canvas_h_b

    canvas_w, canvas_h = round(canvas_w), round(canvas_h)
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    offset = ((canvas_w - garment_w) // 2, (canvas_h - garment_h) // 2)
    canvas.paste(cropped, offset, cropped)

    out = io.BytesIO()
    canvas.save(out, format="PNG")
    return out.getvalue()
