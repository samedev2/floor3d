// ============================================
// QB5D — Acabamento
// Contrapiso por ambiente, chapisco+reboco nas faces das paredes
// (recortado pelos vãos), esquadrias (portas/janelas) e forro opcional.
// ============================================

import { FINISH } from './standards';
import type { QB5DElement, QB5DOpening, QB5DPlan, Vec3 } from './types';
import { alongWall, makeElement } from './util';

interface Interval {
  a: number;
  b: number;
}

function splitFullHeight(length: number, openings: QB5DOpening[]): Interval[] {
  let segs: Interval[] = [{ a: 0, b: length }];
  for (const op of openings) {
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

export function buildFinishes(
  plan: QB5DPlan,
  baseWallY: number,
  opts: { mostrarPintura?: boolean } = {}
): QB5DElement[] {
  const elements: QB5DElement[] = [];
  const startY = Math.max(0, baseWallY);
  const topY = plan.peDireito;
  const wallH = topY - startY;
  const revEff = FINISH.chapisco + FINISH.rebocoExterno;

  // ---- Contrapiso por ambiente ----
  for (const r of plan.rooms) {
    if (r.polygon.length < 3) continue;
    const xs = r.polygon.map((p) => p.x);
    const zs = r.polygon.map((p) => p.z);
    const w = Math.max(...xs) - Math.min(...xs);
    const d = Math.max(...zs) - Math.min(...zs);
    if (w < 0.3 || d < 0.3) continue;
    const size: Vec3 = [w, FINISH.contrapiso, d];
    elements.push(
      makeElement({
        kind: 'contrapiso',
        phase: 'contrapiso',
        position: [(Math.max(...xs) + Math.min(...xs)) / 2, startY + FINISH.contrapiso / 2, (Math.max(...zs) + Math.min(...zs)) / 2],
        size,
        material: 'ceramica',
        anchor: 'base',
        meta: { roomId: r.id, label: `Contrapiso — ${r.name}` },
        qty: { contrapiso_m2: r.area },
      })
    );
  }

  // ---- Reboco (chapisco embutido no quantitativo) nas duas faces ----
  for (const w of plan.walls) {
    const faceThick = w.thickness + revEff * 2;
    const segs = splitFullHeight(w.length, w.openings);
    for (const s of segs) {
      const segLen = s.b - s.a;
      if (segLen < 0.1) continue;
      const pos = alongWall(w.start, w.angle, (s.a + s.b) / 2);
      const face = segLen * wallH;
      const size: Vec3 = [segLen, wallH, faceThick];
      elements.push(
        makeElement({
          kind: 'reboco',
          phase: 'revestimento',
          position: [pos.x, startY + wallH / 2, pos.z],
          rotation: [0, -w.angle, 0],
          size,
          material: 'argamassa',
          anchor: 'center',
          meta: { wallId: w.id, isExterior: w.isExterior, label: 'Chapisco + reboco' },
          qty: revestQty(w.isExterior, face),
        })
      );
    }
    // faixas acima (e abaixo, p/ janela) dos vãos
    for (const op of w.openings) {
      const pos = alongWall(w.start, w.angle, op.offset);
      const voidLo = op.type === 'door' ? startY : startY + op.sill;
      const voidHi = voidLo + op.height;
      const upperH = topY - voidHi;
      if (upperH > 0.1) {
        const face = op.width * upperH;
        elements.push(
          makeElement({
            kind: 'reboco',
            phase: 'revestimento',
            position: [pos.x, voidHi + upperH / 2, pos.z],
            rotation: [0, -w.angle, 0],
            size: [op.width, upperH, w.thickness + revEff * 2] as Vec3,
            material: 'argamassa',
            anchor: 'center',
            meta: { wallId: w.id, openingId: op.id, label: 'Reboco — verga' },
            qty: revestQty(w.isExterior, face),
          })
        );
      }
      if (op.type === 'window' && op.sill > 0.2) {
        const face = op.width * op.sill;
        elements.push(
          makeElement({
            kind: 'reboco',
            phase: 'revestimento',
            position: [pos.x, startY + op.sill / 2, pos.z],
            rotation: [0, -w.angle, 0],
            size: [op.width, op.sill, w.thickness + revEff * 2] as Vec3,
            material: 'argamassa',
            anchor: 'center',
            meta: { wallId: w.id, openingId: op.id, label: 'Reboco — peitoril' },
            qty: revestQty(w.isExterior, face),
          })
        );
      }
    }
  }

  // ---- Esquadrias ----
  for (const w of plan.walls) {
    for (const op of w.openings) {
      const pos = alongWall(w.start, w.angle, op.offset);
      if (op.type === 'door') {
        elements.push(
          makeElement({
            kind: 'porta',
            phase: 'esquadrias',
            position: [pos.x, startY + op.height / 2, pos.z],
            rotation: [0, -w.angle, 0],
            size: [op.width, op.height, 0.06] as Vec3,
            material: 'madeira',
            anchor: 'base',
            meta: { wallId: w.id, openingId: op.id, label: 'Porta' },
            qty: { porta_un: 1, esquadria_m2: op.width * op.height },
          })
        );
      } else {
        elements.push(
          makeElement({
            kind: 'janela',
            phase: 'esquadrias',
            position: [pos.x, startY + op.sill + op.height / 2, pos.z],
            rotation: [0, -w.angle, 0],
            size: [op.width, op.height, 0.08] as Vec3,
            material: 'vidro',
            anchor: 'center',
            meta: { wallId: w.id, openingId: op.id, label: 'Janela' },
            qty: { janela_un: 1, esquadria_m2: op.width * op.height },
          })
        );
      }
    }
  }

  // ---- Forro (opcional) ----
  if (opts.mostrarPintura) {
    for (const r of plan.rooms) {
      if (r.polygon.length < 3) continue;
      const xs = r.polygon.map((p) => p.x);
      const zs = r.polygon.map((p) => p.z);
      const w = Math.max(...xs) - Math.min(...xs);
      const d = Math.max(...zs) - Math.min(...zs);
      if (w < 0.3 || d < 0.3) continue;
      elements.push(
        makeElement({
          kind: 'forro',
          phase: 'pintura',
          position: [
            (Math.max(...xs) + Math.min(...xs)) / 2,
            topY - FINISH.forro / 2,
            (Math.max(...zs) + Math.min(...zs)) / 2,
          ],
          size: [w, FINISH.forro, d] as Vec3,
          material: 'gesso',
          anchor: 'top',
          meta: { roomId: r.id, label: `Forro — ${r.name}` },
          qty: {},
        })
      );
    }
  }

  return elements;

  function revestQty(isExterior: boolean, face: number) {
    return isExterior
      ? { revest_ext_m2: face, revest_int_m2: face, argamassa_revest_m3: face * (FINISH.rebocoExterno + FINISH.rebocoInterno + FINISH.chapisco * 2) }
      : { revest_int_m2: face * 2, argamassa_revest_m3: face * 2 * (FINISH.rebocoInterno + FINISH.chapisco) };
  }
}
