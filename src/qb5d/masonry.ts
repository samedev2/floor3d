// ============================================
// QB5D — Alvenaria de vedação (NBR 15270), fiada a fiada
// Panos entre pilares, assentamento em amarração (junta a prumo alternada),
// vãos vazados por portas/janelas, vergas e contravergas nos vãos.
// Modo LOD: acima de blocoLimit blocos, emite 1 volume sólido por fiada/pano.
// ============================================

import { BLOCK, CONCRETE, BLOCKS_PER_M2 } from './standards';
import type { PillarPoint } from './frame';
import type { QB5DElement, QB5DOpening, QB5DPlan, QB5DWall, Vec3 } from './types';
import { alongWall, concreteQty, makeElement } from './util';

const HALF_PILLAR = CONCRETE.pilar.d / 2; // 0.15

interface Interval {
  a: number;
  b: number;
}

/** intervalos (em param da parede) ocupados por pilares */
function pillarIntervals(wall: QB5DWall, pillars: PillarPoint[]): Interval[] {
  const ux = Math.cos(wall.angle);
  const uz = Math.sin(wall.angle);
  const out: Interval[] = [];
  for (const p of pillars) {
    const dx = p.x - wall.start.x;
    const dz = p.z - wall.start.z;
    const t = dx * ux + dz * uz; // projeção no eixo da parede
    const perp = Math.abs(dx * -uz + dz * ux);
    if (perp > 0.35) continue;
    if (t < -0.3 || t > wall.length + 0.3) continue;
    out.push({ a: t - HALF_PILLAR, b: t + HALF_PILLAR });
  }
  out.sort((m, n) => m.a - n.a);
  // merge
  const merged: Interval[] = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv.a <= last.b + 0.01) last.b = Math.max(last.b, iv.b);
    else merged.push({ ...iv });
  }
  return merged;
}

/** panos livres entre pilares */
function freePanels(wall: QB5DWall, blocked: Interval[]): Interval[] {
  const panels: Interval[] = [];
  let cursor = 0;
  for (const iv of blocked) {
    if (iv.a > cursor + 0.05) panels.push({ a: cursor, b: Math.min(iv.a, wall.length) });
    cursor = Math.max(cursor, iv.b);
  }
  if (cursor < wall.length - 0.05) panels.push({ a: cursor, b: wall.length });
  return panels;
}

/** um vão vazio nesta posição/altura? */
function insideOpening(op: QB5DOpening, param: number, yLo: number, yHi: number, startY: number): boolean {
  if (Math.abs(param - op.offset) > op.width / 2 - 0.02) return false;
  const voidLo = op.type === 'door' ? startY : startY + op.sill;
  const voidHi = voidLo + op.height;
  return yHi > voidLo + 0.02 && yLo < voidHi - 0.02;
}

export interface MasonryResult {
  elements: QB5DElement[];
  fiadas: number;
  blocoCount: number;
  lod: boolean;
}

