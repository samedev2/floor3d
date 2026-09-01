// =====================================================================
// QB5D — topology.js
// Converte os polígonos brutos da detecção (retângulos de parede/porta/janela
// em pixels) numa topologia utilizável pelo gerador estrutural:
//   - linhas de centro das paredes (eixo + espessura)
//   - grafo de paredes (nós nas junções -> candidatos a pilar)
//   - cômodos (flood-fill do espaço negativo)  -> áreas e vãos
//   - vãos (porta/janela) encaixados no trecho de parede
//   - contorno da projeção (footprint) -> laje / radier
//
// Tudo permanece em ESPAÇO DE PIXELS. render.js aplica a escala p/ mundo.
// =====================================================================

const EPS = 1e-9;

// ---------- utilitários de vetor ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pointSegParam(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || EPS;
  return dot(sub(p, a), ab) / l2; // t (pode sair de [0,1])
}
function pointSegDist(p, a, b) {
  const t = Math.max(0, Math.min(1, pointSegParam(p, a, b)));
  const proj = add(a, mul(sub(b, a), t));
  return dist(p, proj);
}

// ---------- PCA: eixo principal de um anel de pontos ----------
function principalAxis(points) {
  let mx = 0, my = 0;
  for (const [x, y] of points) { mx += x; my += y; }
  mx /= points.length; my /= points.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) {
    const dx = x - mx, dy = y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const n = points.length || 1;
  sxx /= n; sxy /= n; syy /= n;
  // autovalores/autovetores de [[sxx,sxy],[sxy,syy]]
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc;
  let ax = { x: sxy, y: l1 - sxx };
  if (len(ax) < EPS) ax = { x: 1, y: 0 };
  ax = norm(ax);
  return { center: { x: mx, y: my }, axis: ax };
}

// Retângulo de parede -> segmento de centro { a, b, thickness }
function wallToCenterline(poly) {
  const pts = poly.outer;
  const { center, axis } = principalAxis(pts);
  const perp = { x: -axis.y, y: axis.x };
  let tmin = Infinity, tmax = -Infinity, pmin = Infinity, pmax = -Infinity;
  for (const [x, y] of pts) {
    const d = { x: x - center.x, y: y - center.y };
    const tp = dot(d, axis);
    const pp = dot(d, perp);
    if (tp < tmin) tmin = tp;
    if (tp > tmax) tmax = tp;
    if (pp < pmin) pmin = pp;
    if (pp > pmax) pmax = pp;
  }
  const a = add(center, mul(axis, tmin));
  const b = add(center, mul(axis, tmax));
  const length = tmax - tmin;
  let thickness = pmax - pmin;
  // Polígonos de parede às vezes vêm como blocos em "L" / cantos gordos;
  // nesses casos o eixo perpendicular capta um "vão" e não a espessura real.
  // Limita a espessura a algo plausível para não inflar snap/traços depois.
  thickness = Math.min(Math.max(thickness, 2), Math.max(6, length * 0.4), 22);
  return { a, b, length, thickness };
}

// ---------- grafo: junta pontos próximos (union-find) ----------
class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { return this.p[i] === i ? i : (this.p[i] = this.find(this.p[i])); }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
}

