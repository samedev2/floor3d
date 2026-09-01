// =====================================================================
// QB5D — quantities.js
// Takeoff 5D (quantitativo + custo opcional) a partir dos elementos gerados.
// Métrico / ABNT. Números de ANTEPROJETO — conferir antes de comprar.
// =====================================================================

import { MORTAR_CEMENT_BAGS_PER_M3, RENDER_CEMENT_BAGS_PER_M3 } from "./params.js";

const r = (v, n = 2) => {
  const f = 10 ** n;
  return Math.round((v + Number.EPSILON) * f) / f;
};
const brl = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const TYPE_LABEL = {
  lastro: "Lastro de concreto magro",
  radier: "Radier",
  sapata_corrida: "Sapata corrida",
  sapata: "Sapatas isoladas",
  estaca: "Estacas",
  bloco: "Blocos de coroamento",
  baldrame: "Vigas baldrame",
  pilar_arranque: "Pilares — arranque",
  pilar: "Pilares — pavimento",
  laje: "Lajes",
  alvenaria: "Alvenaria de vedação",
  verga: "Vergas / contravergas",
  viga: "Vigas",
};

export function buildQuantities(structure, prices = {}) {
  const els = structure.elements;
  const T = structure.totals;

  // ---- agregação por tipo ----
  const byType = new Map();
  for (const e of els) {
    const k = e.type;
    if (!byType.has(k)) byType.set(k, { concreto_m3: 0, forma_m2: 0, aco_kg: 0, alvenaria_m2: 0, blocos: 0, argamassa_m3: 0, escavacao_m3: 0, magro_m3: 0, n: 0 });
    const a = byType.get(k);
    const q = e.quantities || {};
    for (const kk of Object.keys(a)) if (kk !== "n") a[kk] += q[kk] || 0;
    a.n++;
  }

  // ---- grupos p/ a UI ----
  const groups = [];

  // Concreto estrutural
  const concRows = [];
  for (const [type, a] of byType) {
    if (a.concreto_m3 <= 0) continue;
    concRows.push({
      label: `${TYPE_LABEL[type] || type} (${a.n})`,
      value: `${r(a.concreto_m3)} m³  ·  fôrma ${r(a.forma_m2)} m²  ·  aço ${r(a.aco_kg, 0)} kg`,
    });
  }
  const concTotal = r(T.concreto_m3);
  const acoTotal = r(T.aco_kg, 0);
  concRows.push({
    label: "TOTAL concreto / fôrma / aço",
    value: `${concTotal} m³  ·  ${r(T.forma_m2)} m²  ·  ${acoTotal} kg  (taxa média ${concTotal ? r(acoTotal / concTotal, 0) : 0} kg/m³)`,
    strong: true,
  });
  groups.push({ key: "concreto", label: "Concreto armado", rows: concRows });

  // Alvenaria
  const alv = byType.get("alvenaria") || {};
  const argM3 = alv.argamassa_m3 || 0;
  groups.push({
    key: "alvenaria", label: "Alvenaria de vedação", rows: [
      { label: `Área de parede (${structure.summary.n_panos_alvenaria ?? alv.n ?? 0} panos, líq. de vãos)`, value: `${r(alv.alvenaria_m2 || 0)} m²` },
      { label: "Blocos / tijolos", value: `${r(alv.blocos || 0, 0).toLocaleString("pt-BR")} un` },
      { label: "Argamassa de assentamento", value: `${r(argM3, 2)} m³` },
      { label: "Cimento p/ assentamento (~)", value: `${r(argM3 * MORTAR_CEMENT_BAGS_PER_M3, 0)} sacos 50 kg` },
    ],
  });

  // Revestimento
  let chap = 0, reb = 0;
  for (const e of els) { chap += e.quantities?.chapisco_m2 || 0; reb += e.quantities?.reboco_m2 || 0; }
  const rebArgM3 = reb * 0.025; // ~2,5 cm médio
  groups.push({
    key: "revestimento", label: "Revestimento de parede", rows: [
      { label: "Chapisco", value: `${r(chap)} m²` },
      { label: "Reboco / emboço", value: `${r(reb)} m²` },
      { label: "Cimento p/ reboco (~)", value: `${r(rebArgM3 * RENDER_CEMENT_BAGS_PER_M3, 0)} sacos 50 kg` },
    ],
  });

  // Movimento de terra
  groups.push({
    key: "terra", label: "Movimento de terra e lastro", rows: [
      { label: "Escavação (manual/mecânica)", value: `${r(T.escavacao_m3)} m³` },
      { label: "Concreto magro / lastro", value: `${r(T.magro_m3)} m³` },
    ],
  });

  // ---- custo (5D) — só se houver preço > 0 ----
  const P = prices || {};
  const costLines = [
    ["Concreto", T.concreto_m3, "m³", P.concreto_m3],
    ["Fôrma", T.forma_m2, "m²", P.forma_m2],
    ["Aço CA-50", T.aco_kg, "kg", P.aco_kg],
    ["Alvenaria", alv.alvenaria_m2 || 0, "m²", P.alvenaria_m2],
    ["Reboco", reb, "m²", P.reboco_m2],
    ["Escavação", T.escavacao_m3, "m³", P.escavacao_m3],
    ["Concreto magro", T.magro_m3, "m³", P.concreto_magro_m3],
  ].map(([label, qty, unit, up]) => ({
    label, qty: r(qty), unit, unitPrice: Number(up) || 0, subtotal: r((Number(up) || 0) * qty),
  }));
  const hasPrices = costLines.some((l) => l.unitPrice > 0);
  const cost = hasPrices
    ? { total: r(costLines.reduce((s, l) => s + l.subtotal, 0)), lines: costLines, brl }
    : null;

  // ---- export ----
  const flat = els.map((e) => ({
    id: e.id, tipo: e.type, camada: e.layer,
    dims_cm: e.dims_cm || {},
    ...Object.fromEntries(Object.entries(e.quantities || {}).map(([k, v]) => [k, r(v, 3)])),
  }));

  function csv() {
    const cols = ["id", "tipo", "camada", "concreto_m3", "forma_m2", "aco_kg", "alvenaria_m2", "blocos", "argamassa_m3", "reboco_m2", "escavacao_m3", "magro_m3"];
    const head = cols.join(";");
    const body = flat
      .map((row) => cols.map((c) => String(row[c] ?? "").replace(".", ",")).join(";"))
      .join("\n");
    const tot = "TOTAIS;;;" + ["concreto_m3", "forma_m2", "aco_kg", "alvenaria_m2", "blocos", "argamassa_m3", "reboco_m2", "escavacao_m3", "magro_m3"]
      .map((c) => String(r(T[c] || 0, 3)).replace(".", ",")).join(";");
    return [head, body, tot].join("\n");
  }
  function json() {
    return JSON.stringify(
      { summary: structure.summary, totals: T, elements: flat, custo: cost && { total: cost.total, linhas: cost.lines } },
      null, 2,
    );
  }

  return { groups, byElement: flat, totals: T, summary: structure.summary, cost, csv, json };
}
