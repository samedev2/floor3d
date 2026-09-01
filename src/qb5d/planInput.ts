// ============================================
// QB5D — Normalização do plano de entrada
// Converte a saída do funil (GeminiFloorPlan) — ou um StructuralPlan de
// demonstração — para o QB5DPlan que o pipeline consome. Centra tudo na
// origem, calcula ângulos/perímetro/área e sintetiza aberturas quando a
// fonte não traz portas/janelas.
// ============================================

import type { GeminiFloorPlan } from '../lib/geminiChat';
import type { StructuralPlan } from '../floorplan/structuralIntelligence';
import { PE_DIREITO, OPENING_DEFAULT } from './standards';
import type { QB5DPlan, QB5DWall, QB5DRoom, QB5DOpening } from './types';

interface NormalizeOpts {
  pavimentos?: number;
  peDireito?: number;
  /** cria janelas/portas heurísticas quando a fonte não tem aberturas */
  synthesizeOpenings?: boolean;
}

const uid = (p: string, i: number) => `${p}_${i.toString(36)}`;

function angleOf(sx: number, sz: number, ex: number, ez: number): number {
  return Math.atan2(ez - sz, ex - sx);
}

function lenOf(sx: number, sz: number, ex: number, ez: number): number {
  return Math.hypot(ex - sx, ez - sz);
}

// ---------------------------------------------------------------
// Fonte 1: GeminiFloorPlan (fluxo real do app)
// ---------------------------------------------------------------
export function normalizeGeminiPlan(
  plan: GeminiFloorPlan,
  opts: NormalizeOpts = {}
): QB5DPlan {
  const width = Math.max(1, plan.widthMeters || 6);
  const depth = Math.max(1, plan.heightMeters || 8);
  const cx = width / 2;
  const cz = depth / 2;

  const walls: QB5DWall[] = [];
  plan.walls.forEach((w, i) => {
    const sx = w.start.x - cx;
    const sz = w.start.y - cz;
    const ex = w.end.x - cx;
    const ez = w.end.y - cz;
    const length = lenOf(sx, sz, ex, ez);
    if (length < 0.1) return;
    walls.push({
      id: uid('W', i),
      start: { x: sx, z: sz },
      end: { x: ex, z: ez },
      thickness: w.thickness && w.thickness > 0.05 ? w.thickness : w.type === 'exterior' ? 0.25 : 0.15,
      isExterior: w.type === 'exterior',
      length,
      angle: angleOf(sx, sz, ex, ez),
      openings: [],
    });
  });

  const rooms: QB5DRoom[] = plan.rooms.map((r, i) => {
    const poly = (r.polygon || []).map((p) => ({ x: p.x - cx, z: p.y - cz }));
    const center = poly.length
      ? poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, z: a.z + p.z / poly.length }), { x: 0, z: 0 })
      : { x: 0, z: 0 };
    return {
      id: uid('R', i),
      name: r.name || `Ambiente ${i + 1}`,
      type: r.type || 'unknown',
      polygon: poly,
      area: r.area && r.area > 0 ? r.area : polygonArea(poly),
      center,
    };
  });

  const base = finalize(walls, rooms, width, depth, opts);
  if (opts.synthesizeOpenings !== false) synthesizeOpenings(base);
  return base;
}

