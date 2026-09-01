// ============================================
// QB5D — Levantamento de quantitativos (5D)
// Agrega element.qty por serviço/fase, deriva itens compostos (chapisco,
// argamassa de assentamento) e roda checagens de sanidade.
// ============================================

import { BLOCK, QTY_SERVICE, FINISH } from './standards';
import type {
  BillOfMaterials,
  BomLine,
  QB5DElement,
  QB5DPhaseKey,
  QB5DPlan,
  QtyKey,
} from './types';

// fase "dona" de cada chave de quantitativo (para agrupar no relatório)
const QTY_PHASE: Record<QtyKey, QB5DPhaseKey> = {
  lastro_m3: 'locacao',
  concreto_m3: 'fundacao',
  aco_kg: 'fundacao',
  forma_m2: 'fundacao',
  blocos_14_un: 'alvenaria',
  blocos_09_un: 'alvenaria',
  meio_bloco_un: 'alvenaria',
  argamassa_assent_m3: 'alvenaria',
  alvenaria_m2: 'alvenaria',
  revest_int_m2: 'revestimento',
  revest_ext_m2: 'revestimento',
  argamassa_revest_m3: 'revestimento',
  contrapiso_m2: 'contrapiso',
  porta_un: 'esquadrias',
  janela_un: 'esquadrias',
  esquadria_m2: 'esquadrias',
};

export function computeBOM(
  elements: QB5DElement[],
  plan: QB5DPlan,
  ctx: { fiadas: number; lod: boolean; blocoCount: number }
): BillOfMaterials {
  const totals = new Map<QtyKey, number>();
  const add = (k: QtyKey, v: number) => totals.set(k, (totals.get(k) ?? 0) + v);

  // concreto separado por grupo de elemento (verga+contraverga juntos)
  const concreteGroup = (kind: string) =>
    kind === 'contraverga' ? 'verga' : kind === 'baldrame' || kind === 'radier' ? 'fundacao' : kind === 'sapata' ? 'fundacao' : kind;
  const concretePorTipo = new Map<string, number>();

  for (const el of elements) {
    for (const [k, v] of Object.entries(el.qty) as [QtyKey, number][]) {
      if (v == null) continue;
      add(k, v);
      if (k === 'concreto_m3') {
        const g = concreteGroup(el.kind);
        concretePorTipo.set(g, (concretePorTipo.get(g) ?? 0) + v);
      }
    }
  }

  // ---- itens compostos derivados ----
  const alv = totals.get('alvenaria_m2') ?? 0;
  // argamassa de assentamento ≈ (bloco 14 → 0.012 m³/m²; bloco 09 → 0.009)
  const alv14 = elements
    .filter((e) => (e.kind === 'bloco' || e.kind === 'meio_bloco') && e.meta.isExterior)
    .reduce((s, e) => s + (e.qty.alvenaria_m2 ?? 0), 0);
  const alv09 = alv - alv14;
  add('argamassa_assent_m3', alv14 * 0.012 + alv09 * 0.009);

  const lines: BomLine[] = [];
  const groupInfo: Record<string, { label: string; phase: QB5DPhaseKey }> = {
    fundacao: { label: 'fundação (radier/sapatas/baldrame)', phase: 'fundacao' },
    pilar: { label: 'pilares', phase: 'pilares' },
    viga: { label: 'vigas', phase: 'vigas' },
    laje: { label: 'laje', phase: 'laje' },
    verga: { label: 'vergas e contravergas', phase: 'vergas' },
  };

  // concreto detalhado
  for (const [g, v] of concretePorTipo) {
    const info = groupInfo[g] ?? { label: g, phase: 'fundacao' as QB5DPhaseKey };
    lines.push({
      key: `concreto_${g}`,
      phase: info.phase,
      service: `Concreto fck 25 MPa — ${info.label}`,
      unit: 'm³',
      quantity: round(v, 2),
    });
  }
  const acoTotal = totals.get('aco_kg') ?? 0;
  if (acoTotal > 0)
    lines.push({ key: 'aco', phase: 'fundacao', service: QTY_SERVICE.aco_kg.service, unit: 'kg', quantity: round(acoTotal, 0) });
  const formaTotal = totals.get('forma_m2') ?? 0;
  if (formaTotal > 0)
    lines.push({ key: 'forma', phase: 'fundacao', service: QTY_SERVICE.forma_m2.service, unit: 'm²', quantity: round(formaTotal, 1) });

  // demais chaves simples
  const simple: QtyKey[] = [
    'lastro_m3', 'blocos_14_un', 'blocos_09_un', 'meio_bloco_un', 'argamassa_assent_m3',
    'alvenaria_m2', 'revest_int_m2', 'revest_ext_m2', 'argamassa_revest_m3',
    'contrapiso_m2', 'porta_un', 'janela_un', 'esquadria_m2',
  ];
  for (const k of simple) {
    const v = totals.get(k) ?? 0;
    if (v <= 0) continue;
    const dec = QTY_SERVICE[k].unit === 'un' ? 0 : k.endsWith('_m3') ? 2 : 1;
    lines.push({ key: k, phase: QTY_PHASE[k], service: QTY_SERVICE[k].service, unit: QTY_SERVICE[k].unit, quantity: round(k === 'blocos_14_un' || k === 'blocos_09_un' ? Math.ceil(v) : v, dec) });
  }

  // chapisco = mesma área de reboco
  const revTot = (totals.get('revest_int_m2') ?? 0) + (totals.get('revest_ext_m2') ?? 0);
  if (revTot > 0)
    lines.push({ key: 'chapisco', phase: 'revestimento', service: 'Chapisco (aderência)', unit: 'm²', quantity: round(revTot, 1) });

  lines.sort((a, b) => phaseIdx(a.phase) - phaseIdx(b.phase));

  return { lines, warnings: validate(plan, totals, ctx) };
}

