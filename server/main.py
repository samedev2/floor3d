"""Local inference server: loads the model once at startup and serves the viewer plus extraction endpoints."""

from __future__ import annotations

import base64
import io
import json
import math
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from buildingcv.extract_polygons import PolygonExtractor
from buildingcv.svg_render import filtered_svg_bytes, rasterize_svg

# Default location for downloaded weights — clean clone-and-go path. Local
# training writes `.pt` to `runs/<version>/<timestamp>/`; export with
# `scripts/export_safetensors.py` and point the env var here.
DEFAULT_RUN_DIR = "weights"
DEFAULT_CKPT = "best.safetensors"
DEFAULT_DEVICE = "auto"

# CubiCasa SVGs go up to a few MB. 16 MB ceiling is generous and keeps the
# server from being a free upload sink if it ever leaves localhost.
MAX_UPLOAD_BYTES = 16 * 1024 * 1024

# Repo root, derived once at import time. Used to resolve the viewer HTML
# and the sample SVGs without depending on the cwd uvicorn was launched from.
REPO_ROOT = Path(__file__).resolve().parent.parent
# The Floor3D dashboard (multi-screen app shell) is served at `/`; the
# original minimal single-purpose viewer stays reachable at `/classic`.
# If the dashboard file isn't present, `/` falls back to the classic viewer.
DASHBOARD_HTML = REPO_ROOT / "viewer" / "index.dashboard.html"
CLASSIC_VIEWER_HTML = REPO_ROOT / "viewer" / "index.html"

