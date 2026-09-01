// ============================================
// QB5D — Fundação (NBR 6122)
// Escolha automática pelo porte:
//   ≥ 2 pavimentos          → sapata isolada sob cada pilar + viga baldrame
//   térreo, área ≤ 60 m²    → radier 12cm sobre lastro
//   térreo, área  > 60 m²   → sapata corrida + viga baldrame
// ============================================

import { FOUNDATION } from './standards';
import type { FoundationType, QB5DElement, QB5DPlan, Vec3 } from './types';
import type { PillarPoint } from './frame';
import { concreteQty, makeElement } from './util';

export function chooseFoundation(plan: QB5DPlan, forced?: FoundationType): FoundationType {
  if (forced) return forced;
  if (plan.pavimentos >= 2) return 'sapata_isolada';
  if (plan.area <= FOUNDATION.areaRadierMax) return 'radier';
  return 'sapata_corrida';
}

export function buildFoundation(
  plan: QB5DPlan,
  pillarPoints: PillarPoint[],
  type: FoundationType
): { elements: QB5DElement[]; baseWallY: number } {
  const elements: QB5DElement[] = [];
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  const pad = 0.25;
  const fw = maxX - minX + pad * 2;
  const fd = maxZ - minZ + pad * 2;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // ---- Lastro de brita (comum a todos, fase "locação") ----
  const lastroSize: Vec3 = [fw, FOUNDATION.lastro, fd];
  elements.push(
    makeElement({
      kind: 'lastro',
      phase: 'locacao',
      position: [cx, -FOUNDATION.embutimento + FOUNDATION.lastro / 2, cz],
      size: lastroSize,
      material: 'brita',
      anchor: 'top',
      meta: { label: 'Lastro de brita 5cm' },
      qty: { lastro_m3: fw * FOUNDATION.lastro * fd },
    })
  );

  let baseWallY = 0;

  if (type === 'radier') {
    const t = FOUNDATION.radier;
    const size: Vec3 = [fw, t, fd];
    elements.push(
      makeElement({
        kind: 'radier',
        phase: 'fundacao',
        position: [cx, -FOUNDATION.embutimento + FOUNDATION.lastro + t / 2, cz],
        size,
        material: 'concreto',
        anchor: 'base',
        meta: { label: 'Radier 12cm' },
        qty: concreteQty(size, 'fundacao', 2),
      })
    );
    baseWallY = -FOUNDATION.embutimento + FOUNDATION.lastro + t;
  } else {
    // sapata corrida + baldrame ao longo de cada linha de parede
    const withCorrida = type === 'sapata_corrida';
    for (const w of plan.walls) {
      const mx = (w.start.x + w.end.x) / 2;
      const mz = (w.start.z + w.end.z) / 2;

      if (withCorrida) {
        const s = FOUNDATION.sapataCorrida;
        const size: Vec3 = [w.length, s.h, s.w];
        elements.push(
          makeElement({
            kind: 'sapata',
            phase: 'fundacao',
            position: [mx, -FOUNDATION.embutimento + FOUNDATION.lastro + s.h / 2, mz],
            rotation: [0, -w.angle, 0],
            size,
            material: 'concreto',
            anchor: 'base',
            meta: { wallId: w.id, label: 'Sapata corrida 40×20' },
            qty: concreteQty(size, 'fundacao', 2),
          })
        );
      }

      const b = FOUNDATION.baldrame;
      const yBase = withCorrida
        ? -FOUNDATION.embutimento + FOUNDATION.lastro + FOUNDATION.sapataCorrida.h
        : -FOUNDATION.embutimento + FOUNDATION.lastro;
      const size: Vec3 = [w.length, b.h, b.w];
      elements.push(
        makeElement({
          kind: 'baldrame',
          phase: 'fundacao',
          position: [mx, yBase + b.h / 2, mz],
          rotation: [0, -w.angle, 0],
          size,
          material: 'concreto',
          anchor: 'base',
          meta: { wallId: w.id, label: 'Viga baldrame 14×40' },
          qty: concreteQty(size, 'fundacao', 3),
        })
      );
      baseWallY = Math.max(baseWallY, yBase + b.h);
    }

    // sapatas isoladas sob os pilares (2+ pavimentos)
    if (type === 'sapata_isolada') {
      const s = FOUNDATION.sapataIsolada;
      for (const p of pillarPoints) {
        const size: Vec3 = [s.w, s.h, s.w];
        elements.push(
          makeElement({
            kind: 'sapata',
            phase: 'fundacao',
            position: [p.x, -FOUNDATION.embutimento + FOUNDATION.lastro + s.h / 2, p.z],
            size,
            material: 'concreto',
            anchor: 'base',
            meta: { label: 'Sapata isolada 80×80' },
            qty: concreteQty(size, 'fundacao', 4),
          })
        );
      }
    }
  }

  return { elements, baseWallY: Math.max(0, baseWallY) };
}
