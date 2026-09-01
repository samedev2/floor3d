// =====================================================================
// QB5D — structure.js
// Gera os elementos de ANTEPROJETO (concreto armado + alvenaria de vedação)
// a partir da topologia + parâmetros NBR + escala métrica.
//
// Convenção: geometria em pixels (x,y image-space); alturas/cotas em METROS.
// Cada elemento traz seu próprio quantitativo (m³, m², kg) já em métrico.
// NÃO é cálculo estrutural — é coordenação de geometria/sequência/QTO.
// =====================================================================

import { BLOCK_PRESETS } from "./params.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
function perimeter(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

const ZERO_Q = () => ({
  concreto_m3: 0, forma_m2: 0, aco_kg: 0,
  alvenaria_m2: 0, blocos: 0, argamassa_m3: 0, chapisco_m2: 0, reboco_m2: 0,
  escavacao_m3: 0, magro_m3: 0,
});
function addQ(dst, src) { for (const k in src) dst[k] = (dst[k] || 0) + src[k]; return dst; }

// =====================================================================
export function generateStructure(topo, params, metersPerPixel) {
  const mpp = metersPerPixel;
  const M = (px) => px * mpp;                 // pixels -> metros
  const els = [];
  let seq = 0;
  const add = (e) => { e.seqIndex = seq++; els.push(e); return e; };

  const preset = BLOCK_PRESETS[params.alvenaria.presetPadrao] || BLOCK_PRESETS.ceramico9;
  const blkEsp_m = preset.esp_cm / 100;
  const revEsp_m = (params.alvenaria.rebocoInterno_cm + params.alvenaria.rebocoExterno_cm) / 100;

  // ---- métricas gerais ----
  const footOutline0 = (topo.footprintPoly && topo.footprintPoly.length >= 3)
    ? topo.footprintPoly.map((p) => (Array.isArray(p) ? p : [p.x, p.y]))
    : [
        [topo.bbox.minX, topo.bbox.minY], [topo.bbox.maxX, topo.bbox.minY],
        [topo.bbox.maxX, topo.bbox.maxY], [topo.bbox.minX, topo.bbox.maxY],
      ];
  const areaConstruida_m2 = topo.footprintArea_px * mpp * mpp;
  const perimetro_m = M(perimeter(footOutline0));
  const vaos = topo.rooms.map((r) => M(r.span_max_px));
  const maxVao_m = vaos.length ? Math.max(...vaos) : M(topo.bbox.maxX - topo.bbox.minX);
  const wallLen_m = topo.walls.reduce((s, w) => s + M(w.length_px), 0);

  // ---- 1. Fundação (auto pelo porte) ----
  const F = params.fundacao;
  let fundacaoTipo = F.modo;
  if (F.modo === "auto") {
    if (areaConstruida_m2 <= F.radier_areaMax_m2 && maxVao_m <= 6) fundacaoTipo = "radier";
    else if (areaConstruida_m2 <= F.sapataCorrida_areaMax_m2) fundacaoTipo = "sapata_corrida";
    else if (areaConstruida_m2 <= F.sapataIsolada_areaMax_m2) fundacaoTipo = "sapata_isolada";
    else fundacaoTipo = "estaca";
  }

  const footOutline = footOutline0;

  // lastro de concreto magro sob toda a projeção
  const magro_h = F.lastroConcretoMagro_cm / 100;
  add({
    id: "LASTRO", type: "lastro", layer: "lastro", shape: "poly",
    outline: footOutline, base_m: params.fundacao_base_m ?? -0.35 - magro_h, height_m: magro_h,
    material: "magro", dims_cm: { esp: F.lastroConcretoMagro_cm },
    quantities: (() => {
      const q = ZERO_Q();
      q.magro_m3 = areaConstruida_m2 * magro_h;
      q.escavacao_m3 = areaConstruida_m2 * (0.2); // rebaixo médio p/ preparo
      return q;
    })(),
  });

  const fundTop_m = -0.05; // face superior da fundação ~ logo abaixo da cota 0

  if (fundacaoTipo === "radier") {
    const h = F.radier_espessura_cm / 100;
    add({
      id: "RAD1", type: "radier", layer: "fundacao", shape: "poly",
      outline: footOutline, base_m: fundTop_m - h, height_m: h, material: "concreto",
      dims_cm: { esp: F.radier_espessura_cm },
      quantities: (() => {
        const q = ZERO_Q();
        q.concreto_m3 = areaConstruida_m2 * h;
        q.forma_m2 = perimetro_m * h;
        q.aco_kg = q.concreto_m3 * params.laje.taxaAco_kg_por_m3;
        q.escavacao_m3 = areaConstruida_m2 * (h + F.folgaEscavacao_m);
        return q;
      })(),
    });
  } else if (fundacaoTipo === "sapata_corrida") {
    const bw = F.sapataCorrida_largura_cm / 100, bh = F.sapataCorrida_altura_cm / 100;
    for (const wall of topo.walls) {
      const L = M(wall.length_px);
      add(boxAlong(wall, wall.length_px, F.sapataCorrida_largura_cm / 100 / mpp, fundTop_m - bh, bh, {
        id: `SC-${wall.id}`, type: "sapata_corrida", layer: "fundacao", material: "concreto",
        dims_cm: { b: F.sapataCorrida_largura_cm, h: F.sapataCorrida_altura_cm },
        quantities: sapataLinearQ(L, bw, bh, F, params),
      }, mpp));
    }
  } else if (fundacaoTipo === "sapata_isolada" || fundacaoTipo === "estaca") {
    // gerado junto com os pilares (precisa das posições) — ver abaixo
  }

  // ---- 2. Vigas baldrame (não em radier) — segue TODO o traçado de parede ----
  if (fundacaoTipo !== "radier") {
    const bw = params.viga.larguraPadrao_cm / 100;
    const bh = params.viga.baldrameAltura_cm / 100;
    for (const wall of topo.rawCenterlines) {
      const L = M(wall.length_px);
      add(boxAlong(wall, wall.length_px, bw / mpp, params.viga.baldrameCota_m - bh, bh, {
        id: `VB-${wall.id}`, type: "baldrame", layer: "baldrame", material: "concreto",
        dims_cm: { b: params.viga.larguraPadrao_cm, h: params.viga.baldrameAltura_cm },
        quantities: beamQ(L, bw, bh, params.viga.taxaAco_kg_por_m3),
      }, mpp));
    }
  }

  // ---- 3. Pilares (posições) ----
  const espMax = params.pilar.espacamentoMax_m;
  const espMin = params.pilar.espacamentoMin_m;
  const cand = [];
  for (const n of topo.nodes) {
    // junções reais (2+ paredes) viram pilar.
    if (n.degree >= 2) cand.push({ x: n.x, y: n.y, wallId: n.wallIds[0] });
  }
  // grafo esparso (planta grosseira): sem junções suficientes p/ um pórtico,
  // então também usa as pontas de parede como apoio.
  if (cand.length < 4) {
    for (const n of topo.nodes) {
      if (n.degree === 1) cand.push({ x: n.x, y: n.y, wallId: n.wallIds[0] });
    }
  }
  for (const wall of topo.walls) {
    const L = M(wall.length_px);
    if (L <= espMax) continue;
    const nseg = Math.ceil(L / espMax);
    for (let k = 1; k < nseg; k++) {
      const t = k / nseg;
      cand.push({
        x: wall.a.x + (wall.b.x - wall.a.x) * t,
        y: wall.a.y + (wall.b.y - wall.a.y) * t,
        wallId: wall.id,
      });
    }
  }
  // dedupe por distância mínima
  const cols = [];
  for (const c of cand) {
    if (cols.some((o) => Math.hypot(o.x - c.x, o.y - c.y) * mpp < espMin)) continue;
    cols.push(c);
  }
  const nCol = Math.max(cols.length, 1);
  const areaInfl = areaConstruida_m2 / nCol;
  const prof_cm = clamp(
    params.pilar.profundidadeMin_cm + areaInfl * params.pilar.profPorAreaInfluencia_cm_por_m2,
    params.pilar.profundidadeMin_cm, params.pilar.profundidadeMax_cm,
  );
  const larg_cm = clamp(
    Math.max(params.pilar.larguraMin_cm, blkEsp_m * 100 - 1),
    params.pilar.larguraMin_cm, params.pilar.larguraMax_cm,
  );
  const wallById = Object.fromEntries(topo.walls.map((w) => [w.id, w]));

  cols.forEach((c, i) => {
    const wall = wallById[c.wallId] || topo.walls[0];
    const ang = wall ? Math.atan2(wall.dir.y, wall.dir.x) : 0;
    const wPx = (Math.round(prof_cm) / 100) / mpp; // dim maior alinhada à parede
    const dPx = (Math.round(larg_cm) / 100) / mpp;
    const pid = `P${i + 1}`;
    // arranque: fundação -> cota 0
    add({
      id: `${pid}a`, type: "pilar_arranque", layer: "pilar", shape: "box",
      center: { x: c.x, y: c.y }, w_px: wPx, d_px: dPx, angleRad: ang,
      base_m: fundTop_m, height_m: 0 - fundTop_m, material: "concreto",
      dims_cm: { b: Math.round(larg_cm), h: Math.round(prof_cm) },
      quantities: colQ(0 - fundTop_m, larg_cm / 100, prof_cm / 100, params.pilar.taxaAco_kg_por_m3),
    });
    // prumada: cota 0 -> pé-direito
    add({
      id: pid, type: "pilar", layer: "pilar", shape: "box",
      center: { x: c.x, y: c.y }, w_px: wPx, d_px: dPx, angleRad: ang,
      base_m: 0, height_m: params.peDireito_m, material: "concreto",
      dims_cm: { b: Math.round(larg_cm), h: Math.round(prof_cm) },
      quantities: colQ(params.peDireito_m, larg_cm / 100, prof_cm / 100, params.pilar.taxaAco_kg_por_m3),
    });
    c._pid = pid;

    // sapata isolada / estaca sob o pilar
    if (fundacaoTipo === "sapata_isolada") {
      const lado_cm = clamp(
        F.sapataIsolada_ladoMin_cm + areaInfl * F.sapataIsolada_ladoPorCarga_cm_por_m2,
        F.sapataIsolada_ladoMin_cm, F.sapataIsolada_ladoMin_cm * 3,
      );
      const s = lado_cm / 100, sh = F.sapataIsolada_altura_cm / 100;
      add({
        id: `SI-${pid}`, type: "sapata", layer: "fundacao", shape: "box",
        center: { x: c.x, y: c.y }, w_px: s / mpp, d_px: s / mpp, angleRad: 0,
        base_m: fundTop_m - sh, height_m: sh, material: "concreto",
        dims_cm: { lado: Math.round(lado_cm), h: F.sapataIsolada_altura_cm },
        quantities: (() => {
          const q = ZERO_Q();
          q.concreto_m3 = s * s * sh;
          q.forma_m2 = 4 * s * sh;
          q.aco_kg = q.concreto_m3 * params.viga.taxaAco_kg_por_m3;
          q.escavacao_m3 = (s + 2 * F.folgaEscavacao_m) ** 2 * (sh + F.folgaEscavacao_m);
          q.magro_m3 = (s + 0.1) ** 2 * (F.lastroConcretoMagro_cm / 100);
          return q;
        })(),
      });
    } else if (fundacaoTipo === "estaca") {
      const d = F.estaca_diametro_cm / 100, prof = F.estaca_profundidade_m;
      const bl = F.bloco_coroamento_lado_cm / 100, blh = F.bloco_coroamento_altura_cm / 100;
      add({
        id: `EST-${pid}`, type: "estaca", layer: "fundacao", shape: "box",
        center: { x: c.x, y: c.y }, w_px: d / mpp, d_px: d / mpp, angleRad: 0,
        base_m: fundTop_m - blh - prof, height_m: prof, material: "concreto",
        dims_cm: { d: F.estaca_diametro_cm, prof_m: prof },
        quantities: (() => {
          const q = ZERO_Q();
          q.concreto_m3 = Math.PI * (d / 2) ** 2 * prof;
          q.aco_kg = q.concreto_m3 * params.pilar.taxaAco_kg_por_m3;
          q.escavacao_m3 = q.concreto_m3;
          return q;
        })(),
      });
      add({
        id: `BC-${pid}`, type: "bloco", layer: "fundacao", shape: "box",
        center: { x: c.x, y: c.y }, w_px: bl / mpp, d_px: bl / mpp, angleRad: 0,
        base_m: fundTop_m - blh, height_m: blh, material: "concreto",
        dims_cm: { lado: F.bloco_coroamento_lado_cm, h: F.bloco_coroamento_altura_cm },
        quantities: (() => {
          const q = ZERO_Q();
          q.concreto_m3 = bl * bl * blh;
          q.forma_m2 = 4 * bl * blh;
          q.aco_kg = q.concreto_m3 * params.viga.taxaAco_kg_por_m3;
          return q;
        })(),
      });
    }
  });

  // ---- 4. Laje de piso ----
  const pisoH = params.espessuraPiso_m;
  if (fundacaoTipo === "radier") {
    add({
      id: "LP1", type: "laje", layer: "laje_piso", shape: "poly",
      outline: footOutline, base_m: 0 - 0.05, height_m: 0.05, material: "concreto",
      dims_cm: { esp: 5, tipo: "contrapiso" },
      quantities: slabQ(areaConstruida_m2, perimetro_m, 0.05, params.laje.taxaAco_kg_por_m3),
    });
  } else {
    add({
      id: "LP1", type: "laje", layer: "laje_piso", shape: "poly",
      outline: footOutline, base_m: 0 - pisoH, height_m: pisoH, material: "concreto",
      dims_cm: { esp: Math.round(pisoH * 100), tipo: "maciça" },
      quantities: slabQ(areaConstruida_m2, perimetro_m, pisoH, params.laje.taxaAco_kg_por_m3),
    });
  }

  // ---- 5. Alvenaria de vedação ----
  // Um pano por polígono de parede DETECTADO (reproduz todo o traçado da
  // planta, igual ao viewer 360), extrudado até o pé-direito.
  const pd = params.peDireito_m;
  const A = params.alvenaria;
  const hPorta = A.alturaPorta_m;
  const sillJan = A.peitorilJanela_m;
  const hJan = A.alturaJanela_m;

  let avN = 0;
  let vaoAreaTotal_m2 = 0;
  const courseH_m = (0.19 + A.juntaArgamassa_cm / 100);       // fiada de bloco 19 + junta
  const nCourses = Math.max(3, Math.round(pd / courseH_m));    // p/ animação fiada a fiada
  for (const wp of topo.wallPolys) {
    if (!wp.outer || wp.outer.length < 3) continue;
    const per_m = M(perimeter(wp.outer));
    add({
      id: `AV${++avN}`, type: "alvenaria", layer: "alvenaria", shape: "wallpoly",
      outline: wp.outer, holes: wp.holes || [],
      base_m: 0, height_m: pd, material: "alvenaria",
      courses: nCourses,
      brickRepeat: { x: Math.max(1, per_m / 0.9), y: Math.max(1, pd / (courseH_m * 3)) },
      dims_cm: { esp: preset.esp_cm, fiadas: nCourses },
      quantities: masonryQ(per_m / 2, pd, preset, A),
    });
  }

  // 5b. Esquadrias — portas e janelas a partir dos vãos detectados.
  for (const op of topo.openings) {
    const wall = wallById[op.wallId];
    if (!wall) continue;
    const cx = wall.a.x + (wall.b.x - wall.a.x) * op.t;
    const cy = wall.a.y + (wall.b.y - wall.a.y) * op.t;
    const ang = Math.atan2(wall.dir.y, wall.dir.x);
    const w_m = M(op.width_px);
    if (op.kind === "door") {
      vaoAreaTotal_m2 += w_m * hPorta;
      add({
        id: `PT-${op.id}`, type: "porta", layer: "esquadria", shape: "box",
        center: { x: cx, y: cy }, w_px: op.width_px, d_px: (blkEsp_m * 0.5) / mpp, angleRad: ang,
        base_m: 0, height_m: hPorta, material: "esquadria",
        dims_cm: { larg: Math.round(w_m * 100), alt: Math.round(hPorta * 100) },
        quantities: ZERO_Q(),
      });
    } else {
      vaoAreaTotal_m2 += w_m * hJan;
      add({
        id: `JN-${op.id}`, type: "janela", layer: "esquadria", shape: "box",
        center: { x: cx, y: cy }, w_px: op.width_px, d_px: (blkEsp_m * 0.5) / mpp, angleRad: ang,
        base_m: sillJan, height_m: hJan, material: "vidro",
        dims_cm: { larg: Math.round(w_m * 100), alt: Math.round(hJan * 100), peit: Math.round(sillJan * 100) },
        quantities: ZERO_Q(),
      });
    }
  }

  // 5c. Desconto de vãos no quantitativo de alvenaria/revestimento.
  if (vaoAreaTotal_m2 > 0) {
    add({
      id: "VAO-DESC", type: "alvenaria", layer: "alvenaria", shape: "none",
      base_m: 0, height_m: 0, material: "alvenaria",
      dims_cm: { desconto_vaos_m2: r2(vaoAreaTotal_m2) },
      quantities: (() => {
        const q = ZERO_Q();
        q.alvenaria_m2 = -vaoAreaTotal_m2;
        q.blocos = -vaoAreaTotal_m2 * preset.unidPorM2;
        q.argamassa_m3 = -vaoAreaTotal_m2 * preset.argamassaM3PorM2;
        q.chapisco_m2 = -vaoAreaTotal_m2 * 2;
        q.reboco_m2 = -vaoAreaTotal_m2 * 2;
        return q;
      })(),
    });
  }

  // ---- 6. Vergas / contravergas ----
  for (const op of topo.openings) {
    const wall = wallById[op.wallId];
    if (!wall) continue;
    const cx = wall.a.x + (wall.b.x - wall.a.x) * op.t;
    const cy = wall.a.y + (wall.b.y - wall.a.y) * op.t;
    const wPx = op.width_px + 2 * (A.vergaFolga_m / mpp);
    const head = op.kind === "door" ? hPorta : sillJan + hJan;
    const vh = A.vergaAltura_cm / 100;
    add({
      id: `VG-${op.id}`, type: "verga", layer: "verga", shape: "box",
      center: { x: cx, y: cy }, w_px: wPx, d_px: blkEsp_m / mpp,
      angleRad: Math.atan2(wall.dir.y, wall.dir.x),
      base_m: head, height_m: vh, material: "concreto",
      dims_cm: { b: preset.esp_cm, h: A.vergaAltura_cm },
      quantities: beamQ(M(wPx), blkEsp_m, vh, params.viga.taxaAco_kg_por_m3),
    });
    if (op.kind === "window") {
      add({
        id: `CV-${op.id}`, type: "verga", layer: "verga", shape: "box",
        center: { x: cx, y: cy }, w_px: wPx, d_px: blkEsp_m / mpp,
        angleRad: Math.atan2(wall.dir.y, wall.dir.x),
        base_m: sillJan - vh, height_m: vh, material: "concreto",
        dims_cm: { b: preset.esp_cm, h: A.vergaAltura_cm, tipo: "contraverga" },
        quantities: beamQ(M(wPx), blkEsp_m, vh, params.viga.taxaAco_kg_por_m3),
      });
    }
  }

  // ---- 7. Vigas de respaldo / cinta — segue TODO o traçado de parede ----
  const vbw = params.viga.larguraPadrao_cm / 100;
  for (const wall of topo.rawCenterlines) {
    const L_m = M(wall.length_px);
    const vh_cm = clamp(L_m * params.viga.alturaPorVao_ratio * 100,
      params.viga.alturaMin_cm, params.viga.alturaMax_cm);
    const vh = Math.round(vh_cm) / 100;
    add(boxAlong(wall, wall.length_px, vbw / mpp, pd - vh, vh, {
      id: `V-${wall.id}`, type: "viga", layer: "viga", material: "concreto",
      dims_cm: { b: params.viga.larguraPadrao_cm, h: Math.round(vh_cm) },
      quantities: beamQ(L_m, vbw, vh, params.viga.taxaAco_kg_por_m3),
    }, mpp));
  }

  // ---- 8. Laje de cobertura ----
  const cobRatio = params.laje.espessuraPorVao_ratio_cobertura;
  const cob_cm = clamp(maxVao_m * cobRatio * 100, params.laje.espessuraMin_cm, params.laje.espessuraMax_cm);
  const cobH = Math.round(cob_cm) / 100;
  const cobTipo = maxVao_m > params.laje.vaoNervurada_m ? "nervurada" : "maciça";
  add({
    id: "LC1", type: "laje", layer: "laje_cob", shape: "poly",
    outline: footOutline, base_m: pd, height_m: cobH, material: "concreto",
    dims_cm: { esp: Math.round(cob_cm), tipo: cobTipo },
    quantities: (() => {
      const q = slabQ(areaConstruida_m2, perimetro_m, cobH, params.laje.taxaAco_kg_por_m3);
      if (cobTipo === "nervurada") q.concreto_m3 *= 0.62; // vazios das nervuras
      return q;
    })(),
  });

  // ---- 9. Louças e mobília (da IA — só volume visual, sem quantitativo) ----
  const FIXTURE_H = {
    toilet: 0.42, sink: 0.85, kitchen_sink: 0.90, shower: 2.00, bathtub: 0.55,
    stove: 0.90, fridge: 1.70, bed: 0.50, wardrobe: 2.20, table: 0.75,
    sofa: 0.80, stairs: 1.20, water_tank: 1.10, column: pd, other: 0.80,
  };
  (topo.fixtures || []).forEach((f, i) => {
    const wPx = (f.w_px || f.width_px || 30);
    const dPx = (f.d_px || f.depth_px || wPx);
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || wPx <= 0) return;
    add({
      id: `FX${i + 1}`, type: "mobilia", layer: "mobilia", shape: "box",
      center: { x: f.x, y: f.y }, w_px: wPx, d_px: dPx,
      angleRad: ((f.angle_deg || f.rotation_deg || 0) * Math.PI) / 180,
      base_m: 0, height_m: FIXTURE_H[f.type] || 0.8, material: "mobilia",
      dims_cm: { tipo: f.type || "other" },
      quantities: ZERO_Q(),
    });
  });

  // ---- totais ----
  const totals = ZERO_Q();
  for (const e of els) addQ(totals, e.quantities || {});
  for (const k in totals) totals[k] = r2(totals[k]);

  return {
    elements: els,
    summary: {
      area_construida_m2: r2(areaConstruida_m2),
      perimetro_m: r2(perimetro_m),
      comprimento_paredes_m: r2(wallLen_m),
      max_vao_m: r2(maxVao_m),
      pe_direito_m: params.peDireito_m,
      fundacao_tipo: fundacaoTipo,
      n_pilares: cols.length,
      n_vigas: topo.rawCenterlines.length,
      n_panos_alvenaria: avN,
      n_vaos: topo.openings.length,
      n_lajes: 2,
      n_comodos: topo.rooms.length,
      bloco: preset.label,
    },
    totals,
    metersPerPixel: mpp,
  };
}