// ---------- rasterização p/ cômodos + footprint ----------
// Barreira = polígonos preenchidos (vãos incluídos p/ selar a envoltória)
// + traços grossos ao longo das linhas de centro das paredes, o que fecha
// as folgas de 1–2 px nas junções (senão o flood "vaza" e não há cômodos).
function rasterMask(polygonsList, strokeSegs, w, h) {
  const cvs = document.createElement("canvas");
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const poly of polygonsList) {
    ctx.beginPath();
    poly.outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    for (const hole of poly.holes || []) {
      hole.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  for (const s of strokeSegs || []) {
    ctx.lineWidth = Math.max(3, s.thickness);
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const solid = new Uint8Array(w * h); // 1 = parede/vão (barreira)
  for (let i = 0; i < w * h; i++) solid[i] = rgba[i * 4] > 128 ? 1 : 0;
  return solid;
}

function floodExterior(solid, w, h) {
  // marca com 3 tudo que é 0 e alcançável a partir da borda
  const cell = new Uint8Array(solid); // copia: 0 vazio, 1 barreira
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (cell[i] === 0) { cell[i] = 3; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return cell; // 0 = interior vazio (cômodo), 1 = barreira, 3 = exterior
}

function connectedRooms(cell, w, h, minAreaPx) {
  const label = new Int32Array(w * h).fill(0);
  const rooms = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (cell[start] !== 0 || label[start] !== 0) continue;
    const id = next++;
    const stack = [start];
    label[start] = id;
    let area = 0, sx = 0, sy = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      area++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (cell[j] === 0 && label[j] === 0) { label[j] = id; stack.push(j); }
      }
    }
    if (area < minAreaPx) continue;
    rooms.push({
      id: `R${rooms.length + 1}`,
      area_px: area,
      centroid: { x: sx / area, y: sy / area },
      bbox: { minX, minY, maxX, maxY },
      span_min_px: Math.min(maxX - minX, maxY - minY),
      span_max_px: Math.max(maxX - minX, maxY - minY),
    });
  }
  return rooms;
}

// Moore-neighbor contour trace sobre a máscara "construção" (não-exterior).
function traceFootprint(cell, w, h) {
  const isB = (x, y) => x >= 0 && y >= 0 && x < w && y < h && cell[y * w + x] !== 3;
  // acha primeiro pixel de construção (varredura)
  let sx = -1, sy = -1;
  for (let y = 0; y < h && sy < 0; y++)
    for (let x = 0; x < w; x++)
      if (isB(x, y)) { sx = x; sy = y; break; }
  if (sx < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [];
  let cx = sx, cy = sy, dir = 6; // começa procurando p/ cima
  const start = `${cx},${cy}`;
  let guard = 0;
  do {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + k) % 8;
      const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
      if (isB(nx, ny)) {
        contour.push([cx, cy]);
        cx = nx; cy = ny;
        dir = (nd + 5) % 8; // vira p/ "atrás-esquerda"
        found = true;
        break;
      }
    }
    if (!found) break;
  } while ((`${cx},${cy}` !== start || contour.length < 3) && ++guard < 8 * (w + h));
  return simplify(contour, 3.0);
}

// Douglas–Peucker simples
function simplify(pts, eps) {
  if (pts.length < 3) return pts.map(([x, y]) => ({ x, y }));
  const P = pts.map(([x, y]) => ({ x, y }));
  const keep = new Array(P.length).fill(false);
  keep[0] = keep[P.length - 1] = true;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = pointSegDist(P[k], P[i], P[j]);
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([i, idx], [idx, j]);
    }
  }
  return P.filter((_, k) => keep[k]);
}

