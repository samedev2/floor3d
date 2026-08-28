"""Class taxonomy and the CubiCasa-token → class mapping.

STATUS OF THIS FILE (read before training or trusting the icon classes)
-------------------------------------------------------------------------
- STRUCTURAL classes (floor/wall/door/window) are unchanged from the
  original project and stay fully verified: they've been trained on,
  shipped in the demo data, and are what every other module (model.py,
  train.py, extract_polygons.py, the viewer) currently expects.
- HYDRAULIC ICON classes (sink/toilet/bathtub/shower) are new and are
  SCAFFOLDING ONLY. Nothing has been retrained on them — there is no
  checkpoint anywhere in this repo that outputs these classes. Adding
  them here only prepares the taxonomy so the rest of the pipeline can
  grow into it once real training data exists.
- The SVG class tokens for these four are a best-effort guess based on
  the general icon taxonomy described in the CubiCasa5K paper (Kalervo
  et al. 2019, ~80 object categories including bathroom fixtures). They
  have NOT been verified against a real `model.svg` from the dataset —
  this project has no network access to download it. Before training on
  them: download the dataset (see README), open a handful of
  `model.svg` files, and grep their `class="..."` attributes for the
  actual fixture tokens. Fix TOKEN_TO_CLASS below to match reality.
  Getting a token wrong is a *safe no-op* here (svg_to_mask.py simply
  won't classify that polygon — it won't miscolor it as something
  else), so shipping this guess is low-risk, but it means near-zero
  recall on hydraulic icons until someone confirms the real tokens.

WHAT ELSE STILL NEEDS UPDATING (not done in this file, listed so the
next change is a diff, not an investigation):
  - src/buildingcv/extract_polygons.py: `EXTRACT_CLASSES` is hardcoded
    to ("wall", "door", "window") and controls which classes actually
    get turned into output polygons. The new icon classes won't appear
    in exported JSON until this tuple is extended.
  - viewer/index.html: the Three.js side has its own per-class extrusion
    constants (WALL_HEIGHT, DOOR_HEIGHT, WINDOW_SILL/TOP) and only knows
    how to draw wall/door/window meshes. Icons would need their own
    extrusion preset (e.g. a small fixed-height block) and a case in the
    mesh-building switch in loadPlan().
  - server/main.py: SAMPLES / the /extract response shape assumes the
    three structural classes; nothing breaks by adding more keys, but
    any client-side code that iterates a fixed class list needs checking.
  - A retrained checkpoint. model.py already reads NUM_CLASSES from this
    file dynamically, so the model architecture adapts automatically —
    but that also means any *existing* weights file becomes shape-
    incompatible the moment NUM_CLASSES changes (the final conv layer's
    channel count no longer matches). There's no weights file in this
    repo to break, but flagging it for whoever trains the first real
    checkpoint against this taxonomy.
"""

from collections import OrderedDict

# ---------------------------------------------------------------------------
# Structural classes — verified, trained, unchanged.
# ---------------------------------------------------------------------------
STRUCTURAL_CLASSES: tuple[str, ...] = ("floor", "wall", "door", "window")

# ---------------------------------------------------------------------------
# Hydraulic icon classes — scaffolding, see module docstring.
# Kept as a separate tuple (rather than just appending to CLASS_NAMES
# inline) so it's obvious at a glance which classes are the new,
# unverified addition.
# ---------------------------------------------------------------------------
HYDRAULIC_ICON_CLASSES: tuple[str, ...] = ("sink", "toilet", "bathtub", "shower")

# Appended after the structural classes so their ids (0-3) stay stable —
# anything that ever hardcoded floor=0/wall=1/door=2/window=3 keeps working.
CLASS_NAMES: tuple[str, ...] = STRUCTURAL_CLASSES + HYDRAULIC_ICON_CLASSES
CLASS_TO_ID: dict[str, int] = {n: i for i, n in enumerate(CLASS_NAMES)}
NUM_CLASSES: int = len(CLASS_NAMES)
FLOOR_ID: int = CLASS_TO_ID["floor"]

# Map: a single class token from a CubiCasa SVG → our class.
# Order = priority. When a polygon's effective class set (own + inherited)
# contains multiple keys, the first match wins. So a polygon nested as
# Wall > Door > Threshold gets classified as `door`, not `wall`.
#
# The four icon entries at the end are the UNVERIFIED guesses described
# in the module docstring — confirm against a real model.svg before
# training on them.
TOKEN_TO_CLASS: "OrderedDict[str, str]" = OrderedDict(
    [
        ("Window", "window"),
        ("Door", "door"),
        ("Wall", "wall"),
        # --- unverified below this line ---
        ("Sink", "sink"),
        ("Toilet", "toilet"),
        ("Bathtub", "bathtub"),
        ("Shower", "shower"),
    ]
)

# Order in which classes are painted onto the mask. Later overwrites earlier.
# Icons go last: they're fixtures sitting on top of the floor/wall geometry,
# not openings *in* a wall the way doors/windows are, so there's no
# structural reason for them to overwrite (or be overwritten by) walls —
# but painting them last means a mis-drawn icon polygon that strays over a
# wall edge still reads as the icon, which is the more useful failure mode
# for a "where are the fixtures" pass.
PAINT_ORDER: tuple[str, ...] = ("wall", "door", "window", "sink", "toilet", "bathtub", "shower")

# RGB colors for visualization only — not used during training.
CLASS_COLORS: dict[str, tuple[int, int, int]] = {
    "floor": (240, 240, 235),
    "wall": (40, 40, 45),
    "door": (230, 120, 50),
    "window": (60, 150, 220),
    # Hydraulic icons — a distinct blue/teal-leaning family so they read as
    # one visual group in debug renders, separate from the door/window hues.
    "sink": (70, 180, 165),
    "toilet": (140, 95, 190),
    "bathtub": (205, 100, 150),
    "shower": (85, 195, 205),
}
