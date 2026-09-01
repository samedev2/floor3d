// =====================================================================
// QB5D — trace.js
// Editor de traçado: o usuário envia uma FOTO/PNG/PDF-rasterizado da planta,
// ela vira um fundo de referência, e ele desenha as paredes, marca
// portas/janelas e define a escala real. A saída tem o MESMO formato que o
// modelo produz ({canvas_size, content_rect, polygons:{wall,door,window},
// input_image_b64}), então alimenta o Visualizador 360 e o QB5D sem mudar
// mais nada. A calibração métrica já sai pronta (o editor sabe px→m).
// =====================================================================

import { setByScale100 } from "./calibration.js";
import { detectFromImage } from "./detect.js";

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};

const S = {
  img: null, imgW: 0, imgH: 0, imgB64: "",
  walls: [],      // { a:{x,y}, b:{x,y} }  em px da imagem
  openings: [],   // { wall:index, t:0..1, width_px, kind:'door'|'window' }
  wallThickness_cm: 15,
  openingWidth_cm: 90,
  pxPerM: null,    // escala
  tool: "wall",
  draft: [],       // pontos da polilinha em construção
  scalePts: [],
  view: { zoom: 1, ox: 0, oy: 0 },
  hover: null,
  planName: "Planta traçada",
};

let canvas, ctx, dpr = 1, screenEl, statusEl, toolBtns = {};

// ---------- geometria ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segParam(p, a, b) {
  const ab = sub(b, a), l2 = ab.x * ab.x + ab.y * ab.y || 1e-9;
  return ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
}
function segDist(p, a, b) {
  const t = Math.max(0, Math.min(1, segParam(p, a, b)));
  return dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}

// ---------- transform tela <-> imagem ----------
const toScreen = (p) => ({ x: (p.x - S.view.ox) * S.view.zoom, y: (p.y - S.view.oy) * S.view.zoom });
const toImage = (sx, sy) => ({ x: sx / S.view.zoom + S.view.ox, y: sy / S.view.zoom + S.view.oy });

function fitView() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h || !S.imgW) return;
  const z = Math.min(w / S.imgW, h / S.imgH) * 0.92;
  S.view.zoom = z;
  S.view.ox = S.imgW / 2 - w / (2 * z);
  S.view.oy = S.imgH / 2 - h / (2 * z);
}

// ---------- estilo + tela ----------
function injectStyle() {
  if (document.getElementById("trace-style")) return;
  document.head.append(el("style", { id: "trace-style", html: `
    #screen-trace canvas#trace-canvas{position:fixed;inset:0;top:56px;display:block;background:#10131c;cursor:crosshair}
    #trace-tools{position:fixed;left:16px;top:72px;z-index:20;display:flex;flex-direction:column;gap:8px;
      background:rgba(15,21,38,.9);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);
      border-radius:14px;padding:12px;color:#fff;max-width:230px}
    #trace-tools .trow{display:flex;gap:6px;flex-wrap:wrap}
    #trace-tools button{font:inherit;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,.16);
      background:rgba(255,255,255,.06);color:#fff;border-radius:8px;padding:7px 10px;cursor:pointer}
    #trace-tools button:hover{background:rgba(255,255,255,.14)}
    #trace-tools button.on{background:#3b82f6;border-color:#3b82f6}
    #trace-tools .prim{background:linear-gradient(135deg,#10b981,#047857);border:none;width:100%}
    #trace-tools label{font-size:11px;color:rgba(255,255,255,.6);display:flex;align-items:center;gap:6px;justify-content:space-between}
    #trace-tools input{width:64px;font:inherit;font-size:12px;padding:5px 7px;border-radius:7px;
      border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#fff}
    #trace-tools .hint{font-size:10.5px;color:rgba(255,255,255,.5);line-height:1.4}
    #trace-status{position:fixed;right:16px;top:72px;z-index:20;background:rgba(15,21,38,.9);
      border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 12px;color:#fff;font-size:11.5px}
  ` }));
}