# Curated samples shown as "Try a sample" buttons in the viewer. Keys are
# short ids (used in the URL); values are dataset-relative paths. The set
# is small on purpose — three plans of contrasting shape are enough to
# show the viewer handles different aspect ratios and complexities.
SAMPLES: dict[str, str] = {
    "1191": "high_quality_architectural/1191",
    "4068": "high_quality_architectural/4068",
    "3676": "high_quality/3676",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_dir = Path(os.environ.get("BUILDINGCV_RUN_DIR", DEFAULT_RUN_DIR))
    ckpt = os.environ.get("BUILDINGCV_CKPT", DEFAULT_CKPT)
    device = os.environ.get("BUILDINGCV_DEVICE", DEFAULT_DEVICE)
    extractor = PolygonExtractor(run_dir=run_dir, ckpt=ckpt, device=device)
    print(f"[server] loaded {run_dir/ckpt} on {extractor.device} (epoch {extractor.epoch})")
    app.state.extractor = extractor
    yield


app = FastAPI(title="BuildingCV inference", lifespan=lifespan)

# Vite's dev server runs on a different port than this one (usually 5173).
# Permissive CORS is fine on localhost — the server isn't reachable
# off-host. Tighten this if you ever expose it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict:
    extractor: PolygonExtractor = app.state.extractor
    return {
        "ok": True,
        "device": str(extractor.device),
        "epoch": extractor.epoch,
        "image_size": list(extractor.image_size),
        "letterbox": extractor.letterbox,
    }


@app.get("/")
def index() -> FileResponse:
    """Serve the Floor3D dashboard at the root URL (classic viewer if absent)."""
    return FileResponse(DASHBOARD_HTML if DASHBOARD_HTML.exists() else CLASSIC_VIEWER_HTML)


@app.get("/classic")
def classic_viewer() -> FileResponse:
    """The original minimal viewer — sample buttons + drag-and-drop upload."""
    return FileResponse(CLASSIC_VIEWER_HTML)


# The viewer loads its sample plans from `./demos/{key}.json` so it works
# unchanged on the static Pages deploy. Mount the same files here so local
# dev hits the prebuilt JSON (no inference per click) — regenerate with
# `python scripts/build_demos.py` after retraining.
DEMOS_DIR = REPO_ROOT / "viewer" / "demos"
if DEMOS_DIR.is_dir():
    app.mount("/demos", StaticFiles(directory=DEMOS_DIR), name="demos")

# QB5D structural-modeling engine — vanilla ES modules loaded by the dashboard
# (`<script type="module" src="./qb5d/main.js">`). Served static; no build step.
QB5D_DIR = REPO_ROOT / "viewer" / "qb5d"
if QB5D_DIR.is_dir():
    app.mount("/qb5d", StaticFiles(directory=QB5D_DIR), name="qb5d")


def _attach_input_image(svg_path: Path, result: dict) -> dict:
    """Render a transparent-background PNG of the structural SVG at content
    size and inline it as base64 on `result`. The viewer uses this as the
    floor texture under the rising 3D geometry — same content the model saw,
    so what the user sees on the floor is exactly what the polygons came from.
    """
    _, _, inner_w, inner_h = result["content_rect"]
    # No background → transparent PNG. The viewer renders this over a tinted
    # floor plane, so transparency lets the floor color show through where
    # the SVG has no ink.
    png = rasterize_svg(filtered_svg_bytes(svg_path), (inner_w, inner_h))
    result["input_image_b64"] = base64.b64encode(png).decode("ascii")
    return result


@app.get("/sample/{key}")
def sample(key: str) -> dict:
    """Run extraction on a server-known dataset SVG.

    Used by the viewer's "Try a sample" buttons so we don't need to send
    multi-megabyte SVGs over the wire just to render plans we already
    have on disk.
    """
    if key not in SAMPLES:
        raise HTTPException(status_code=404, detail=f"unknown sample: {key}")
    data_dir = Path(os.environ.get("BUILDINGCV_DATA_DIR", REPO_ROOT / "data" / "cubicasa5k"))
    svg_path = data_dir / SAMPLES[key] / "model.svg"
    if not svg_path.exists():
        raise HTTPException(status_code=404, detail=f"sample SVG not found: {svg_path}")
    extractor: PolygonExtractor = app.state.extractor
    return _attach_input_image(svg_path, extractor.extract(svg_path))


@app.post("/extract")
async def extract(svg: UploadFile = File(...)) -> dict:
    """Run the model on the uploaded SVG and return the polygon JSON.

    The extractor reads from a path (parses the SVG twice — once for native
    dims, once for the rasterizer). Easiest is to write the upload to a
    tempfile and let it use the same code path as the CLI; the file is small
    (< MB typical) and the temp dir is RAM-backed on macOS.
    """
    raw = await svg.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes")

    extractor: PolygonExtractor = app.state.extractor
    with tempfile.NamedTemporaryFile(suffix=".svg", delete=False) as tmp:
        tmp.write(raw)
        tmp.flush()
        tmp_path = Path(tmp.name)
    try:
        try:
            result = extractor.extract(tmp_path)
        except Exception as e:
            # Bad SVGs (rasterizer parse failures, NaN transforms in
            # CubiCasa) land here. Return 422 so the viewer can show "this
            # file couldn't be processed" rather than "server crashed".
            raise HTTPException(status_code=422, detail=f"failed to extract: {e}") from e
        return _attach_input_image(tmp_path, result)
    finally:
        tmp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Gemini vision detection — turn a RASTER floor plan (photo / PNG / JPG) into
# the same polygon JSON the CubiCasa model emits. The trained model only reads
# CubiCasa-format SVG; this path handles everything else (and can read the
# drawing's dimension labels to recover a real metric scale).
#
# The API key is NOT committed: it comes from $GEMINI_API_KEY or the
# git-ignored file server/gemini_key.txt.
# ---------------------------------------------------------------------------
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

_GEMINI_SCHEMA = {
    "type": "object",
    "properties": {
        "image_width": {"type": "integer"},
        "image_height": {"type": "integer"},
        "wall_thickness_px": {"type": "number"},
        "walls": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "x1": {"type": "number"}, "y1": {"type": "number"},
                    "x2": {"type": "number"}, "y2": {"type": "number"},
                },
                "required": ["x1", "y1", "x2", "y2"],
            },
        },
        "doors": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"}, "y": {"type": "number"},
                    "width_px": {"type": "number"},
                },
                "required": ["x", "y"],
            },
        },
        "windows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"}, "y": {"type": "number"},
                    "width_px": {"type": "number"},
                },
                "required": ["x", "y"],
            },
        },
        "scale": {
            "type": "object",
            "properties": {
                "px_per_meter": {"type": "number"},
                "note": {"type": "string"},
            },
        },
    },
    "required": ["image_width", "image_height", "walls"],
}

