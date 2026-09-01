// =====================================================================
// QB5D — vectorexport.js
// Exporta a planta captada (paredes/vãos/cômodos/mobília + escala) como
// arquivo VETORIAL pronto para CAD:
//   - SVG  (viewBox e unidades em mm quando há escala; camadas <g> nomeadas)
//   - DXF  (R12/R14 ASCII, LWPOLYLINE + TEXT, camadas no padrão AIA)
//
// Nenhum serviço externo: tudo montado como texto aqui. A precisão depende
// da escala informada — sempre confira uma medida conhecida no CAD.
// Camadas: A-WALL / A-DOOR / A-GLAZ / A-ROOM / A-FURN / A-ANNO-DIMS
// =====================================================================

const LAYERS = {
  wall: { name: "A-WALL", aci: 7, rgb: "#2b2b2b" },
  door: { name: "A-DOOR", aci: 30, rgb: "#f59e0b" },
  glaz: { name: "A-GLAZ", aci: 4, rgb: "#38bdf8" },
  room: { name: "A-ROOM", aci: 8, rgb: "#9aa0a6" },
  furn: { name: "A-FURN", aci: 9, rgb: "#7f9a9a" },
  anno: { name: "A-ANNO-DIMS", aci: 1, rgb: "#e11d48" },
};

const num = (v) => (Math.round(v * 1000) / 1000);

function ringsOf(polyList) {
  // [{outer:[[x,y]..], holes:[[[x,y]..]..]}] -> [[[x,y]..], ...] (todos os anéis)
  const out = [];
  for (const p of polyList || []) {
    if (Array.isArray(p.outer) && p.outer.length >= 2) out.push(p.outer);
    for (const h of p.holes || []) if (Array.isArray(h) && h.length >= 2) out.push(h);
  }
  return out;
}

function fixtureRect(f) {
  const w = (f.w_px || f.width_px || 30) / 2;
  const d = (f.d_px || f.depth_px || w * 2) / 2;
  const a = ((f.angle_deg || f.rotation_deg || 0) * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, y]) => [
    f.x + x * ca - y * sa, f.y + x * sa + y * ca,
  ]);
}

function polyArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
function centroid(ring) {
  let x = 0, y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}