function ensureScreen() {
  injectStyle();
  if (document.getElementById("screen-trace")) return;

  canvas = el("canvas", { id: "trace-canvas" });
  statusEl = el("div", { id: "trace-status" }, "Envie uma imagem para começar.");

  const mkToolBtn = (id, label) => {
    const b = el("button", { onclick: () => setTool(id) }, label);
    toolBtns[id] = b;
    return b;
  };
  const thickIn = el("input", { type: "number", value: String(S.wallThickness_cm), min: "5", step: "1",
    onchange: (e) => { S.wallThickness_cm = +e.target.value || 15; } });
  const widthIn = el("input", { type: "number", value: String(S.openingWidth_cm), min: "40", step: "5",
    onchange: (e) => { S.openingWidth_cm = +e.target.value || 90; } });

  const tools = el("div", { id: "trace-tools" },
    el("button", { class: "prim", style: "background:linear-gradient(135deg,#8b5cf6,#6d28d9)", onclick: () => runDetect() },
      "🪄 Detectar paredes"),
    el("div", { class: "trow" },
      mkToolBtn("wall", "Parede"), mkToolBtn("door", "Porta"),
      mkToolBtn("window", "Janela")),
    el("div", { class: "trow" },
      mkToolBtn("scale", "Escala"), mkToolBtn("erase", "Apagar"),
      el("button", { onclick: undo }, "Desfazer")),
    el("label", {}, "Espessura parede (cm)", thickIn),
    el("label", {}, "Largura do vão (cm)", widthIn),
    el("div", { class: "hint" },
      "🪄 detecta as paredes sozinho (planta de traço sólido funciona melhor). " +
      "Parede: clique os cantos, Enter fecha. Vão: clique sobre a parede. " +
      "Escala: 2 pontos de medida conhecida. Botão do meio = mover; roda = zoom."),
    el("button", { class: "prim", onclick: () => exportPlan() }, "Gerar 3D →"));

  const screen = el("div", { class: "screen", id: "screen-trace" },
    el("div", { class: "topbar" },
      el("button", { class: "back-btn", onclick: () => go("screen-home") },
        (() => { const s = document.createElement("span"); s.innerHTML = "&#8592;"; return s; })()),
      el("div", { class: "topbar-titles" },
        el("div", { class: "t1" }, "Traçar Planta"),
        el("div", { class: "t2" }, "Desenhe as paredes sobre a foto")),
      el("div", { class: "topbar-spacer" }),
      el("button", { class: "icon-btn", title: "Trocar imagem", onclick: pickFile }, "🖼")),
    canvas, tools, statusEl);
  document.body.append(screen);
  screenEl = screen;

  ctx = canvas.getContext("2d");
  bindCanvas();
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);
  setTool("wall");
}

function go(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  if (id === "screen-trace") { resize(); fitView(); }
}

function setTool(t) {
  S.tool = t;
  S.draft = []; S.scalePts = [];
  for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle("on", k === t);
  status();
}

function status(msg) {
  const scaleTxt = S.pxPerM ? `escala: 1 m = ${S.pxPerM.toFixed(1)} px` : "escala: NÃO definida";
  statusEl.textContent = msg
    ? msg
    : `${S.walls.length} paredes · ${S.openings.length} vãos · ${scaleTxt}`;
}

// ---------- imagem ----------
function pickFile() {
  const inp = el("input", { type: "file", accept: "image/*", style: "display:none" });
  inp.addEventListener("change", () => { if (inp.files[0]) loadImage(inp.files[0]); });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 1000);
}

function loadImage(file, cb) {
  const rd = new FileReader();
  rd.onload = () => {
    const url = rd.result;
    S.imgB64 = String(url).split(",")[1] || "";
    const im = new Image();
    im.onload = () => {
      S.img = im; S.imgW = im.naturalWidth; S.imgH = im.naturalHeight;
      S.planName = (file.name || "Planta traçada").replace(/\.[^.]+$/, "").slice(0, 40) || "Planta traçada";
      S.walls = []; S.openings = []; S.pxPerM = null; S.draft = []; S.scalePts = [];
      if (canvas) { resize(); fitView(); status(); }
      if (cb) cb(im);
    };
    im.src = url;
  };
  rd.readAsDataURL(file);
}

