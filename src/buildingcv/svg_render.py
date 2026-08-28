"""Render a CubiCasa SVG to an RGB image, dropping non-structural content.

The mask side of the dataset (svg_to_mask.py) only labels walls/doors/windows;
everything else collapses to `floor`. But an SVG rasterizer renders *all* SVG
content into the input image — furniture, fixtures, dimension lines, drains,
text — so the model is shown furniture and told it's floor. That input/label
mismatch is what's currently leaking onto wall predictions: thin black
furniture lines look like walls.

This module strips the non-structural subtrees *before* rendering, so the
input image carries only walls + doors + windows + open floor, matching the
mask's semantics.

Rasterization goes through PyMuPDF (`pymupdf`), not cairosvg. PyMuPDF ships a
self-contained wheel on every platform — no system Cairo / GTK to install,
which is what made the original setup fail on Windows. `rasterize_svg` keeps
cairosvg's `svg2png(output_width=, output_height=, background_color=)`
semantics so the call sites didn't have to change.
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
from pathlib import Path

import pymupdf
from PIL import Image

# Default-prefix the SVG namespace on serialization so the round-tripped
# document is plain `<svg xmlns="...">` rather than `<ns0:svg xmlns:ns0="...">`.
# Both rasterizers accept either, but the default-namespace form is what the
# original files use and it keeps debug-saved SVGs human-readable.
ET.register_namespace("", "http://www.w3.org/2000/svg")

# Class tokens (space-separated values of the SVG `class` attribute) that
# identify subtrees the model should not see in the input image. A node is
# dropped if any of its own class tokens appears here — children are dropped
# transitively because we remove the whole subtree, not just the tagged node.
DROP_TOKENS: frozenset[str] = frozenset(
    {
        # Furniture and fixtures — the dominant source of wall-IoU damage.
        "FixedFurniture",
        "FixedFurnitureSet",
        # Plumbing/hardware bits that aren't structural:
        "Faucet",
        "Hanger",
        "Railing",
        "InnerDrain",
        "OuterDrain",
        "OuterCircle",
        # Drafting annotations: dimensions, labels, north-arrows:
        "Dimension",
        "DimensionMark",
        "Direction",
        "TextLabel",
        "Name",
        "SpaceDimensionsLabel",
        # Stray legend-style markers:
        "electricitySign",
    }
)


def is_hidden(elem: ET.Element) -> bool:
    """True if the element (or its inline style) hides it from rendering.

    CubiCasa `model.svg` files stack every floor of a building in one file
    and mark all but the ground floor `display:none` (Floor 2/3, alternate
    layouts). cairosvg skipped these when rasterizing; MuPDF (pymupdf) does
    NOT, so we strip them ourselves before rendering — otherwise the input
    image shows every floor at once while the mask, which honors the flag,
    shows only one. Shared with `svg_to_mask` so both paths agree.
    """
    if elem.get("display") == "none" or elem.get("visibility") == "hidden":
        return True
    style = (elem.get("style") or "").replace(" ", "")
    return "display:none" in style or "visibility:hidden" in style


def _prune(elem: ET.Element) -> None:
    """Recursively drop children that are non-structural (a DROP token) or
    hidden (`display:none` / `visibility:hidden`). The whole subtree goes."""
    for child in list(elem):
        tokens = (child.get("class") or "").split()
        if is_hidden(child) or any(t in DROP_TOKENS for t in tokens):
            elem.remove(child)
        else:
            _prune(child)


def filtered_svg_bytes(svg_path: str | Path) -> bytes:
    """Parse `svg_path`, drop non-structural subtrees, return serialized bytes."""
    tree = ET.parse(svg_path)
    _prune(tree.getroot())
    return ET.tostring(tree.getroot())


def rasterize_svg(
    svg_bytes: bytes,
    out_size: tuple[int, int],
    background: tuple[int, int, int] | None = None,
) -> bytes:
    """Rasterize SVG bytes to a PNG of exactly `out_size` = (W, H) pixels.

    Drop-in replacement for `cairosvg.svg2png(bytestring=, output_width=W,
    output_height=H, background_color=)`:

    - The SVG is scaled independently on each axis to fill W×H exactly, which
      mirrors cairosvg's `output_width` / `output_height`. Every caller
      pre-computes `out_size` from the SVG's own aspect ratio (see
      `data._read_svg_dims`), so in practice the two zoom factors are equal
      and nothing is distorted; the per-axis form just guarantees the output
      is pixel-for-pixel aligned with `svg_to_mask` at the same size.
    - `background=None` → transparent PNG (the viewer's floor texture shows
      the tinted floor plane through the SVG's whitespace).
    - `background=(r, g, b)` → opaque PNG flattened onto that fill, so the
      "no content" regions match the letterbox padding the model is trained
      with.
    """
    W, H = out_size
    doc = pymupdf.open(stream=svg_bytes, filetype="svg")
    try:
        page = doc[0]
        src_w = page.rect.width or W
        src_h = page.rect.height or H
        matrix = pymupdf.Matrix(W / src_w, H / src_h)
        pix = page.get_pixmap(matrix=matrix, alpha=True)
    finally:
        doc.close()

    img = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)

    # PyMuPDF rounds the scaled page box, so the pixmap can come back a pixel
    # off W×H. Crop/pad (never resize) back to the exact size the mask uses.
    if img.size != (W, H):
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.paste(img.crop((0, 0, min(img.width, W), min(img.height, H))), (0, 0))
        img = canvas

    if background is not None:
        flat = Image.new("RGB", (W, H), tuple(background))
        flat.paste(img, mask=img.split()[3])
        img = flat

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ImageNet mean as 0–255 RGB. Used as the rasterizer background so pixels
# outside any drawn polygon match the letterbox padding fill — both
# "non-content" regions look identical to the model after normalization, and
# neither collides with the black used for walls.
_IMAGENET_MEAN_RGB = (124, 116, 104)


def render_input_png(svg_path: str | Path, out_size: tuple[int, int]) -> bytes:
    """Render the structural-only SVG to PNG bytes at (W, H).

    Output is pixel-aligned with `svg_to_mask.svg_to_mask` at the same size,
    so the (image, mask) pair stays consistent.
    """
    return rasterize_svg(filtered_svg_bytes(svg_path), out_size, background=_IMAGENET_MEAN_RGB)
