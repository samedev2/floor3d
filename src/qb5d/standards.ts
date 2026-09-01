// ============================================
// QB5D — Constantes ABNT/NBR (fonte da verdade dimensional)
// Todas as medidas em METROS, salvo indicação.
// ============================================

import type { MaterialKey, QB5DPhaseKey, QtyKey } from './types';

// ---------- Alvenaria de vedação (NBR 15270 — bloco cerâmico) ----------
export const BLOCK = {
  /** bloco de vedação externo (parede 14cm) — 14 x 19 x 39 */
  ext: { w: 0.14, h: 0.19, l: 0.39 },
  /** bloco de vedação interno (parede 9cm) — 9 x 19 x 19 */
  int: { w: 0.09, h: 0.19, l: 0.19 },
  /** altura nominal do bloco (comum a ext/int) */
  h: 0.19,
  /** junta de argamassa de assentamento (horizontal e vertical) */
  joint: 0.01,
  /** altura de uma fiada = bloco + junta */
  courseHeight: 0.19 + 0.01, // 0.20
  /** comprimento modular do bloco externo + junta */
  moduleExt: 0.39 + 0.01, // 0.40
  moduleInt: 0.19 + 0.01, // 0.20
} as const;

// ---------- Pé-direito ----------
export const PE_DIREITO = 2.8;
export const fiadasParaPeDireito = (pd: number = PE_DIREITO): number =>
  Math.max(1, Math.round(pd / BLOCK.courseHeight));

// ---------- Estrutura de concreto armado (NBR 6118) ----------
export const CONCRETE = {
  /** pilar 14 x 30 */
  pilar: { w: 0.14, d: 0.3 },
  /** viga de respaldo/cintamento 14 x 40 (h) */
  viga: { w: 0.14, h: 0.4 },
  /** laje maciça */
  lajeMacica: 0.1,
  /** laje pré-moldada (treliçada: nervura + lajota + capa 4cm) */
  lajePreMoldada: 0.12,
  /** verga / contraverga */
  verga: { w: 0.1, h: 0.1 },
  /** transpasse da verga além do vão, cada lado */
  vergaOverlap: 0.3,
  /** cinta de respaldo no topo da alvenaria */
  cinta: { w: 0.14, h: 0.15 },
  /** cobrimento nominal */
  cobrimento: 0.025,
  fck: 25, // MPa
} as const;

// ---------- Fundação (NBR 6122) ----------
export const FOUNDATION = {
  /** lastro de brita sob radier/sapata */
  lastro: 0.05,
  /** radier em concreto armado */
  radier: 0.12,
  /** sapata corrida (largura x altura) sob linha de parede */
  sapataCorrida: { w: 0.4, h: 0.2 },
  /** viga baldrame (largura x altura) */
  baldrame: { w: 0.14, h: 0.4 },
  /** sapata isolada sob pilar (base quadrada x altura) */
  sapataIsolada: { w: 0.8, h: 0.25 },
  /** profundidade de embutimento abaixo do nível 0 */
  embutimento: 0.4,
  /** área (m²) até a qual o térreo usa radier; acima usa sapata corrida */
  areaRadierMax: 60,
} as const;

// ---------- Revestimento / acabamento (NBR 13749 / 7200) ----------
export const FINISH = {
  chapisco: 0.005,
  rebocoInterno: 0.02,
  rebocoExterno: 0.025,
  contrapiso: 0.04,
  forro: 0.012,
  pintura: 0.001,
} as const;

// ---------- Esquadrias (folgas padrão) ----------
export const OPENING_DEFAULT = {
  door: { width: 0.8, height: 2.1, sill: 0 },
  doorExterior: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.1, sill: 1.1 },
} as const;

// ---------- Taxas de consumo p/ quantitativo (5D) ----------
export const STEEL_RATE: Record<string, number> = {
  // kg de aço por m³ de concreto — valores usuais de projeto residencial
  fundacao: 60,
  pilar: 100,
  viga: 110,
  laje: 80,
  verga: 90,
  cinta: 90,
};

/** massa específica p/ conversões (kg/m³) */
export const DENSITY = {
  concreto: 2500,
  argamassa: 1900,
  brita: 1500,
} as const;