_GEMINI_PROMPT = (
    "You are analysing an architectural floor plan image. Return ONLY JSON "
    "matching the schema.\n"
    "- walls: the CENTRELINE of every wall as a straight segment "
    "(x1,y1)-(x2,y2) in image pixel coordinates, origin at the top-left. "
    "Split walls at junctions. Include interior partitions and exterior "
    "walls. Ignore furniture, text, dimension lines/arrows, hatching and "
    "plumbing fixtures.\n"
    "- wall_thickness_px: typical wall thickness in pixels.\n"
    "- doors / windows: the centre point (x,y) of the opening on its wall "
    "and the opening width in pixels.\n"
    "- scale.px_per_meter: if the drawing shows dimension labels (e.g. "
    "'3.00', '2,55 m', '6x8'), use them to compute how many pixels equal "
    "one metre. Omit scale entirely if no reliable dimension is visible.\n"
    "All coordinates must lie inside the image bounds."
)


def _gemini_key() -> str | None:
    k = os.environ.get("GEMINI_API_KEY")
    if k and k.strip():
        return k.strip()
    kf = REPO_ROOT / "server" / "gemini_key.txt"
    if kf.exists():
        t = kf.read_text(encoding="utf-8").strip()
        return t or None
    return None


def _wall_rect(x1: float, y1: float, x2: float, y2: float, ht: float) -> list[list[float]]:
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1.0
    px, py = -dy / length * ht, dx / length * ht
    return [
        [x1 + px, y1 + py], [x2 + px, y2 + py],
        [x2 - px, y2 - py], [x1 - px, y1 - py],
    ]


def _ai_to_result(parsed: dict, w: int, h: int, raw: bytes, mime: str) -> dict:
    thk = parsed.get("wall_thickness_px")
    try:
        thk = float(thk)
    except (TypeError, ValueError):
        thk = 0.0
    if thk <= 0:
        thk = max(4.0, min(w, h) * 0.012)
    half = max(2.0, thk / 2.0)

    walls: list[dict] = []
    for wl in parsed.get("walls") or []:
        try:
            x1, y1, x2, y2 = float(wl["x1"]), float(wl["y1"]), float(wl["x2"]), float(wl["y2"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.hypot(x2 - x1, y2 - y1) < 3:
            continue
        walls.append({"outer": _wall_rect(x1, y1, x2, y2, half), "holes": []})

    def _openings(items) -> list[dict]:
        out: list[dict] = []
        for o in items or []:
            try:
                x, y = float(o["x"]), float(o["y"])
            except (KeyError, TypeError, ValueError):
                continue
            try:
                wpx = float(o.get("width_px"))
            except (TypeError, ValueError):
                wpx = thk * 5.0
            if wpx <= 0:
                wpx = thk * 5.0
            out.append({"outer": _wall_rect(x - wpx / 2, y, x + wpx / 2, y, half), "holes": []})
        return out

    result = {
        "canvas_size": [w, h],
        "content_rect": [0, 0, w, h],
        "polygons": {
            "wall": walls,
            "door": _openings(parsed.get("doors")),
            "window": _openings(parsed.get("windows")),
        },
        "input_image_b64": base64.b64encode(raw).decode("ascii"),
    }
    scale = parsed.get("scale") or {}
    try:
        ppm = float(scale.get("px_per_meter"))
    except (TypeError, ValueError):
        ppm = 0.0
    if ppm > 0:
        result["meters_per_pixel"] = 1.0 / ppm
        result["scale_note"] = str(scale.get("note") or "")
    return result


@app.post("/detect-ai")
async def detect_ai(image: UploadFile = File(...)) -> dict:
    """Detect walls/openings/scale in a raster floor plan via Gemini vision."""
    key = _gemini_key()
    if not key:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY não configurada no servidor")

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes")

    from PIL import Image as _PILImage

    try:
        im = _PILImage.open(io.BytesIO(raw))
        w, h = im.size
        mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(
            im.format or "", "image/png"
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"imagem inválida: {e}") from e

    body = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(raw).decode("ascii")}},
            {"text": _GEMINI_PROMPT + f"\nThe image is {w}x{h} pixels."},
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _GEMINI_SCHEMA,
            "temperature": 0.1,
        },
    }
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={key}"
    )
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=body)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=504, detail=f"Gemini inacessível: {e}") from e
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Gemini {resp.status_code}: {resp.text[:300]}")

    try:
        payload = resp.json()
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"resposta do Gemini inválida: {e}") from e

    result = _ai_to_result(parsed, w, h, raw, mime)
    if not result["polygons"]["wall"]:
        raise HTTPException(status_code=422, detail="Gemini não encontrou paredes nesta imagem")
    return result