// ---------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------
export function planToSVG(data, opts = {}) {
  const [W, H] = data.canvas_size || [1000, 1000];
  const mpp = data.meters_per_pixel && data.meters_per_pixel > 0 ? data.meters_per_pixel : null;
  const s = mpp ? mpp * 1000 : 1;          // px -> mm (ou px -> px se sem escala)
  const unit = mpp ? "mm" : "";
  const w = num(W * s), h = num(H * s);

  const P = (ring, close = true) =>
    ring.map(([x, y], i) => `${i ? "L" : "M"}${num(x * s)} ${num(y * s)}`).join(" ") + (close ? "Z" : "");
  const pathWithHoles = (poly) => {
    let d = P(poly.outer);
    for (const hole of poly.holes || []) d += " " + P(hole);
    return d;
  };

  const g = [];
  // paredes
  const wallPolys = data.polygons?.wall || [];
  if (wallPolys.length) {
    g.push(`<g id="${LAYERS.wall.name}" fill="${LAYERS.wall.rgb}" stroke="none" fill-rule="evenodd">` +
      wallPolys.map((p) => `<path d="${pathWithHoles(p)}"/>`).join("") + `</g>`);
  }
  // portas / janelas
  for (const [k, list] of [["door", data.polygons?.door], ["glaz", data.polygons?.window]]) {
    const L = LAYERS[k];
    if (list && list.length) {
      g.push(`<g id="${L.name}" fill="${L.rgb}" stroke="none">` +
        list.map((p) => `<path d="${pathWithHoles(p)}"/>`).join("") + `</g>`);
    }
  }
  // cômodos + rótulos
  if (data.rooms && data.rooms.length) {
    const parts = [];
    for (const r of data.rooms) {
      const ring = r.outer || r.polygon;
      if (!Array.isArray(ring) || ring.length < 3) continue;
      parts.push(`<path d="${P(ring)}" fill="${LAYERS.room.rgb}" fill-opacity="0.08" stroke="${LAYERS.room.rgb}" stroke-width="${num(0.15 * (mpp ? 1000 : 20))}"/>`);
      const [cx, cy] = centroid(ring);
      const areaM2 = mpp ? polyArea(ring) * mpp * mpp : 0;
      const label = (r.name || "") + (areaM2 ? `  ${areaM2.toFixed(1)} m²` : "");
      if (label.trim()) {
        parts.push(`<text x="${num(cx * s)}" y="${num(cy * s)}" font-size="${num(mpp ? 250 : 14)}" fill="${LAYERS.room.rgb}" text-anchor="middle">${escapeXml(label.trim())}</text>`);
      }
    }
    g.push(`<g id="${LAYERS.room.name}">${parts.join("")}</g>`);
  }
  // mobília
  if (data.fixtures && data.fixtures.length) {
    const parts = data.fixtures.map((f) => {
      const ring = fixtureRect(f);
      return `<path d="${P(ring)}" fill="none" stroke="${LAYERS.furn.rgb}" stroke-width="${num(mpp ? 30 : 1.2)}"/>` +
        `<text x="${num(f.x * s)}" y="${num(f.y * s)}" font-size="${num(mpp ? 160 : 9)}" fill="${LAYERS.furn.rgb}" text-anchor="middle">${escapeXml(f.type || "")}</text>`;
    });
    g.push(`<g id="${LAYERS.furn.name}">${parts.join("")}</g>`);
  }
  // anotação: cota geral + barra de escala
  {
    const parts = [];
    if (mpp) {
      const wm = W * mpp, hm = H * mpp;
      parts.push(`<text x="${num(w / 2)}" y="${num(-h * 0.02)}" font-size="${num(300)}" fill="${LAYERS.anno.rgb}" text-anchor="middle">${wm.toFixed(2)} m</text>`);
      parts.push(`<text x="${num(-w * 0.02)}" y="${num(h / 2)}" font-size="${num(300)}" fill="${LAYERS.anno.rgb}" text-anchor="middle" transform="rotate(-90 ${num(-w * 0.02)} ${num(h / 2)})">${hm.toFixed(2)} m</text>`);
      // barra de escala de 1 m
      const bar = 1000; // mm
      parts.push(`<g stroke="${LAYERS.anno.rgb}" stroke-width="40"><line x1="0" y1="${num(h + 400)}" x2="${bar}" y2="${num(h + 400)}"/><line x1="0" y1="${num(h + 300)}" x2="0" y2="${num(h + 500)}"/><line x1="${bar}" y1="${num(h + 300)}" x2="${bar}" y2="${num(h + 500)}"/></g>`);
      parts.push(`<text x="${num(bar / 2)}" y="${num(h + 800)}" font-size="250" fill="${LAYERS.anno.rgb}" text-anchor="middle">1 m</text>`);
    } else {
      parts.push(`<text x="${num(w / 2)}" y="${num(h * 0.99)}" font-size="14" fill="${LAYERS.anno.rgb}" text-anchor="middle">sem escala — calibre no editor</text>`);
    }
    g.push(`<g id="${LAYERS.anno.name}">${parts.join("")}</g>`);
  }

  const dims = unit ? `width="${w}${unit}" height="${h}${unit}" ` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" ${dims}viewBox="0 0 ${w} ${h}">
<!-- Planta vetorizada por QB5D. ${mpp ? `Escala real: 1 px = ${num(mpp * 1000)} mm.` : "SEM ESCALA."} Camadas: ${Object.values(LAYERS).map((l) => l.name).join(", ")}. -->
${g.join("\n")}
</svg>`;
}

function escapeXml(str) {
  return String(str).replace(/[<>&"']/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]
  ));
}

// ---------------------------------------------------------------------
// DXF (ASCII, compatível R12/R14 — LWPOLYLINE + TEXT)
// ---------------------------------------------------------------------
export function planToDXF(data) {
  const [W, H] = data.canvas_size || [1000, 1000];
  const mpp = data.meters_per_pixel && data.meters_per_pixel > 0 ? data.meters_per_pixel : null;
  const s = mpp ? mpp * 1000 : 1;      // px -> mm
  const insunits = mpp ? 4 : 0;        // 4 = milímetros

  // DXF: Y para cima. Imagem: Y para baixo. Espelha em Y.
  const X = (px) => num(px * s);
  const Y = (py) => num((H - py) * s);

  const out = [];
  const p = (code, val) => { out.push(String(code)); out.push(String(val)); };

  p(0, "SECTION"); p(2, "HEADER");
  p(9, "$INSUNITS"); p(70, insunits);
  p(9, "$ACADVER"); p(1, "AC1009");
  p(0, "ENDSEC");

  p(0, "SECTION"); p(2, "TABLES");
  p(0, "TABLE"); p(2, "LAYER"); p(70, Object.keys(LAYERS).length);
  for (const L of Object.values(LAYERS)) {
    p(0, "LAYER"); p(2, L.name); p(70, 0); p(62, L.aci); p(6, "CONTINUOUS");
  }
  p(0, "ENDTAB");
  p(0, "ENDSEC");

  p(0, "SECTION"); p(2, "ENTITIES");

  const lwpoly = (ring, layer, closed = true) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    p(0, "LWPOLYLINE"); p(8, layer); p(90, ring.length); p(70, closed ? 1 : 0);
    for (const [x, y] of ring) { p(10, X(x)); p(20, Y(y)); }
  };
  const text = (x, y, hgt, layer, str) => {
    p(0, "TEXT"); p(8, layer); p(10, X(x)); p(20, Y(y)); p(40, num(hgt));
    p(1, String(str).replace(/\n/g, " ")); p(72, 1); p(11, X(x)); p(21, Y(y));
  };

  for (const ring of ringsOf(data.polygons?.wall)) lwpoly(ring, LAYERS.wall.name);
  for (const ring of ringsOf(data.polygons?.door)) lwpoly(ring, LAYERS.door.name);
  for (const ring of ringsOf(data.polygons?.window)) lwpoly(ring, LAYERS.glaz.name);

  for (const r of data.rooms || []) {
    const ring = r.outer || r.polygon;
    if (!Array.isArray(ring) || ring.length < 3) continue;
    lwpoly(ring, LAYERS.room.name);
    const [cx, cy] = centroid(ring);
    const areaM2 = mpp ? polyArea(ring) * mpp * mpp : 0;
    const label = (r.name || "").trim() + (areaM2 ? ` ${areaM2.toFixed(1)}m2` : "");
    if (label) text(cx, cy, mpp ? 250 : 12, LAYERS.room.name, label);
  }
  for (const f of data.fixtures || []) {
    lwpoly(fixtureRect(f), LAYERS.furn.name);
    if (f.type) text(f.x, f.y, mpp ? 150 : 8, LAYERS.furn.name, f.type);
  }
  if (mpp) {
    text(W * s / 2 / s, -20, 300, LAYERS.anno.name, `${(W * mpp).toFixed(2)} m x ${(H * mpp).toFixed(2)} m`);
    lwpoly([[0, H + 40], [1000 / s, H + 40]].map(([x, y]) => [x, y]), LAYERS.anno.name, false);
    text(500 / s, H + 90, 250, LAYERS.anno.name, "1 m");
  }

  p(0, "ENDSEC");
  p(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------
export function downloadText(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export function exportPlanVector(data, baseName, fmt) {
  const name = (baseName || "planta").replace(/[^\w.-]+/g, "_");
  if (fmt === "dxf") downloadText(`${name}.dxf`, planToDXF(data), "application/dxf");
  else downloadText(`${name}.svg`, planToSVG(data), "image/svg+xml");
}

window.__QB5D_vector = { planToSVG, planToDXF, exportPlanVector };