// ---- sanidade ----
function validate(
  plan: QB5DPlan,
  totals: Map<QtyKey, number>,
  ctx: { fiadas: number; lod: boolean; blocoCount: number }
): string[] {
  const w: string[] = [];
  const peDireitoReal = ctx.fiadas * BLOCK.courseHeight;
  if (Math.abs(peDireitoReal - plan.peDireito) > 0.25)
    w.push(`Fiadas (${ctx.fiadas}×0,20 = ${peDireitoReal.toFixed(2)}m) divergem do pé-direito ${plan.peDireito.toFixed(2)}m.`);

  const alv = totals.get('alvenaria_m2') ?? 0;
  const blocos = (totals.get('blocos_14_un') ?? 0) + (totals.get('blocos_09_un') ?? 0) + (totals.get('meio_bloco_un') ?? 0);
  if (alv > 2) {
    const perM2 = blocos / alv;
    if (perM2 < 8 || perM2 > 28)
      w.push(`Densidade de blocos ${perM2.toFixed(1)}/m² fora da faixa usual (8–28).`);
  }

  const somaComodos = plan.rooms.reduce((s, r) => s + r.area, 0);
  const areaBbox = (plan.bounds.maxX - plan.bounds.minX) * (plan.bounds.maxZ - plan.bounds.minZ);
  if (somaComodos > 0 && areaBbox > 0 && Math.abs(somaComodos - areaBbox) / areaBbox > 0.35)
    w.push(`Soma das áreas dos ambientes (${somaComodos.toFixed(1)}m²) diverge da projeção (${areaBbox.toFixed(1)}m²).`);

  if (ctx.lod) w.push(`Modo LOD ativo: alvenaria representada por panos sólidos (${ctx.blocoCount.toLocaleString('pt-BR')} blocos estimados por área).`);

  const conc = totals.get('concreto_m3') ?? 0;
  if (conc > 0 && plan.area > 0) {
    const taxa = conc / plan.area;
    // radier consome muito concreto por m² — só alerta acima de 0,55
    const limite = 0.55;
    if (taxa > limite)
      w.push(`Consumo de concreto ${taxa.toFixed(2)} m³/m² acima do usual — revisar seções/fundação.`);
  }
  return w;
}

const PHASE_SEQ: QB5DPhaseKey[] = [
  'locacao', 'fundacao', 'pilares', 'vigas', 'laje', 'alvenaria', 'vergas', 'contrapiso', 'revestimento', 'esquadrias', 'pintura',
];
const phaseIdx = (p: QB5DPhaseKey) => {
  const i = PHASE_SEQ.indexOf(p);
  return i < 0 ? 99 : i;
};
const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

// re-export p/ o painel
export { FINISH };
