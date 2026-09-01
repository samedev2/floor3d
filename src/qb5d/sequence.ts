// ============================================
// QB5D — Sequenciamento construtivo (4D)
// Ordena os elementos por fase (ordem de obra) e, dentro da fase, da base
// para o topo. Distribui janelas [tStart,tEnd] normalizadas em 0..1, com a
// fatia de cada fase proporcional ao nº de elementos. A alvenaria é
// sub-rampada por fiada para o efeito de "subir a parede".
// ============================================

import { PHASE_META, PHASE_ORDER } from './standards';
import type { QB5DElement, QB5DPhaseInfo, QB5DPhaseKey } from './types';

// Peso nominal de cada fase na linha do tempo (não proporcional ao nº de
// elementos — senão a alvenaria, com milhares de blocos, engoliria tudo).
// A alvenaria ganha um bônus suave conforme o tamanho da obra.
const PHASE_WEIGHT: Record<QB5DPhaseKey, number> = {
  locacao: 3,
  fundacao: 9,
  pilares: 8,
  vigas: 5,
  laje: 4,
  alvenaria: 26,
  vergas: 4,
  cinta: 3,
  contrapiso: 4,
  revestimento: 9,
  esquadrias: 5,
  pintura: 4,
};

function phaseWeight(phase: QB5DPhaseKey, count: number): number {
  const base = PHASE_WEIGHT[phase] ?? 5;
  if (phase === 'alvenaria') return base + Math.min(18, count / 150);
  return base;
}

export function sequenceModel(elements: QB5DElement[]): {
  elements: QB5DElement[];
  phases: QB5DPhaseInfo[];
} {
  const byPhase = new Map<QB5DPhaseKey, QB5DElement[]>();
  for (const el of elements) {
    const arr = byPhase.get(el.phase) ?? [];
    arr.push(el);
    byPhase.set(el.phase, arr);
  }

  const activePhases = PHASE_ORDER.filter((p) => (byPhase.get(p)?.length ?? 0) > 0);
  const weights = activePhases.map((p) => phaseWeight(p, byPhase.get(p)!.length));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;

  const phases: QB5DPhaseInfo[] = [];
  const ordered: QB5DElement[] = [];
  let cursor = 0;
  let globalStep = 0;

  activePhases.forEach((phase, pi) => {
    const slice = weights[pi] / totalW;
    const pStart = cursor;
    const pEnd = pi === activePhases.length - 1 ? 1 : cursor + slice;
    cursor = pEnd;

    const list = byPhase.get(phase)!;

    // ordena base→topo; alvenaria por fiada e depois por altura
    list.sort((a, b) => {
      const fa = a.meta.fiada ?? -1;
      const fb = b.meta.fiada ?? -1;
      if (fa !== fb && fa >= 0 && fb >= 0) return fa - fb;
      return a.transform.position[1] - b.transform.position[1];
    });

    const maxFiada = list.reduce((m, e) => Math.max(m, e.meta.fiada ?? 0), 0);

    list.forEach((el, i) => {
      let t0: number;
      let t1: number;
      if (phase === 'alvenaria' && maxFiada > 0) {
        // rampa por fiada: cada fiada ocupa uma sub-faixa da fatia da fase
        const f = el.meta.fiada ?? 0;
        const band = (pEnd - pStart) / (maxFiada + 1);
        t0 = pStart + f * band;
        t1 = t0 + band * 0.9;
      } else {
        const frac = list.length > 1 ? i / list.length : 0;
        const fracEnd = list.length > 1 ? (i + 1) / list.length : 1;
        t0 = pStart + frac * (pEnd - pStart);
        t1 = pStart + fracEnd * (pEnd - pStart);
      }
      el.step = globalStep++;
      el.tStart = clamp01(t0);
      el.tEnd = clamp01(Math.max(t1, t0 + 0.004));
      ordered.push(el);
    });

    phases.push({
      key: phase,
      label: PHASE_META[phase].label,
      color: PHASE_META[phase].color,
      tStart: pStart,
      tEnd: pEnd,
      count: list.length,
    });
  });

  return { elements: ordered, phases };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
