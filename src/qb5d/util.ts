// ============================================
// QB5D — helpers de geometria e criação de elementos
// ============================================

import type {
  MaterialKey,
  QB5DAnchor,
  QB5DElement,
  QB5DKind,
  QB5DPhaseKey,
  QtyKey,
  Vec3,
} from './types';
import { STEEL_RATE } from './standards';

let seq = 0;
export function resetIds() {
  seq = 0;
}

interface MakeElementInput {
  kind: QB5DKind;
  phase: QB5DPhaseKey;
  position: Vec3;
  size: Vec3;
  rotation?: Vec3;
  material: MaterialKey;
  anchor?: QB5DAnchor;
  meta?: QB5DElement['meta'];
  qty?: Partial<Record<QtyKey, number>>;
}

export function makeElement(input: MakeElementInput): QB5DElement {
  seq += 1;
  return {
    id: `${input.kind}_${seq.toString(36)}`,
    kind: input.kind,
    phase: input.phase,
    step: 0,
    tStart: 0,
    tEnd: 1,
    transform: {
      position: input.position,
      rotation: input.rotation ?? [0, 0, 0],
      size: input.size,
    },
    material: input.material,
    anchor: input.anchor ?? 'center',
    meta: input.meta ?? {},
    qty: input.qty ?? {},
  };
}

/** volume de concreto → { concreto_m3, aco_kg, forma_m2 } */
export function concreteQty(
  size: Vec3,
  rateKey: keyof typeof STEEL_RATE,
  formaFaces: 2 | 3 | 4 = 4
): Partial<Record<QtyKey, number>> {
  const [x, y, z] = size;
  const vol = x * y * z;
  // fôrma = faces laterais (perímetro da seção × comprimento). Aproxima pelo
  // maior eixo como "comprimento".
  const L = Math.max(x, y, z);
  const a = size.filter((_, i) => size[i] !== L);
  const perim = a.length === 2 ? 2 * (a[0] + a[1]) : 2 * (x + z);
  return {
    concreto_m3: vol,
    aco_kg: vol * (STEEL_RATE[rateKey] ?? 80),
    forma_m2: (perim * L * formaFaces) / 4,
  };
}

/** distância ponto-a-ponto no plano XZ */
export const dist2 = (ax: number, az: number, bx: number, bz: number) =>
  Math.hypot(bx - ax, bz - az);

/** interpola linearmente */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** snap a uma grade */
export const snap = (v: number, g = 0.1) => Math.round(v / g) * g;

/** chave de posição para dedup */
export const posKey = (x: number, z: number, g = 0.1) =>
  `${Math.round(x / g)}:${Math.round(z / g)}`;

/** ponto ao longo de uma parede, dado offset do início (metros) */
export function alongWall(
  start: { x: number; z: number },
  angle: number,
  offset: number
): { x: number; z: number } {
  return {
    x: start.x + Math.cos(angle) * offset,
    z: start.z + Math.sin(angle) * offset,
  };
}
