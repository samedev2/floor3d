// =====================================================================
// QB5D — detect.js
// Detecção automática de paredes a partir de uma IMAGEM de planta (foto,
// print, PDF rasterizado) — visão computacional clássica, sem IA, no
// navegador. Funciona bem em plantas de traço sólido e alto contraste
// (parede escura/colorida sobre fundo claro); em rascunho a lápis o
// resultado é grosseiro. O editor de traçado permite corrigir.
//
// Saída: { segments:[{a,b}], polygons:{wall,door,window}, canvas_size,
//          content_rect, estThickness_px }
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- carregar imagem em ImageData (com downscale) ----------
export function imageToData(img, maxDim = 1100) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h), w, h, scale };
}

// ---------- Otsu ----------
function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// ---------- binariza: 1 = parede/tinta (escuro) ----------
function binarize(img) {
  const { data, w, h } = img;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data.data[i * 4], g = data.data[i * 4 + 1], b = data.data[i * 4 + 2];
    gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  const thr = otsu(gray);
  // marca como "escuro" o que está abaixo do limiar de Otsu com folga
  const t = clamp(thr - 6, 20, 235);
  const bin = new Uint8Array(w * h);
  let dark = 0;
  for (let i = 0; i < w * h; i++) if (gray[i] < t) { bin[i] = 1; dark++; }
  // se "escuro" virou quase tudo (fundo escuro), inverte
  if (dark > w * h * 0.55) for (let i = 0; i < w * h; i++) bin[i] = bin[i] ? 0 : 1;
  return bin;
}

// ---------- componentes conexos: remove respingos (texto, móveis) ----------
function despeckle(bin, w, h) {
  const lab = new Int32Array(w * h);
  const out = new Uint8Array(w * h);
  let next = 1;
  const comps = [];
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || lab[s]) continue;
    const id = next++;
    const stack = [s]; lab[s] = id;
    let area = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    const cells = [];
    while (stack.length) {
      const i = stack.pop();
      cells.push(i); area++;
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (bin[j] && !lab[j]) { lab[j] = id; stack.push(j); }
      }
    }
    comps.push({ id, area, cells, bw: maxX - minX, bh: maxY - minY });
  }
  if (!comps.length) return out;
  const maxSide = Math.max(w, h);
  // guarda componentes "grandes" ou "longos" (paredes); descarta pequenos
  const minArea = Math.max(60, w * h * 0.0006);
  const minLong = maxSide * 0.12;
  for (const c of comps) {
    const long = Math.max(c.bw, c.bh);
    if (c.area >= minArea && long >= minLong) for (const i of c.cells) out[i] = 1;
  }
  // se sobrou quase nada, relaxa
  let kept = 0; for (let i = 0; i < w * h; i++) kept += out[i];
  if (kept < w * h * 0.002) {
    for (const c of comps) if (c.area >= minArea * 0.4) for (const i of c.cells) out[i] = 1;
  }
  return out;
}

// ---------- espessura média do traço (para escala/altura) ----------
function estimateStroke(bin, w, h) {
  // varre linhas, mede comprimento das corridas de "1"; mediana das curtas
  const runs = [];
  for (let y = 0; y < h; y += 2) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) run++;
      else { if (run > 0 && run < 40) runs.push(run); run = 0; }
    }
  }
  if (!runs.length) return 6;
  runs.sort((a, b) => a - b);
  return clamp(runs[runs.length >> 1], 2, 30);
}

// ---------- Zhang–Suen thinning ----------
function thin(bin, w, h) {
  const img = Uint8Array.from(bin);
  const idx = (x, y) => y * w + x;
  let changed = true;
  const toClear = [];
  const nb = (x, y) => [
    img[idx(x, y - 1)], img[idx(x + 1, y - 1)], img[idx(x + 1, y)], img[idx(x + 1, y + 1)],
    img[idx(x, y + 1)], img[idx(x - 1, y + 1)], img[idx(x - 1, y)], img[idx(x - 1, y - 1)],
  ];
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[idx(x, y)]) continue;
          const p = nb(x, y);
          const B = p.reduce((a, v) => a + v, 0);
          if (B < 2 || B > 6) continue;
          let A = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
          if (A !== 1) continue;
          const [n0, , n2, , n4, , n6] = p;
          if (step === 0) {
            if (n0 * n2 * n4 !== 0) continue;
            if (n2 * n4 * n6 !== 0) continue;
          } else {
            if (n0 * n2 * n6 !== 0) continue;
            if (n0 * n4 * n6 !== 0) continue;
          }
          toClear.push(idx(x, y));
        }
      }
      if (toClear.length) { changed = true; for (const i of toClear) img[i] = 0; }
    }
  }
  return img;
}