export function buildMasonry(
  plan: QB5DPlan,
  pillars: PillarPoint[],
  baseWallY: number,
  opts: { blocoLimit?: number } = {}
): MasonryResult {
  const startY = Math.max(0, baseWallY);
  const topY = plan.peDireito; // fundo da viga de respaldo
  const fiadas = Math.max(1, Math.round((topY - startY) / BLOCK.courseHeight));
  const limit = opts.blocoLimit ?? 9000;

  // pré-computa panos por parede + estimativa de blocos
  const perWall = plan.walls.map((w) => {
    const blocked = pillarIntervals(w, pillars);
    const panels = freePanels(w, blocked);
    const mod = w.isExterior ? BLOCK.moduleExt : BLOCK.moduleInt;
    const estUnits = panels.reduce((s, p) => s + Math.ceil((p.b - p.a) / mod), 0) * fiadas;
    return { w, panels, mod, estUnits };
  });
  const estTotal = perWall.reduce((s, x) => s + x.estUnits, 0);
  const lod = estTotal > limit;

  const elements: QB5DElement[] = [];
  let blocoCount = 0;

  for (const { w, panels } of perWall) {
    const thick = w.thickness;
    const unitL: number = w.isExterior ? BLOCK.ext.l : BLOCK.int.l;
    const kind14 = w.isExterior;

    for (let f = 0; f < fiadas; f++) {
      const yLo = startY + f * BLOCK.courseHeight;
      const yc = yLo + BLOCK.h / 2;
      const yHi = yLo + BLOCK.h;
      const oddCourse = f % 2 === 1;

      for (const panel of panels) {
        const pLen = panel.b - panel.a;
        if (pLen < 0.08) continue;

        if (lod) {
          // volume sólido por fiada/pano, recortado pelos vãos
          const segments = splitByOpenings(panel, w.openings, yLo, yHi, startY);
          for (const seg of segments) {
            const segLen = seg.b - seg.a;
            if (segLen < 0.06) continue;
            const cParam = (seg.a + seg.b) / 2;
            const pos = alongWall(w.start, w.angle, cParam);
            const area = segLen * BLOCK.h;
            blocoCount += area * (kind14 ? BLOCKS_PER_M2.ext : BLOCK_PER_M2_INT_SAFE());
            elements.push(
              makeElement({
                kind: 'bloco',
                phase: 'alvenaria',
                position: [pos.x, yc, pos.z],
                rotation: [0, -w.angle, 0],
                size: [segLen, BLOCK.h, thick] as Vec3,
                material: 'bloco_ceramico',
                anchor: 'base',
                meta: { wallId: w.id, fiada: f, isExterior: w.isExterior, label: 'Pano de alvenaria (LOD)' },
                qty: {
                  [kind14 ? 'blocos_14_un' : 'blocos_09_un']:
                    area * (kind14 ? BLOCKS_PER_M2.ext : BLOCK_PER_M2_INT_SAFE()),
                  alvenaria_m2: area,
                },
              })
            );
          }
          continue;
        }

        // --- assentamento bloco a bloco ---
        let x = panel.a;
        let first = true;
        while (x < panel.b - 0.02) {
          let len = unitL;
          let half = false;
          if (first && oddCourse) {
            len = unitL / 2;
            half = true;
          }
          if (panel.b - x < unitL - 0.02) {
            len = Math.max(0.06, panel.b - x);
            half = len <= unitL * 0.6;
          }
          const cParam = x + len / 2;
          const skip = w.openings.some((op) => insideOpening(op, cParam, yLo, yHi, startY));
          if (!skip) {
            const pos = alongWall(w.start, w.angle, cParam);
            blocoCount += 1;
            const qKey = half ? 'meio_bloco_un' : kind14 ? 'blocos_14_un' : 'blocos_09_un';
            elements.push(
              makeElement({
                kind: half ? 'meio_bloco' : 'bloco',
                phase: 'alvenaria',
                position: [pos.x, yc, pos.z],
                rotation: [0, -w.angle, 0],
                size: [len, BLOCK.h, thick] as Vec3,
                material: 'bloco_ceramico',
                anchor: 'base',
                meta: { wallId: w.id, fiada: f, isExterior: w.isExterior },
                qty: { [qKey]: 1, alvenaria_m2: len * BLOCK.h },
              })
            );
          }
          x += len + BLOCK.joint;
          first = false;
        }
      }
    }

    // --- vergas e contravergas ---
    for (const op of w.openings) {
      const len = op.width + CONCRETE.vergaOverlap * 2;
      const pos = alongWall(w.start, w.angle, op.offset);
      const topOfVoid = (op.type === 'door' ? startY : startY + op.sill) + op.height;
      const vSize: Vec3 = [len, CONCRETE.verga.h, thick];
      elements.push(
        makeElement({
          kind: 'verga',
          phase: 'vergas',
          position: [pos.x, topOfVoid + CONCRETE.verga.h / 2, pos.z],
          rotation: [0, -w.angle, 0],
          size: vSize,
          material: 'concreto',
          anchor: 'center',
          meta: { wallId: w.id, openingId: op.id, label: 'Verga 10×10' },
          qty: concreteQty(vSize, 'verga', 3),
        })
      );
      if (op.type === 'window' && op.sill > 0.2) {
        elements.push(
          makeElement({
            kind: 'contraverga',
            phase: 'vergas',
            position: [pos.x, startY + op.sill - CONCRETE.verga.h / 2, pos.z],
            rotation: [0, -w.angle, 0],
            size: vSize,
            material: 'concreto',
            anchor: 'center',
            meta: { wallId: w.id, openingId: op.id, label: 'Contraverga 10×10' },
            qty: concreteQty(vSize, 'verga', 3),
          })
        );
      }
    }
  }

  return { elements, fiadas, blocoCount: Math.round(blocoCount), lod };
}

// blocos/m² para bloco interno 9×19×19 (usa comprimento 19cm)
function BLOCK_PER_M2_INT_SAFE(): number {
  return BLOCKS_PER_M2.int;
}

/** divide um pano em segmentos removendo as faixas de vão nesta fiada */
function splitByOpenings(
  panel: Interval,
  openings: QB5DOpening[],
  yLo: number,
  yHi: number,
  startY: number
): Interval[] {
  let segs: Interval[] = [{ ...panel }];
  for (const op of openings) {
    const voidLo = op.type === 'door' ? startY : startY + op.sill;
    const voidHi = voidLo + op.height;
    if (!(yHi > voidLo + 0.02 && yLo < voidHi - 0.02)) continue;
    const oa = op.offset - op.width / 2;
    const ob = op.offset + op.width / 2;
    const next: Interval[] = [];
    for (const s of segs) {
      if (ob <= s.a || oa >= s.b) {
        next.push(s);
        continue;
      }
      if (oa > s.a) next.push({ a: s.a, b: oa });
      if (ob < s.b) next.push({ a: ob, b: s.b });
    }
    segs = next;
  }
  return segs;
}
