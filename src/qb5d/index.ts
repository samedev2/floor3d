// ============================================
// QB5D — orquestrador
// buildQB5D(source) → QB5DModel completo (geometria + sequência + BOM)
// ============================================

import type { GeminiFloorPlan } from '../lib/geminiChat';
import type { StructuralPlan } from '../floorplan/structuralIntelligence';
import { normalizeGeminiPlan, normalizeStructuralPlan } from './planInput';
import { buildFoundation, chooseFoundation } from './foundation';
import { buildFrame, computePillarPoints } from './frame';
import { buildMasonry } from './masonry';
import { buildFinishes } from './finishes';
import { sequenceModel } from './sequence';
import { computeBOM } from './quantities';
import { resetIds } from './util';
import type { QB5DBuildOptions, QB5DModel, QB5DPlan, Vec3 } from './types';

export * from './types';
export { PHASE_META, PHASE_ORDER, MATERIAL_COLOR } from './standards';

function assemble(plan: QB5DPlan, opts: QB5DBuildOptions): QB5DModel {
  resetIds();

  const pillarPoints = computePillarPoints(plan);
  const foundationType = chooseFoundation(plan, opts.foundation);

  const fnd = buildFoundation(plan, pillarPoints, foundationType);
  const frame = buildFrame(plan, pillarPoints, { lajePreMoldada: opts.lajePreMoldada });
  const masonry = buildMasonry(plan, pillarPoints, fnd.baseWallY, { blocoLimit: opts.blocoLimit });
  const finishes = buildFinishes(plan, fnd.baseWallY, { mostrarPintura: opts.mostrarPintura });

  const raw = [...fnd.elements, ...frame.elements, ...masonry.elements, ...finishes];
  const { elements, phases } = sequenceModel(raw);

  const bom = computeBOM(elements, plan, {
    fiadas: masonry.fiadas,
    lod: masonry.lod,
    blocoCount: masonry.blocoCount,
  });

  // bounds do conjunto
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const el of elements) {
    const [px, py, pz] = el.transform.position;
    const [sx, sy, sz] = el.transform.size;
    const r = Math.max(sx, sz) / 2 + 0.1;
    min = [Math.min(min[0], px - r), Math.min(min[1], py - sy / 2), Math.min(min[2], pz - r)];
    max = [Math.max(max[0], px + r), Math.max(max[1], py + sy / 2), Math.max(max[2], pz + r)];
  }

  return {
    elements,
    phases,
    bom,
    bounds: { min, max },
    foundationType,
    fiadas: masonry.fiadas,
    meta: {
      area: round(plan.area),
      perimetro: round(plan.perimetro),
      pavimentos: plan.pavimentos,
      peDireito: plan.peDireito,
      lod: masonry.lod,
      blocoCount: masonry.blocoCount,
      elementCount: elements.length,
    },
  };
}

export function buildQB5D(source: GeminiFloorPlan, opts: QB5DBuildOptions = {}): QB5DModel {
  const plan = normalizeGeminiPlan(source, { pavimentos: opts.pavimentos });
  return assemble(plan, opts);
}

export function buildQB5DFromStructural(source: StructuralPlan, opts: QB5DBuildOptions = {}): QB5DModel {
  const plan = normalizeStructuralPlan(source, { pavimentos: opts.pavimentos });
  return assemble(plan, opts);
}

const round = (v: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
