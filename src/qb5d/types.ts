// ============================================
// QB5D — Quantitativo + BIM em 5D
// 3D (geometria real) + 4D (sequência construtiva) + 5D (quantitativo/custo)
//
// Este módulo é PURO: não importa React nem Three.js. Recebe um plano
// arquitetônico normalizado e devolve um QB5DModel com todos os elementos
// construtivos (fundação → estrutura → alvenaria → laje → revestimento →
// esquadrias), já sequenciados numa linha do tempo 0..1 e com o BOM agregado.
//
// Normas de referência (ver standards.ts):
//   NBR 6118 (concreto), NBR 6122 (fundações), NBR 15270 (bloco cerâmico),
//   NBR 15575 (desempenho), NBR 13531/13532 (etapas da construção).
// ============================================

export type Vec3 = [number, number, number];

// Etapas da obra, na ordem de execução (NBR 13531/13532).
export type QB5DPhaseKey =
  | 'locacao'
  | 'fundacao'
  | 'pilares'
  | 'vigas'
  | 'alvenaria'
  | 'vergas'
  | 'cinta'
  | 'laje'
  | 'contrapiso'
  | 'revestimento'
  | 'esquadrias'
  | 'pintura';
// fase 2 (reservado): | 'hidraulica'

export type QB5DKind =
  // fundação
  | 'lastro'
  | 'sapata'
  | 'baldrame'
  | 'radier'
  // estrutura de concreto armado
  | 'pilar'
  | 'viga'
  | 'laje'
  // alvenaria de vedação
  | 'bloco'
  | 'meio_bloco'
  | 'verga'
  | 'contraverga'
  | 'cinta'
  // acabamento
  | 'chapisco'
  | 'reboco'
  | 'contrapiso'
  | 'porta'
  | 'janela'
  | 'forro'
  | 'pintura';

// Chave de material — define cor/aparência no viewer e agrupa InstancedMesh.
export type MaterialKey =
  | 'brita'
  | 'concreto'
  | 'concreto_magro'
  | 'bloco_ceramico'
  | 'argamassa'
  | 'ceramica'
  | 'madeira'
  | 'vidro'
  | 'tinta'
  | 'gesso';

// Como o elemento "nasce" na animação.
//   base   → cresce de baixo para cima (pilares, blocos, alvenaria)
//   top    → desce e encaixa (lajes)
//   center → fade + leve pop (vigas, revestimentos)
export type QB5DAnchor = 'base' | 'top' | 'center';

// Chaves de quantitativo agregável (5D).
export type QtyKey =
  | 'concreto_m3'
  | 'aco_kg'
  | 'forma_m2'
  | 'blocos_14_un'
  | 'blocos_09_un'
  | 'meio_bloco_un'
  | 'argamassa_assent_m3'
  | 'alvenaria_m2'
  | 'revest_int_m2'
  | 'revest_ext_m2'
  | 'argamassa_revest_m3'
  | 'contrapiso_m2'
  | 'porta_un'
  | 'janela_un'
  | 'esquadria_m2'
  | 'lastro_m3';

export interface QB5DElement {
  id: string;
  kind: QB5DKind;
  phase: QB5DPhaseKey;
  /** ordem global de execução (preenchida por sequenceModel) */
  step: number;
  /** janela normalizada 0..1 na linha do tempo (preenchida por sequenceModel) */
  tStart: number;
  tEnd: number;
  transform: {
    /** centro do volume, em metros, sistema Three.js (X dir, Y cima, Z prof) */
    position: Vec3;
    /** rotação Euler em radianos (normalmente [0, yaw, 0]) */
    rotation: Vec3;
    /** dimensões do box [largura(x), altura(y), profundidade(z)] antes da rotação */
    size: Vec3;
  };
  material: MaterialKey;
  anchor: QB5DAnchor;
  meta: {
    wallId?: string;
    roomId?: string;
    openingId?: string;
    fiada?: number;
    pavimento?: number;
    isExterior?: boolean;
    label?: string;
  };
  /** contribuição deste elemento para o BOM */
  qty: Partial<Record<QtyKey, number>>;
}

export interface QB5DPhaseInfo {
  key: QB5DPhaseKey;
  label: string;
  color: string;
  tStart: number;
  tEnd: number;
  count: number;
}

// ---------- Bill of Materials (5D) ----------

export interface BomLine {
  key: string;
  phase: QB5DPhaseKey;
  service: string;
  unit: string;
  quantity: number;
}

export interface BillOfMaterials {
  lines: BomLine[];
  /** avisos de sanidade (não bloqueiam nada, só informam) */
  warnings: string[];
}

// ---------- Modelo final ----------

export type FoundationType = 'radier' | 'sapata_corrida' | 'sapata_isolada';

export interface QB5DModel {
  elements: QB5DElement[];
  phases: QB5DPhaseInfo[];
  bom: BillOfMaterials;
  bounds: { min: Vec3; max: Vec3 };
  foundationType: FoundationType;
  fiadas: number;
  meta: {
    area: number;
    perimetro: number;
    pavimentos: number;
    peDireito: number;
    lod: boolean;
    blocoCount: number;
    elementCount: number;
  };
}

// ---------- Plano normalizado (entrada do pipeline) ----------

export interface QB5DOpening {
  id: string;
  type: 'door' | 'window';
  /** distância do início da parede até o centro da abertura, em metros */
  offset: number;
  width: number;
  /** altura do vão */
  height: number;
  /** peitoril (0 para portas) */
  sill: number;
}

export interface QB5DWall {
  id: string;
  start: { x: number; z: number };
  end: { x: number; z: number };
  thickness: number;
  isExterior: boolean;
  length: number;
  /** ângulo yaw da parede (atan2(dz, dx)) */
  angle: number;
  openings: QB5DOpening[];
}

export interface QB5DRoom {
  id: string;
  name: string;
  type: string;
  polygon: { x: number; z: number }[];
  area: number;
  center: { x: number; z: number };
}

export interface QB5DPlan {
  walls: QB5DWall[];
  rooms: QB5DRoom[];
  width: number;
  depth: number;
  peDireito: number;
  pavimentos: number;
  area: number;
  perimetro: number;
  /** bbox do conjunto de paredes, em metros, centrado na origem */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface QB5DBuildOptions {
  pavimentos?: number;
  lajePreMoldada?: boolean;
  mostrarPintura?: boolean;
  /** força o tipo de fundação em vez do automático */
  foundation?: FoundationType;
  /** teto de blocos individuais antes de cair para LOD sólido por fiada */
  blocoLimit?: number;
}