// Roda a detecção automática sobre a imagem atual e carrega as paredes
// encontradas como segmentos editáveis. `scaleImg` = imagem original (usada
// para detectar em resolução maior que a exibida).
function runDetect(imgOverride) {
  // só aceita imgOverride se for um HTMLImageElement de verdade (evita
  // receber o objeto de evento de um onclick)
  const im = (imgOverride instanceof HTMLImageElement) ? imgOverride : S.img;
  if (!(im instanceof HTMLImageElement) || !im.naturalWidth) {
    status("Carregando a imagem… tente 'Detectar' de novo em 1s.");
    return null;
  }
  status("Detectando paredes…");
  let res;
  try { res = detectFromImage(im); }
  catch (e) { status("Falha na detecção: " + e.message); return null; }

  // segmentos vêm em px da imagem processada (com downscale) — reescala p/ px da imagem
  const sx = S.imgW / res.canvas_size[0], sy = S.imgH / res.canvas_size[1];
  S.walls = (res.segments || []).map((s) => ({
    a: { x: s.a.x * sx, y: s.a.y * sy },
    b: { x: s.b.x * sx, y: s.b.y * sy },
  }));
  S.openings = [];
  status(`${S.walls.length} paredes detectadas. Confira, marque portas/janelas e defina a escala.`);
  return res;
}

// Registra o resultado do servidor (Gemini) como planta pronta.
function finishServerImport(file, data) {
  const host = window.__QB5D_HOST;
  const key = "ai-" + Date.now().toString(36);
  const name = (file.name || "Planta IA").replace(/\.[^.]+$/, "").slice(0, 40) || "Planta IA";
  const hasScale = !!(data.meters_per_pixel && data.meters_per_pixel > 0);
  (host?.demos || {})[key] = data;
  (host?.planMeta || {})[key] = { name, tag: hasScale ? "IA" : "IA sem escala" };
  (host?.planOrder || []).push(key);
  if (hasScale) { try { setByScale100(key, data.meters_per_pixel * 100); } catch {} }
  try { window.updateHomeBanner && window.updateHomeBanner(); } catch {}
  try { window.renderLibrary && window.renderLibrary(); } catch {}
  try { window.__QB5D_selectPlan && window.__QB5D_selectPlan(key); } catch {}
  if (window.__PLAN_STORE && window.__PLAN_STORE.isEnabled()) {
    window.__PLAN_STORE.savePlan({
      id: key, name, source: "gemini",
      meters_per_pixel: hasScale ? data.meters_per_pixel : null, data,
    }).catch(() => {});
  }
  const nW = (data.polygons.wall || []).length;
  const nD = (data.polygons.door || []).length;
  const nJ = (data.polygons.window || []).length;
  if (window.openViewer) window.openViewer(key); else go("screen-viewer");
  setTimeout(() => {
    const s = hasScale
      ? ` · escala lida das cotas (${(1 / data.meters_per_pixel).toFixed(0)} px/m).`
      : ` · SEM escala visível — abra "Traçar Planta" e use a ferramenta Escala.`;
    window.showToast && window.showToast(`IA: ${nW} paredes, ${nD} portas, ${nJ} janelas${s}`, 8000);
  }, 400);
}

// Fluxo "automático": tenta o Gemini no servidor (lê inclusive a escala das
// cotas); se falhar/servidor fora, cai na detecção local (escala provisória).
export async function autoImportImage(file) {
  ensureScreen();
  if (window.showToast) window.showToast("Analisando a planta com IA (Gemini)…", 90000);
  try {
    const fd = new FormData();
    fd.append("image", file);
    const r = await fetch("/detect-ai", { method: "POST", body: fd });
    if (r.ok) {
      const data = await r.json();
      if ((data.polygons && data.polygons.wall || []).length >= 3) {
        finishServerImport(file, data);
        return;
      }
    } else if (r.status !== 503) {
      const d = await r.json().catch(() => ({}));
      if (window.showToast) {
        window.showToast("IA falhou (" + (d.detail || r.status) + ") — usando detecção local.", 4500);
      }
    }
  } catch { /* servidor fora — fallback local */ }

  // fallback: visão computacional clássica no navegador
  loadImage(file, () => {
    const res = runDetect(S.img);
    const n = res ? (res.polygons.wall || []).length : 0;
    if (n >= 4) {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const w of S.walls) for (const p of [w.a, w.b]) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const spanPx = Math.max(maxX - minX, maxY - minY) || S.imgW;
      S.pxPerM = spanPx / 10;
      exportPlan({ provisional: true });
    } else {
      go("screen-trace");
      if (window.showToast) window.showToast(
        n ? `Detectei ${n} parede(s) — ajuste no editor e defina a escala.`
          : "Não consegui detectar paredes nesta imagem. Desenhe manualmente.", 5500);
    }
  });
}
window.autoImportImage = autoImportImage;