// ---------- esqueleto -> segmentos de linha ----------
function skeletonToSegments(sk, w, h, minLen) {
  const idx = (x, y) => y * w + x;
  const neigh = (x, y) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[idx(nx, ny)]) out.push([nx, ny]);
    }
    return out;
  };
  const visited = new Uint8Array(w * h);
  const segs = [];
  const isNode = (x, y) => { const n = neigh(x, y).length; return n === 1 || n >= 3; };

  const starts = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++)
    if (sk[idx(x, y)] && isNode(x, y)) starts.push([x, y]);

  const walkFrom = (sx, sy) => {
    for (const [nx0, ny0] of neigh(sx, sy)) {
      if (visited[idx(sx, sy)] && visited[idx(nx0, ny0)]) continue;
      let px = sx, py = sy, cx = nx0, cy = ny0;
      const pts = [[sx, sy]];
      let g = 0;
      while (g++ < w + h) {
        pts.push([cx, cy]);
        visited[idx(cx, cy)] = 1;
        if (isNode(cx, cy) && !(cx === sx && cy === sy)) break;
        const nn = neigh(cx, cy).filter(([a, b]) => !(a === px && b === py));
        if (!nn.length) break;
        px = cx; py = cy;
        [cx, cy] = nn[0];
      }
      if (pts.length >= 2) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minLen) {
          segs.push(simplify(pts, 2.5));
        }
      }
    }
  };
  for (const [x, y] of starts) walkFrom(x, y);

  // esqueletos fechados (sem nós): pega loops
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (sk[idx(x, y)] && !visited[idx(x, y)]) walkFrom(x, y);
  }

  // achata polilinhas em pares de segmentos retos
  const out = [];
  for (const poly of segs) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = { x: poly[i][0], y: poly[i][1] };
      const b = { x: poly[i + 1][0], y: poly[i + 1][1] };
      if (Math.hypot(b.x - a.x, b.y - a.y) >= minLen * 0.5) out.push({ a, b });
    }
  }
  return out;
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  const d2l = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  while (stack.length) {
    const [i, j] = stack.pop();
    let md = 0, mi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = d2l(pts[k], pts[i], pts[j]);
      if (d > md) { md = d; mi = k; }
    }
    if (md > eps && mi > 0) { keep[mi] = true; stack.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// ---------- API ----------
export function detectFromImage(img, opts = {}) {
  const maxDim = opts.maxDim || 1100;
  const { data, w, h } = imageToData(img, maxDim);
  let bin = binarize({ data, w, h });
  bin = despeckle(bin, w, h);
  const stroke = estimateStroke(bin, w, h);
  const sk = thin(bin, w, h);
  const minLen = Math.max(12, Math.max(w, h) * 0.03);
  let segments = skeletonToSegments(sk, w, h, minLen);

  // funde segmentos quase colineares e junta pontas próximas
  segments = mergeSegments(segments, stroke * 1.5);

  const rect = (a, b, ht) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const px = -dy / l * ht, py = dx / l * ht;
    return [
      [a.x + px, a.y + py], [b.x + px, b.y + py],
      [b.x - px, b.y - py], [a.x - px, a.y - py],
    ];
  };
  const half = Math.max(2, stroke / 2);
  const wall = segments.map((s) => ({ outer: rect(s.a, s.b, half), holes: [] }));

  return {
    canvas_size: [w, h],
    content_rect: [0, 0, w, h],
    polygons: { wall, door: [], window: [] },
    segments,
    estThickness_px: stroke,
  };
}

function mergeSegments(segs, snap) {
  // junta pontas próximas
  const pts = [];
  for (const s of segs) { pts.push(s.a, s.b); }
  for (const p of pts) for (const q of pts) {
    if (p === q) continue;
    if (Math.hypot(p.x - q.x, p.y - q.y) < snap) { q.x = p.x; q.y = p.y; }
  }
  // remove duplicados / degenerados
  const seen = new Set();
  const out = [];
  for (const s of segs) {
    if (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < snap) continue;
    const k = [s.a.x, s.a.y, s.b.x, s.b.y].map((v) => Math.round(v)).join(",");
    const k2 = [s.b.x, s.b.y, s.a.x, s.a.y].map((v) => Math.round(v)).join(",");
    if (seen.has(k) || seen.has(k2)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}
