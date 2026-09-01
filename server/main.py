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


@app.middleware("http")
async def _no_stale_assets(request, call_next):
    """The viewer is plain ES modules served static — without this, browsers
    cache them by URL and users run stale code after an update. Force a
    revalidation on every HTML/JS/JSON asset."""
    resp = await call_next(request)
    p = request.url.path
    if p == "/" or p.startswith(("/qb5d/", "/demos/", "/classic")):
        resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


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

_XY = {"type": "number"}
_POINT_LIST = {"type": "array", "items": {"type": "array", "items": _XY}}

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
                    "x1": _XY, "y1": _XY, "x2": _XY, "y2": _XY,
                    "thickness_px": {"type": "number"},
                },
                "required": ["x1", "y1", "x2", "y2"],
            },
        },
        "doors": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"x": _XY, "y": _XY, "width_px": {"type": "number"}},
                "required": ["x", "y"],
            },
        },
        "windows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"x": _XY, "y": _XY, "width_px": {"type": "number"}},
                "required": ["x", "y"],
            },
        },
        "rooms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "polygon": _POINT_LIST,
                },
                "required": ["polygon"],
            },
        },
        "fixtures": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "toilet", "sink", "kitchen_sink", "shower", "bathtub",
                            "stove", "fridge", "bed", "wardrobe", "table", "sofa",
                            "stairs", "water_tank", "column", "other",
                        ],
                    },
                    "x": _XY, "y": _XY,
                    "width_px": {"type": "number"},
                    "depth_px": {"type": "number"},
                    "rotation_deg": {"type": "number"},
                },
                "required": ["type", "x", "y"],
            },
        },
        "scale": {
            "type": "object",
            "properties": {
                "px_per_meter": {"type": "number"},
                "building_width_m": {"type": "number"},
                "building_depth_m": {"type": "number"},
                "note": {"type": "string"},
            },
        },
    },
    "required": ["image_width", "image_height", "walls"],
}

_GEMINI_PROMPT = (
    "You are analysing an architectural floor plan image. Return ONLY JSON "
    "matching the schema. Be thorough — this drives a 3D model.\n"
    "- walls: the CENTRELINE of every wall as a straight segment "
    "(x1,y1)-(x2,y2) in image pixel coordinates, origin top-left. Split "
    "walls at junctions. Include exterior walls AND every interior "
    "partition. Give per-wall thickness_px when it varies.\n"
    "- wall_thickness_px: the typical wall thickness in pixels.\n"
    "- doors / windows: centre point (x,y) on the wall and opening width in "
    "pixels. Distinguish doors (with a swing arc) from windows.\n"
    "- rooms: one polygon (ordered pixel points) per enclosed space, with "
    "its label if written on the plan (Quarto, Sala, Cozinha, WC, "
    "Banheiro, Suíte, Área, Garagem, Varanda...). Polygons should follow "
    "the inner face of the walls.\n"
    "- fixtures: every fixed item drawn as a symbol — toilet, sink, "
    "kitchen_sink, shower, bathtub, stove, fridge, bed, wardrobe, table, "
    "sofa, stairs, water_tank, column. Give centre (x,y), footprint "
    "width_px/depth_px and rotation_deg (0 = width runs left-right).\n"
    "- scale: if the drawing has dimension labels (e.g. '3.00', '2,55 m', "
    "'6x8', a title like 'Casa 6x8'), set scale.px_per_meter, and also "
    "scale.building_width_m / building_depth_m for the overall envelope. "
    "Omit scale only if truly nothing is legible.\n"
    "All coordinates must lie inside the image bounds. Ignore furniture "
    "hatching, text blocks and dimension arrows themselves.\n\n"
    "Return ONLY a JSON object with exactly this shape:\n"
    '{"walls":[{"x1":0,"y1":0,"x2":0,"y2":0,"thickness_px":0}],'
    '"doors":[{"x":0,"y":0,"width_px":0}],'
    '"windows":[{"x":0,"y":0,"width_px":0}],'
    '"rooms":[{"name":"","polygon":[[0,0],[0,0]]}],'
    '"fixtures":[{"type":"toilet","x":0,"y":0,"width_px":0,"depth_px":0,"rotation_deg":0}],'
    '"scale":{"px_per_meter":0,"building_width_m":0,"building_depth_m":0,"note":""}}'
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
    def cx(v: float) -> float:
        return max(0.0, min(float(w), float(v)))

    def cy(v: float) -> float:
        return max(0.0, min(float(h), float(v)))

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
            x1, y1 = cx(wl["x1"]), cy(wl["y1"])
            x2, y2 = cx(wl["x2"]), cy(wl["y2"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.hypot(x2 - x1, y2 - y1) < 3:
            continue
        try:
            wht = float(wl.get("thickness_px"))
        except (TypeError, ValueError):
            wht = 0.0
        wh = max(2.0, wht / 2.0) if wht > 0 else half
        walls.append({"outer": _wall_rect(x1, y1, x2, y2, wh), "holes": []})

    def _clean_poly(pts) -> list[list[float]]:
        out: list[list[float]] = []
        for p in pts or []:
            try:
                out.append([cx(p[0]), cy(p[1])])
            except (TypeError, ValueError, IndexError):
                continue
        return out

    rooms: list[dict] = []
    for rm in parsed.get("rooms") or []:
        poly = _clean_poly(rm.get("polygon"))
        if len(poly) >= 3:
            rooms.append({"name": str(rm.get("name") or ""), "outer": poly})

    fixtures: list[dict] = []
    for fx in parsed.get("fixtures") or []:
        try:
            x, y = cx(fx["x"]), cy(fx["y"])
        except (KeyError, TypeError, ValueError):
            continue
        try:
            fw = float(fx.get("width_px")) or thk * 4
        except (TypeError, ValueError):
            fw = thk * 4
        try:
            fd = float(fx.get("depth_px")) or fw
        except (TypeError, ValueError):
            fd = fw
        try:
            rot = float(fx.get("rotation_deg")) or 0.0
        except (TypeError, ValueError):
            rot = 0.0
        fixtures.append({
            "type": str(fx.get("type") or "other"),
            "x": x, "y": y, "w_px": abs(fw), "d_px": abs(fd), "angle_deg": rot,
        })

    def _openings(items) -> list[dict]:
        out: list[dict] = []
        for o in items or []:
            try:
                x, y = cx(o["x"]), cy(o["y"])
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
        "rooms": rooms,
        "fixtures": fixtures,
        "input_image_b64": base64.b64encode(raw).decode("ascii"),
        "source": "gemini",
    }

    scale = parsed.get("scale") or {}
    ppm = 0.0
    try:
        ppm = float(scale.get("px_per_meter"))
    except (TypeError, ValueError):
        ppm = 0.0
    # fallback: derive scale from the overall building dimension in metres
    if ppm <= 0:
        try:
            bwm = float(scale.get("building_width_m"))
        except (TypeError, ValueError):
            bwm = 0.0
        if bwm > 0 and walls:
            xs = [p[0] for wl in walls for p in wl["outer"]]
            span = (max(xs) - min(xs)) if xs else 0.0
            if span > 0:
                ppm = span / bwm
                scale = {**scale, "note": (scale.get("note") or "") + " (via building_width_m)"}
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
            # Note: no responseSchema — the strict OpenAPI subset made Gemini
            # drop the optional rooms/fixtures/scale fields. A plain JSON mime
            # type + an explicit shape in the prompt returns everything.
            "responseMimeType": "application/json",
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