function resize() {
  if (!canvas) return;
  // <canvas> é elemento substituído: `inset:0` não o estica sozinho — é
  // preciso fixar style.width/height explicitamente (o dashboard faz o
  // mesmo via renderer.setSize).
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight - 56);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}

// ---------- input ----------
function bindCanvas() {
  let panning = false, panStart = null, viewStart = null;

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const before = toImage(e.offsetX, e.offsetY);
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    S.view.zoom = Math.max(0.05, Math.min(20, S.view.zoom * f));
    const after = toImage(e.offsetX, e.offsetY);
    S.view.ox += before.x - after.x;
    S.view.oy += before.y - after.y;
  }, { passive: false });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      panning = true; panStart = { x: e.offsetX, y: e.offsetY };
      viewStart = { ox: S.view.ox, oy: S.view.oy };
      return;
    }
    if (e.button !== 0 || !S.img) return;
    const p = snap(toImage(e.offsetX, e.offsetY));
    handleClick(p);
  });
  canvas.addEventListener("mousemove", (e) => {
    S.hover = S.img ? toImage(e.offsetX, e.offsetY) : null;
    if (panning) {
      S.view.ox = viewStart.ox - (e.offsetX - panStart.x) / S.view.zoom;
      S.view.oy = viewStart.oy - (e.offsetY - panStart.y) / S.view.zoom;
    }
  });
  window.addEventListener("mouseup", () => { panning = false; });
  canvas.addEventListener("dblclick", () => finishWall());
  window.addEventListener("keydown", (e) => {
    if (!screenEl?.classList.contains("active")) return;
    if (e.key === "Enter") finishWall();
    else if (e.key === "Escape") { S.draft = []; S.scalePts = []; status(); }
    else if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
  });
}

function snap(p) {
  const r = 12 / S.view.zoom;
  let best = null, bd = r;
  for (const w of S.walls) for (const q of [w.a, w.b]) {
    const d = dist(p, q); if (d < bd) { bd = d; best = q; }
  }
  return best ? { x: best.x, y: best.y } : p;
}

function handleClick(p) {
  if (S.tool === "wall") {
    S.draft.push(p);
  } else if (S.tool === "scale") {
    S.scalePts.push(p);
    if (S.scalePts.length === 2) {
      const px = dist(S.scalePts[0], S.scalePts[1]);
      const m = parseFloat(prompt("Distância real entre os 2 pontos, em metros:", "3"));
      if (m > 0) { S.pxPerM = px / m; status(`Escala definida: 1 m = ${S.pxPerM.toFixed(1)} px`); }
      S.scalePts = [];
    }
  } else if (S.tool === "door" || S.tool === "window") {
    let wi = -1, bd = 18 / S.view.zoom;
    S.walls.forEach((w, i) => { const d = segDist(p, w.a, w.b); if (d < bd) { bd = d; wi = i; } });
    if (wi < 0) { status("Clique mais perto de uma parede."); return; }
    const w = S.walls[wi];
    const t = Math.max(0.02, Math.min(0.98, segParam(p, w.a, w.b)));
    const width_px = S.pxPerM ? (S.openingWidth_cm / 100) * S.pxPerM : Math.max(20, dist(w.a, w.b) * 0.15);
    S.openings.push({ wall: wi, t, width_px, kind: S.tool });
    status();
  } else if (S.tool === "erase") {
    let oi = -1, od = 14 / S.view.zoom;
    S.openings.forEach((o, i) => {
      const w = S.walls[o.wall]; if (!w) return;
      const c = { x: w.a.x + (w.b.x - w.a.x) * o.t, y: w.a.y + (w.b.y - w.a.y) * o.t };
      const d = dist(p, c); if (d < od) { od = d; oi = i; }
    });
    if (oi >= 0) { S.openings.splice(oi, 1); status(); return; }
    let wi = -1, wd = 12 / S.view.zoom;
    S.walls.forEach((w, i) => { const d = segDist(p, w.a, w.b); if (d < wd) { wd = d; wi = i; } });
    if (wi >= 0) {
      S.walls.splice(wi, 1);
      S.openings = S.openings.filter((o) => o.wall !== wi).map((o) => ({ ...o, wall: o.wall > wi ? o.wall - 1 : o.wall }));
      status();
    }
  }
}

