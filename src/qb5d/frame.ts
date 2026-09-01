// ============================================
// QB5D — Estrutura de concreto armado
// Pilares (14×30) nos nós de parede + a cada ≤4m em vãos longos,
// vigas de respaldo (14×40) sobre as linhas de parede,
// laje de cobertura maciça (10cm) sobre o perímetro.
// ============================================

import { CONCRETE } from './standards';
import type { QB5DElement, QB5DPlan, Vec3 } from './types';
import { concreteQty, makeElement, posKey, alongWall } from './util';

export interface PillarPoint {
  x: number;
  z: number;
  angle: number; // orientação do pilar (direção da parede dominante)
}

// ---------------------------------------------------------------
// Pontos de pilar — usados também pela fundação (sapata isolada)
// e pela alvenaria (para descontar os panos).
// ---------------------------------------------------------------
export function computePillarPoints(plan: QB5DPlan): PillarPoint[] {
  const nodes = new Map<string, { x: number; z: number; angles: number[]; exterior: boolean }>();

  const add = (x: number, z: number, angle: number, exterior: boolean) => {
    const k = posKey(x, z, 0.15);
    const n = nodes.get(k);
    if (n) {
      n.angles.push(angle);
      n.exterior = n.exterior || exterior;
    } else {
      nodes.set(k, { x, z, angles: [angle], exterior });
    }
  };

  for (const w of plan.walls) {
    add(w.start.x, w.start.z, w.angle, w.isExterior);
    add(w.end.x, w.end.z, w.angle, w.isExterior);
  }

  const points: PillarPoint[] = [];
  const seen = new Set<string>();
  const push = (x: number, z: number, angle: number) => {
    const k = posKey(x, z, 0.25);
    if (seen.has(k)) return;
    seen.add(k);
    points.push({ x, z, angle });
  };

  for (const n of nodes.values()) {
    // nó com 2+ paredes (canto / T / L) ou terminação de parede externa
    if (n.angles.length >= 2 || n.exterior) {
      push(n.x, n.z, n.angles[0] ?? 0);
    }
  }

  // pilares intermediários em paredes externas longas (controle de vão ≤ 4m)
  for (const w of plan.walls) {
    if (!w.isExterior || w.length <= 4) continue;
    const bays = Math.ceil(w.length / 4);
    for (let k = 1; k < bays; k++) {
      const p = alongWall(w.start, w.angle, (w.length * k) / bays);
      push(p.x, p.z, w.angle);
    }
  }

  return points;
}

// ---------------------------------------------------------------
// Elementos: pilares + vigas + laje
// ---------------------------------------------------------------
export function buildFrame(
  plan: QB5DPlan,
  pillarPoints: PillarPoint[],
  opts: { lajePreMoldada?: boolean } = {}
): { elements: QB5DElement[]; slabTopY: number } {
  const elements: QB5DElement[] = [];
  const pd = plan.peDireito;
  const vigaTopY = pd + CONCRETE.viga.h;
  const lajeThk = opts.lajePreMoldada ? CONCRETE.lajePreMoldada : CONCRETE.lajeMacica;

  // ---- Pilares (do nível 0 ao fundo da viga) ----
  const pilarH = pd;
  for (const p of pillarPoints) {
    const size: Vec3 = [CONCRETE.pilar.d, pilarH, CONCRETE.pilar.w];
    elements.push(
      makeElement({
        kind: 'pilar',
        phase: 'pilares',
        position: [p.x, pilarH / 2, p.z],
        rotation: [0, -p.angle, 0],
        size,
        material: 'concreto',
        anchor: 'base',
        meta: { label: 'Pilar 14×30', pavimento: 1 },
        qty: concreteQty(size, 'pilar', 4),
      })
    );
  }

  // ---- Vigas de respaldo sobre cada linha de parede ----
  for (const w of plan.walls) {
    const mx = (w.start.x + w.end.x) / 2;
    const mz = (w.start.z + w.end.z) / 2;
    const size: Vec3 = [w.length, CONCRETE.viga.h, CONCRETE.viga.w];
    elements.push(
      makeElement({
        kind: 'viga',
        phase: 'vigas',
        position: [mx, pd + CONCRETE.viga.h / 2, mz],
        rotation: [0, -w.angle, 0],
        size,
        material: 'concreto',
        anchor: 'center',
        meta: { wallId: w.id, label: 'Viga 14×40', isExterior: w.isExterior },
        qty: concreteQty(size, 'viga', 3),
      })
    );
  }

  // ---- Laje de cobertura (bbox do perímetro + espessura de parede) ----
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  const pad = 0.25; // meia espessura de parede externa
  const lw = maxX - minX + pad * 2;
  const ld = maxZ - minZ + pad * 2;
  const lajeSize: Vec3 = [lw, lajeThk, ld];
  elements.push(
    makeElement({
      kind: 'laje',
      phase: 'laje',
      position: [(minX + maxX) / 2, vigaTopY + lajeThk / 2, (minZ + maxZ) / 2],
      size: lajeSize,
      material: 'concreto',
      anchor: 'top',
      meta: { label: opts.lajePreMoldada ? 'Laje pré-moldada 12cm' : 'Laje maciça 10cm', pavimento: 1 },
      qty: concreteQty(lajeSize, 'laje', 2),
    })
  );

  return { elements, slabTopY: vigaTopY + lajeThk };
}