// ---------------------------------------------------------------
// Fonte 2: StructuralPlan (demo — já traz aberturas reais)
// ---------------------------------------------------------------
export function normalizeStructuralPlan(plan: StructuralPlan, opts: NormalizeOpts = {}): QB5DPlan {
  const width = plan.totalWidth;
  const depth = plan.totalDepth;
  const cx = width / 2;
  const cz = depth / 2;
  const vmap = new Map(plan.vertices.map((v) => [v.id, v]));

  const walls: QB5DWall[] = [];
  plan.walls.forEach((w, i) => {
    const a = vmap.get(w.startVertexId);
    const b = vmap.get(w.endVertexId);
    if (!a || !b) return;
    const sx = a.x - cx;
    const sz = a.y - cz;
    const ex = b.x - cx;
    const ez = b.y - cz;
    const length = lenOf(sx, sz, ex, ez);
    if (length < 0.1) return;
    const openings: QB5DOpening[] = [];
    if (w.hasOpening) {
      const isDoor = w.hasOpening === 'door';
      openings.push({
        id: uid(`${w.id}_op`, i),
        type: isDoor ? 'door' : 'window',
        offset: length / 2,
        width: w.openingWidth || (isDoor ? OPENING_DEFAULT.door.width : OPENING_DEFAULT.window.width),
        height: isDoor ? OPENING_DEFAULT.door.height : OPENING_DEFAULT.window.height,
        sill: isDoor ? 0 : OPENING_DEFAULT.window.sill,
      });
    }
    walls.push({
      id: w.id,
      start: { x: sx, z: sz },
      end: { x: ex, z: ez },
      thickness: w.thickness,
      isExterior: w.type === 'exterior',
      length,
      angle: angleOf(sx, sz, ex, ez),
      openings,
    });
  });

  const rooms: QB5DRoom[] = plan.rooms.map((r) => {
    const poly = r.floor.map((p) => ({ x: p.x - cx, z: p.y - cz }));
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      polygon: poly,
      area: r.area || polygonArea(poly),
      center: { x: r.center.x - cx, z: r.center.y - cz },
    };
  });

  return finalize(walls, rooms, width, depth, { ...opts, pavimentos: opts.pavimentos ?? plan.floors });
}

// ---------------------------------------------------------------
// Comum
// ---------------------------------------------------------------
function finalize(
  walls: QB5DWall[],
  rooms: QB5DRoom[],
  width: number,
  depth: number,
  opts: NormalizeOpts
): QB5DPlan {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.start.x, w.end.x);
    maxX = Math.max(maxX, w.start.x, w.end.x);
    minZ = Math.min(minZ, w.start.z, w.end.z);
    maxZ = Math.max(maxZ, w.start.z, w.end.z);
  }
  if (!isFinite(minX)) {
    minX = -width / 2;
    maxX = width / 2;
    minZ = -depth / 2;
    maxZ = depth / 2;
  }

  const perimetro = walls.filter((w) => w.isExterior).reduce((s, w) => s + w.length, 0) ||
    2 * (maxX - minX) + 2 * (maxZ - minZ);
  const area = rooms.reduce((s, r) => s + (r.area || 0), 0) || (maxX - minX) * (maxZ - minZ);

  return {
    walls,
    rooms,
    width,
    depth,
    peDireito: opts.peDireito ?? PE_DIREITO,
    pavimentos: Math.max(1, opts.pavimentos ?? 1),
    area,
    perimetro,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/** área de polígono (shoelace) no plano XZ */
export function polygonArea(poly: { x: number; z: number }[]): number {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

// ---------------------------------------------------------------
// Síntese de aberturas quando a fonte não traz portas/janelas.
// Regras: cada parede externa com > 2.2m ganha 1 janela centrada; a
// parede externa mais ao sul (menor z médio) ganha 1 porta de entrada
// no lugar da janela; cada parede interna > 1.3m ganha 1 porta a ~0.7m
// de uma extremidade.
// ---------------------------------------------------------------
function synthesizeOpenings(plan: QB5DPlan): void {
  const ext = plan.walls.filter((w) => w.isExterior);
  let frontWall: QB5DWall | null = null;
  let frontZ = Infinity;
  for (const w of ext) {
    const mz = (w.start.z + w.end.z) / 2;
    if (mz < frontZ) {
      frontZ = mz;
      frontWall = w;
    }
  }

  plan.walls.forEach((w, i) => {
    if (w.isExterior) {
      if (w.length < 2.2) return;
      if (w === frontWall) {
        w.openings.push({
          id: uid(`${w.id}_door`, i),
          type: 'door',
          offset: w.length / 2,
          ...OPENING_DEFAULT.doorExterior,
        });
      } else {
        w.openings.push({
          id: uid(`${w.id}_win`, i),
          type: 'window',
          offset: w.length / 2,
          width: Math.min(OPENING_DEFAULT.window.width, w.length - 1),
          height: OPENING_DEFAULT.window.height,
          sill: OPENING_DEFAULT.window.sill,
        });
      }
    } else {
      if (w.length < 1.3) return;
      w.openings.push({
        id: uid(`${w.id}_door`, i),
        type: 'door',
        offset: Math.min(0.7 + OPENING_DEFAULT.door.width / 2, w.length - 0.5),
        ...OPENING_DEFAULT.door,
      });
    }
  });
}