function finishWall() {
  if (S.tool !== "wall" || S.draft.length < 2) { S.draft = []; return; }
  for (let i = 0; i < S.draft.length - 1; i++) {
    if (dist(S.draft[i], S.draft[i + 1]) > 2) S.walls.push({ a: S.draft[i], b: S.draft[i + 1] });
  }
  S.draft = [];
  status();
}

function undo() {
  if (S.draft.length) S.draft.pop();
  else if (S.openings.length) S.openings.pop();
  else if (S.walls.length) S.walls.pop();
  status();
}

// ---------- desenho ----------
function loop() {
  if (screenEl && screenEl.classList.contains("active") && ctx) draw();
  requestAnimationFrame(loop);
}
function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.scale(dpr, dpr);

  if (S.img) {
    const o = toScreen({ x: 0, y: 0 });
    ctx.globalAlpha = 0.85;
    ctx.drawImage(S.img, o.x, o.y, S.imgW * S.view.zoom, S.imgH * S.view.zoom);
    ctx.globalAlpha = 1;
  }

  const thpx = S.pxPerM ? (S.wallThickness_cm / 100) * S.pxPerM * S.view.zoom : 6;

  // paredes
  for (const wl of S.walls) {
    const a = toScreen(wl.a), b = toScreen(wl.b);
    ctx.strokeStyle = "rgba(59,130,246,.9)";
    ctx.lineWidth = Math.max(3, thpx);
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    for (const q of [a, b]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 7); ctx.fill();
    }
  }
  // vãos
  for (const op of S.openings) {
    const wl = S.walls[op.wall]; if (!wl) continue;
    const dir = norm(sub(wl.b, wl.a));
    const c = { x: wl.a.x + (wl.b.x - wl.a.x) * op.t, y: wl.a.y + (wl.b.y - wl.a.y) * op.t };
    const half = op.width_px / 2;
    const p1 = toScreen({ x: c.x - dir.x * half, y: c.y - dir.y * half });
    const p2 = toScreen({ x: c.x + dir.x * half, y: c.y + dir.y * half });
    ctx.strokeStyle = op.kind === "door" ? "#f59e0b" : "#22d3ee";
    ctx.lineWidth = Math.max(4, thpx + 2);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  // rascunho de parede
  if (S.tool === "wall" && S.draft.length) {
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    S.draft.forEach((p, i) => { const s = toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (S.hover) { const s = toScreen(S.hover); ctx.lineTo(s.x, s.y); }
    ctx.stroke(); ctx.setLineDash([]);
    for (const p of S.draft) {
      const s = toScreen(p); ctx.fillStyle = "#3b82f6";
      ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill();
    }
  }
  // escala
  if (S.tool === "scale" && S.scalePts.length === 1 && S.hover) {
    const a = toScreen(S.scalePts[0]), b = toScreen(S.hover);
    ctx.strokeStyle = "#10b981"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

// ---------- export -> schema do modelo ----------
function exportPlan(opts = {}) {
  const provisional = opts && opts.provisional === true;
  if (!S.img) return status("Envie uma imagem primeiro.");
  finishWall();
  if (!S.walls.length) return status("Desenhe pelo menos uma parede.");
  if (!S.pxPerM) return status("Defina a escala (ferramenta Escala) antes de gerar.");

  const thpx = (S.wallThickness_cm / 100) * S.pxPerM;
  const half = thpx / 2;
  const rect = (a, b, hw, ht) => {
    const d = norm(sub(b, a)), p = { x: -d.y, y: d.x };
    const A = { x: a.x - d.x * hw, y: a.y - d.y * hw };
    const B = { x: b.x + d.x * hw, y: b.y + d.y * hw };
    return [
      [A.x + p.x * ht, A.y + p.y * ht], [B.x + p.x * ht, B.y + p.y * ht],
      [B.x - p.x * ht, B.y - p.y * ht], [A.x - p.x * ht, A.y - p.y * ht],
    ];
  };

  const wall = S.walls.map((w) => ({ outer: rect(w.a, w.b, 0, half), holes: [] }));
  const door = [], windowP = [];
  for (const op of S.openings) {
    const w = S.walls[op.wall]; if (!w) continue;
    const dir = norm(sub(w.b, w.a));
    const c = { x: w.a.x + (w.b.x - w.a.x) * op.t, y: w.a.y + (w.b.y - w.a.y) * op.t };
    const hw = op.width_px / 2;
    const a = { x: c.x - dir.x * hw, y: c.y - dir.y * hw };
    const b = { x: c.x + dir.x * hw, y: c.y + dir.y * hw };
    (op.kind === "door" ? door : windowP).push({ outer: rect(a, b, 0, half), holes: [] });
  }

  const data = {
    canvas_size: [S.imgW, S.imgH],
    content_rect: [0, 0, S.imgW, S.imgH],
    polygons: { wall, door, window: windowP },
    input_image_b64: S.imgB64,
  };

  const host = window.__QB5D_HOST;
  const key = (provisional ? "det-" : "tr-") + Date.now().toString(36);
  const name = S.planName || "Planta traçada";
  (host?.demos || {})[key] = data;
  (host?.planMeta || {})[key] = { name, tag: provisional ? "Auto" : "Traçada" };
  (host?.planOrder || []).push(key);

  // calibração métrica: real (traçado) ou provisória (auto-detecção)
  try { setByScale100(key, 100 / S.pxPerM); } catch { /* storage indisponível */ }

  try { window.updateHomeBanner && window.updateHomeBanner(); } catch {}
  try { window.renderLibrary && window.renderLibrary(); } catch {}
  try { window.__QB5D_selectPlan && window.__QB5D_selectPlan(key); } catch {}

  // salva no Supabase (best effort — não bloqueia o fluxo se falhar)
  if (window.__PLAN_STORE && window.__PLAN_STORE.isEnabled()) {
    window.__PLAN_STORE.savePlan({
      id: key, name, source: provisional ? "detect" : "trace",
      meters_per_pixel: 1 / S.pxPerM, data,
    }).catch((e) => window.showToast && window.showToast("Não salvei no Supabase: " + e.message, 5000));
  }

  status(`"${name}" gerada: ${wall.length} paredes, ${door.length} portas, ${windowP.length} janelas.`);
  if (window.openViewer) window.openViewer(key);
  else go("screen-viewer");
  setTimeout(() => {
    const msg = provisional
      ? `"${name}": paredes detectadas automaticamente. ESCALA PROVISÓRIA (~10 m) — abra "Traçar Planta" e use a ferramenta Escala para acertar as medidas.`
      : `"${name}" pronta no 3D. Abra "Estruturação QB5D" para materiais e obra 4D (a escala já foi salva).`;
    window.showToast && window.showToast(msg, 7000);
  }, 400);
}

// ---------- API ----------
export function openTraceEditor(file) {
  ensureScreen();
  go("screen-trace");
  if (file) {
    // auto-detecta as paredes assim que a imagem carrega
    loadImage(file, () => { runDetect(S.img); });
  } else if (!S.img) {
    pickFile();
  }
}
window.openTraceEditor = openTraceEditor;