// ---------- helpers de elemento / quantitativo ----------
function boxAlong(wall, wPx, dPx, base_m, height_m, extra, mpp) {
  const cx = (wall.a.x + wall.b.x) / 2;
  const cy = (wall.a.y + wall.b.y) / 2;
  return {
    shape: "box", center: { x: cx, y: cy },
    w_px: wPx, d_px: dPx, angleRad: Math.atan2(wall.dir.y, wall.dir.x),
    base_m, height_m, ...extra,
  };
}

function colQ(h, b_m, d_m, taxaAco) {
  const q = ZERO_Q();
  q.concreto_m3 = b_m * d_m * h;
  q.forma_m2 = 2 * (b_m + d_m) * h;
  q.aco_kg = q.concreto_m3 * taxaAco;
  return q;
}
function beamQ(L, b_m, h_m, taxaAco) {
  const q = ZERO_Q();
  q.concreto_m3 = b_m * h_m * L;
  q.forma_m2 = (2 * h_m + b_m) * L; // 2 laterais + fundo
  q.aco_kg = q.concreto_m3 * taxaAco;
  return q;
}
function slabQ(area_m2, perim_m, h_m, taxaAco) {
  const q = ZERO_Q();
  q.concreto_m3 = area_m2 * h_m;
  q.forma_m2 = area_m2 + perim_m * h_m; // fundo + bordas
  q.aco_kg = q.concreto_m3 * taxaAco;
  return q;
}
function sapataLinearQ(L, b_m, h_m, F, params) {
  const q = ZERO_Q();
  q.concreto_m3 = b_m * h_m * L;
  q.forma_m2 = 2 * h_m * L;
  q.aco_kg = q.concreto_m3 * params.viga.taxaAco_kg_por_m3;
  q.escavacao_m3 = (b_m + 2 * F.folgaEscavacao_m) * (h_m + F.folgaEscavacao_m) * L;
  q.magro_m3 = (b_m + 0.1) * (F.lastroConcretoMagro_cm / 100) * L;
  return q;
}
function masonryQ(L, h, preset, A) {
  const q = ZERO_Q();
  const area = L * h;
  q.alvenaria_m2 = area;
  q.blocos = area * preset.unidPorM2;
  q.argamassa_m3 = area * preset.argamassaM3PorM2;
  q.chapisco_m2 = area * 2;
  q.reboco_m2 = area * 2;
  return q;
}