/** blocos por m² de alvenaria (usado no modo LOD, sem contar bloco a bloco) */
export const BLOCKS_PER_M2 = {
  ext: 1 / (BLOCK.moduleExt * BLOCK.courseHeight), // ≈ 12.5
  int: 1 / (BLOCK.moduleInt * BLOCK.courseHeight), // ≈ 25 (bloco 19cm)
} as const;

// ---------- Cores por material (viewer) ----------
export const MATERIAL_COLOR: Record<MaterialKey, string> = {
  brita: '#8d8d8d',
  concreto: '#b8b8b8',
  concreto_magro: '#9a9a94',
  bloco_ceramico: '#c1683f',
  argamassa: '#d9d4c8',
  ceramica: '#e7e2d6',
  madeira: '#8a5a33',
  vidro: '#9ec9e0',
  tinta: '#f2f0eb',
  gesso: '#eceae4',
};

// ---------- Fases: rótulo + cor + ordem ----------
// Ordem de execução da obra. No sistema "concreto armado + alvenaria de
// vedação" a estrutura (pilares → vigas → laje) é executada antes da
// alvenaria, que preenche os vãos do pórtico. 'cinta' fica reservada para
// o sistema de alvenaria estrutural (fase futura) e não é emitida aqui.
export const PHASE_ORDER: QB5DPhaseKey[] = [
  'locacao',
  'fundacao',
  'pilares',
  'vigas',
  'laje',
  'alvenaria',
  'vergas',
  'contrapiso',
  'revestimento',
  'esquadrias',
  'pintura',
];

export const PHASE_META: Record<QB5DPhaseKey, { label: string; color: string }> = {
  locacao: { label: 'Locação e lastro', color: '#6b7280' },
  fundacao: { label: 'Fundação', color: '#78716c' },
  pilares: { label: 'Pilares', color: '#3b82f6' },
  vigas: { label: 'Vigas', color: '#6366f1' },
  alvenaria: { label: 'Alvenaria de vedação', color: '#ea7a4e' },
  vergas: { label: 'Vergas e contravergas', color: '#f59e0b' },
  cinta: { label: 'Cinta de respaldo', color: '#8b5cf6' },
  laje: { label: 'Laje de cobertura', color: '#0ea5e9' },
  contrapiso: { label: 'Contrapiso', color: '#a3a3a3' },
  revestimento: { label: 'Chapisco e reboco', color: '#d6c9a8' },
  esquadrias: { label: 'Esquadrias', color: '#10b981' },
  pintura: { label: 'Pintura e forro', color: '#e5e7eb' },
};

// ---------- Rótulos de serviço para o BOM ----------
export const QTY_SERVICE: Record<QtyKey, { service: string; unit: string }> = {
  concreto_m3: { service: 'Concreto estrutural fck 25 MPa', unit: 'm³' },
  aco_kg: { service: 'Aço CA-50/CA-60 (armadura)', unit: 'kg' },
  forma_m2: { service: 'Fôrma de madeira (área de contato)', unit: 'm²' },
  blocos_14_un: { service: 'Bloco cerâmico 14×19×39', unit: 'un' },
  blocos_09_un: { service: 'Bloco cerâmico 9×19×19', unit: 'un' },
  meio_bloco_un: { service: 'Meio-bloco (amarração)', unit: 'un' },
  argamassa_assent_m3: { service: 'Argamassa de assentamento', unit: 'm³' },
  alvenaria_m2: { service: 'Alvenaria de vedação (área)', unit: 'm²' },
  revest_int_m2: { service: 'Revestimento interno (chapisco+reboco)', unit: 'm²' },
  revest_ext_m2: { service: 'Revestimento externo (chapisco+reboco)', unit: 'm²' },
  argamassa_revest_m3: { service: 'Argamassa de revestimento', unit: 'm³' },
  contrapiso_m2: { service: 'Contrapiso', unit: 'm²' },
  porta_un: { service: 'Porta (esquadria + folha)', unit: 'un' },
  janela_un: { service: 'Janela (esquadria)', unit: 'un' },
  esquadria_m2: { service: 'Área de esquadrias', unit: 'm²' },
  lastro_m3: { service: 'Lastro de brita', unit: 'm³' },
};
