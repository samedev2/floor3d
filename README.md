# Floorplan to 3D

![preview](docs/preview.gif)

Floor-plan structure extraction. A ResNet-UNet trained on [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) segments each pixel of an architectural drawing into wall / door / window / floor; a small browser viewer extrudes those predictions into 3D walls, doors, and windows you can orbit around.

**Hosted preview:** [floorplan-to-3d.pages.dev](https://floorplan-to-3d.pages.dev) — three pre-rendered example plans, no backend. To run inference on your own SVGs, follow "Try it locally" below.

## Prerequisites

- **Python 3.11 – 3.13.** The project pins 3.11.9 via `.python-version`; 3.12
  is what CI and the maintainers run. PyTorch has no stable wheels for 3.14
  yet, so avoid it.
- **No system libraries.** SVG rasterization goes through `pymupdf`, whose
  wheel bundles everything — there is nothing to `apt install` / `brew
  install`. (Older revisions needed Cairo; that dependency is gone.)
- A GPU is **not** required for inference. The server runs on CPU;
  `BUILDINGCV_DEVICE=cuda` (or `mps`) picks a different backend if available.

## Try it locally

The fastest path uses [`uv`](https://docs.astral.sh/uv/) (`pip install uv`),
which pins the Python version for you:

```bash
git clone https://github.com/Yytsi/floorplan-to-3d
cd floorplan-to-3d

uv venv --python 3.12 .venv
# CPU PyTorch wheel (Windows/Linux). Skip the --index-url on macOS.
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
uv pip install -e ".[serve]"

python scripts/fetch_weights.py   # -> weights/best.safetensors + config.yaml
```

Then start the server:

```powershell
.\dev.ps1          # Windows (PowerShell)  ->  http://localhost:8000
```

```bash
./dev.sh           # macOS / Linux         ->  http://localhost:8000
```

Plain `venv` + `pip` works too if you already have Python 3.11–3.13 on
`PATH` — replace the `uv venv` / `uv pip` lines with
`python -m venv .venv`, activate it, and `pip install ...`.

The local viewer adds an "upload SVG" button on top of the three demo plans, so you can drop in any [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) `model.svg` and see the model run live.

## How it works

- **Segmentation.** UNet with a pretrained ResNet-34 encoder, 4 output classes (`floor`, `wall`, `door`, `window`). Trained at 512×512 with aspect-preserving letterboxing so non-square plans aren't stretched. See [`src/buildingcv/model.py`](src/buildingcv/model.py) and [`src/buildingcv/train.py`](src/buildingcv/train.py).
- **SVG rasterization.** `pymupdf` renders the annotation SVG to the model's
  input image. Non-structural subtrees (furniture, dimensions, text) and
  hidden floors (`display:none` — CubiCasa stacks every storey in one file)
  are stripped *before* rendering so the image matches the mask's semantics.
  See [`src/buildingcv/svg_render.py`](src/buildingcv/svg_render.py).
- **Polygon extraction.** Per class: morphological closing → `cv2.findContours` (CCOMP, so each wall ring keeps its doorway holes) → Douglas–Peucker simplification → drop sub-threshold speckle. See [`src/buildingcv/extract_polygons.py`](src/buildingcv/extract_polygons.py).
- **3D viewer.** A single-file Three.js page that extrudes each polygon to its class height (walls full, doors shorter, windows as glass slabs between sill and lintel) and animates them rising from the input plan. See [`viewer/index.html`](viewer/index.html).

## Training

```bash
pip install -e ".[train]"
python -m buildingcv.train --config configs/default.yaml
```

Configs live in [`configs/`](configs); each run writes a timestamped dir under `runs/` with `best.pt`, `last.pt`, `metrics.csv`, and `train.log`. Resume with `--resume runs/.../last.pt`.

To regenerate the static-site demos after retraining:

```bash
python scripts/build_demos.py    # writes viewer/demos/{key}.json
```

## Layout

```
src/buildingcv/      # model, training, polygon extraction
server/              # FastAPI inference server (used by ./dev.sh)
viewer/              # Three.js 3D viewer + prebuilt demos
scripts/             # build_demos.py
configs/             # YAML training configs
```
