"""
Tests for frame.py's cropping/framing math -- pure PIL operations, no
network, so these run without the background-removal container.
"""

import io

import pytest
from PIL import Image

from frame import frame_cutout

MARGIN = 0.07
TARGET_ASPECT = 3 / 4


def make_cutout(canvas_size, garment_box, garment_size):
    """A transparent canvas with one opaque rectangle pasted into it."""
    img = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    garment = Image.new("RGBA", garment_size, (200, 180, 140, 255))
    img.paste(garment, garment_box, garment)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def framed(png_bytes):
    return Image.open(io.BytesIO(frame_cutout(png_bytes, margin=MARGIN, target_aspect=TARGET_ASPECT)))


def bbox_of(img):
    return img.split()[-1].getbbox()


def test_crops_to_the_exact_bounding_box_of_the_non_transparent_pixels():
    # A garment placed off-centre in a much bigger transparent canvas -- the
    # crop must follow the garment, not the canvas it happened to sit in.
    cutout = make_cutout((2000, 2000), (700, 900), (600, 300))
    result = framed(cutout)
    bbox = bbox_of(result)
    # Safe: this is a pytest assertion, not runtime logic -- the rule flags
    # `assert` as a no-op under `python -O`, which never applies to pytest
    # (pytest imports test modules with assertion rewriting, not -O, and this
    # file ships nowhere -- it only ever runs under `pytest`).
    # nosemgrep
    assert (bbox[2] - bbox[0], bbox[3] - bbox[1]) == (600, 300)


def test_gives_a_wide_garment_exactly_margin_on_its_sides():
    cutout = make_cutout((1000, 1000), (200, 350), (600, 300))
    result = framed(cutout)
    w, h = result.size
    bbox = bbox_of(result)

    left = bbox[0] / w
    right = (w - bbox[2]) / w
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert left == pytest.approx(MARGIN, abs=0.005)
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert right == pytest.approx(MARGIN, abs=0.005)


def test_gives_a_wide_garment_more_than_margin_top_and_bottom():
    cutout = make_cutout((1000, 1000), (200, 350), (600, 300))
    result = framed(cutout)
    h = result.size[1]
    bbox = bbox_of(result)

    top = bbox[1] / h
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert top > MARGIN


def test_gives_a_tall_garment_exactly_margin_top_and_bottom():
    cutout = make_cutout((1000, 1200), (350, 200), (300, 800))
    result = framed(cutout)
    h = result.size[1]
    bbox = bbox_of(result)

    top = bbox[1] / h
    bottom = (h - bbox[3]) / h
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert top == pytest.approx(MARGIN, abs=0.005)
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert bottom == pytest.approx(MARGIN, abs=0.005)


def test_gives_a_tall_garment_more_than_margin_on_the_sides():
    cutout = make_cutout((1000, 1200), (350, 200), (300, 800))
    result = framed(cutout)
    w = result.size[0]
    bbox = bbox_of(result)

    left = bbox[0] / w
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert left > MARGIN


def test_output_is_target_aspect():
    cutout = make_cutout((1000, 1000), (200, 350), (600, 300))
    result = framed(cutout)
    w, h = result.size
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert w / h == pytest.approx(TARGET_ASPECT, abs=0.005)


def test_never_clips_the_garment_however_tightly_the_photo_was_framed():
    # The photo has essentially no background around the garment at all --
    # the case that broke the old vision-box-based crop.
    cutout = make_cutout((610, 310), (5, 5), (600, 300))
    result = framed(cutout)
    bbox = bbox_of(result)
    assert (bbox[2] - bbox[0], bbox[3] - bbox[1]) == (600, 300)


def test_centres_the_garment_on_the_new_canvas():
    cutout = make_cutout((2000, 2000), (50, 1500), (600, 300))
    result = framed(cutout)
    w, h = result.size
    bbox = bbox_of(result)

    left = bbox[0]
    right = w - bbox[2]
    top = bbox[1]
    bottom = h - bbox[3]
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert left == pytest.approx(right, abs=1)
    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert top == pytest.approx(bottom, abs=1)


def test_passes_through_unchanged_when_nothing_is_opaque():
    fully_transparent = Image.new("RGBA", (500, 500), (0, 0, 0, 0))
    buf = io.BytesIO()
    fully_transparent.save(buf, format="PNG")
    original = buf.getvalue()

    # Safe: pytest assertion, same as above -- never runs under -O.
    # nosemgrep
    assert frame_cutout(original, margin=MARGIN, target_aspect=TARGET_ASPECT) == original