// =====================================================================
// API
// =====================================================================
export function buildTopology(data, opts = {}) {
  const [w, h] = data.canvas_size;
  const wallPolys = data.polygons.wall || [];
  const doorPolys = data.polygons.door || [];
  const windowPolys = data.polygons.window || [];

  // --- 1. linhas de centro ---
  const raw = wallPolys.map(wallToCenterline).filter((s) => s.length > 1);
  const medThk =
    raw.length
      ? raw.map((s) => s.thickness).sort((a, b) => a - b)[raw.length >> 1]
      : 10;
  const snapPx = opts.snapPx ?? Math.max(6, Math.min(medThk * 1.3, 16));

  // --- 2. junções: cluster de endpoints + split em "T" ---
  let segs = raw.map((s, i) => ({ id: `W${i + 1}`, a: s.a, b: s.b, thickness: s.thickness }));

  // 2a. splits em T: endpoint de um cai no meio de outro
  const endpoints = [];
  segs.forEach((s) => { endpoints.push({ ...s.a }); endpoints.push({ ...s.b }); });
  const splits = new Map(); // segId -> [t,...]
  for (const p of endpoints) {
    for (const s of segs) {
      if (dist(p, s.a) < snapPx || dist(p, s.b) < snapPx) continue;
      if (pointSegDist(p, s.a, s.b) < snapPx) {
        const t = pointSegParam(p, s.a, s.b);
        if (t > 0.06 && t < 0.94) {
          if (!splits.has(s.id)) splits.set(s.id, []);
          splits.get(s.id).push(t);
        }
      }
    }
  }
  const split2 = [];
  let wc = 0;
  for (const s of segs) {
    const ts = (splits.get(s.id) || []).sort((a, b) => a - b);
    if (!ts.length) { split2.push({ ...s, id: `W${++wc}` }); continue; }
    const cuts = [0, ...ts, 1];
    for (let k = 0; k < cuts.length - 1; k++) {
      const p0 = add(s.a, mul(sub(s.b, s.a), cuts[k]));
      const p1 = add(s.a, mul(sub(s.b, s.a), cuts[k + 1]));
      if (dist(p0, p1) < snapPx * 0.5) continue;
      split2.push({ id: `W${++wc}`, a: p0, b: p1, thickness: s.thickness });
    }
  }
  segs = split2;

  // 2b. cluster de endpoints -> nós
  const eps2 = [];
  segs.forEach((s) => { eps2.push({ seg: s, end: "a" }); eps2.push({ seg: s, end: "b" }); });
  const uf = new UF(eps2.length);
  for (let i = 0; i < eps2.length; i++)
    for (let j = i + 1; j < eps2.length; j++) {
      const pi = eps2[i].seg[eps2[i].end], pj = eps2[j].seg[eps2[j].end];
      if (dist(pi, pj) < snapPx) uf.union(i, j);
    }
  const clusters = new Map();
  for (let i = 0; i < eps2.length; i++) {
    const r = uf.find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(i);
  }
  const nodes = [];
  const nodeOfEp = new Array(eps2.length);
  let nid = 0;
  for (const [, idxs] of clusters) {
    let x = 0, y = 0;
    for (const i of idxs) { const p = eps2[i].seg[eps2[i].end]; x += p.x; y += p.y; }
    x /= idxs.length; y /= idxs.length;
    const node = { id: `N${++nid}`, x, y, wallIds: [], degree: 0 };
    nodes.push(node);
    for (const i of idxs) nodeOfEp[i] = node;
  }
  segs.forEach((s, k) => {
    const na = nodeOfEp[k * 2], nb = nodeOfEp[k * 2 + 1];
    s.nodeA = na.id; s.nodeB = nb.id;
    s.a = { x: na.x, y: na.y }; s.b = { x: nb.x, y: nb.y };
    s.dir = norm(sub(s.b, s.a));
    s.length_px = dist(s.a, s.b);
    na.wallIds.push(s.id); nb.wallIds.push(s.id);
    na.degree++; nb.degree++;
  });
  const walls = segs.filter((s) => s.length_px > snapPx * 0.5);

  // --- 3. cômodos + footprint (paredes engrossadas + vãos selados) ---
  // paredes já compartilham nós (endpoints snapados); um traço modesto por
  // trecho já fecha as junções sem engolir os cômodos.
  const strokeSegs = walls.map((s) => ({
    a: s.a, b: s.b, thickness: Math.min(Math.max(s.thickness, 4), 12),
  }));
  const solid = rasterMask([...wallPolys, ...doorPolys, ...windowPolys], strokeSegs, w, h);
  const cell = floodExterior(solid, w, h);
  let rooms = connectedRooms(cell, w, h, Math.max(120, w * h * 0.0008));
  // se a IA (Gemini) devolveu cômodos, usa esses (têm nome e são mais fiéis)
  if (Array.isArray(data.rooms) && data.rooms.length) {
    rooms = data.rooms
      .filter((r) => Array.isArray(r.outer) && r.outer.length >= 3)
      .map((r, i) => {
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, ax = 0, ay = 0;
        for (const [x, y] of r.outer) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          ax += x; ay += y;
        }
        const n = r.outer.length;
        return {
          id: `R${i + 1}`, name: r.name || "",
          area_px: shoelacePts(r.outer),
          centroid: { x: ax / n, y: ay / n },
          bbox: { minX, minY, maxX, maxY },
          span_min_px: Math.min(maxX - minX, maxY - minY),
          span_max_px: Math.max(maxX - minX, maxY - minY),
          outer: r.outer,
        };
      });
  }
  const footprint = traceFootprint(cell, w, h);
  let footprintArea_px = 0;
  for (let i = 0; i < cell.length; i++) if (cell[i] !== 3) footprintArea_px++;

  // --- 4. vãos encaixados nas paredes ---
  const openings = [];
  const mapOpening = (poly, kind, i) => {
    const c = principalAxis(poly.outer).center;
    let best = null, bestD = Infinity;
    for (const s of walls) {
      const d = pointSegDist(c, s.a, s.b);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > snapPx * 3) return;
    // largura do vão = extensão do polígono ao longo da direção da parede
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of poly.outer) {
      const tp = dot(sub({ x, y }, best.a), best.dir);
      if (tp < lo) lo = tp; if (tp > hi) hi = tp;
    }
    openings.push({
      id: `${kind === "door" ? "P" : "J"}${i + 1}`,
      kind,
      wallId: best.id,
      t: Math.max(0, Math.min(1, pointSegParam(c, best.a, best.b))),
      center: c,
      width_px: Math.max(hi - lo, 1),
    });
  };
  doorPolys.forEach((p, i) => mapOpening(p, "door", i));
  windowPolys.forEach((p, i) => mapOpening(p, "window", i));

  // --- 4b. contorno convexo (para lajes/radier): robusto onde o trace falha ---
  const hullPts = [];
  for (const s of walls) { hullPts.push([s.a.x, s.a.y], [s.b.x, s.b.y]); }
  for (const o of openings) hullPts.push([o.center.x, o.center.y]);
  const footprintHull = expandPoly(convexHull(hullPts), Math.min(medThk, 12) * 0.6);
  // usa o trace se ele cobrir uma área comparável ao hull; senão, hull.
  const hullArea = shoelacePts(footprintHull);
  const traceArea = footprint.length >= 3 ? shoelacePts(footprint.map((p) => [p.x, p.y])) : 0;
  const footprintPoly = traceArea > hullArea * 0.55 ? footprint.map((p) => [p.x, p.y]) : footprintHull;

  // --- bbox / centro (mesma base do dashboard: só paredes) ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of walls) {
    for (const p of [s.a, s.b]) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = w; maxY = h; }

  return {
    canvas: { w, h },
    bbox: { minX, minY, maxX, maxY },
    center: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 },
    snapPx,
    medianThickness_px: medThk,
    walls,              // grafo simplificado (junções) — p/ pilares
    nodes,
    rooms,
    openings,
    // polígonos crus da detecção — a alvenaria e as vigas usam ESTES para
    // reproduzir todo o traçado da planta (igual ao viewer 360).
    wallPolys,
    doorPolys,
    windowPolys,
    rawCenterlines: raw.map((s, i) => ({
      id: `RW${i + 1}`, a: s.a, b: s.b,
      dir: norm(sub(s.b, s.a)), length_px: dist(s.a, s.b), thickness: s.thickness,
    })),
    footprint,          // contorno traçado (pode ser irregular)
    footprintHull,      // envoltória convexa expandida
    footprintPoly,      // o melhor dos dois — use este para lajes/radier
    footprintArea_px,
    fixtures: Array.isArray(data.fixtures) ? data.fixtures : [],
  };
}

// ---------- convex hull (monotone chain) + expansão ----------
function convexHull(pts) {
  const P = pts.filter((p) => isFinite(p[0]) && isFinite(p[1]))
    .map((p) => [p[0], p[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P.map(([x, y]) => [x, y]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// empurra cada vértice para fora do centróide por `d` pixels
function expandPoly(poly, d) {
  if (poly.length < 3) return poly;
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * d, y + (dy / l) * d];
  });
}

function shoelacePts(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
