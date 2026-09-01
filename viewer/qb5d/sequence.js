// =====================================================================
// QB5D — sequence.js
// Modelo 4D: ordena os elementos em ESTÁGIOS construtivos e dá a cada
// elemento um instante de entrada + tipo de animação. Ordem correta p/
// concreto armado + vedação: pórtico (fundação → pilares → vigas → laje)
// primeiro, depois alvenaria de preenchimento, vãos, contrapiso e
// revestimento. render.js consome isto para tocar a obra da base ao acabamento.
// =====================================================================

// `color` alimenta a legenda lateral / o cartão de estágio.
// `entrance`: rise | drop | fade | courses (fiada a fiada) | finish (fase de
// acabamento — sem geometria, dispara a troca de material p/ reboco).
// `always`: mantém o estágio na timeline mesmo sem elementos.
const STAGE_DEFS = [
  { id: "locacao",    label: "Locação e lastro",       color: 0x8d7b68, entrance: "fade",
    match: (e) => e.type === "lastro" },
  { id: "fundacao",   label: "Fundação",               color: 0x9aa0a6, entrance: "rise",
    match: (e) => e.layer === "fundacao" || e.layer === "baldrame" },
  { id: "pilar",      label: "Pilares",                color: 0x3b82f6, entrance: "rise",
    match: (e) => e.type === "pilar" || e.type === "pilar_arranque" },
  { id: "viga",       label: "Vigas",                  color: 0x8b5cf6, entrance: "drop",
    match: (e) => e.layer === "viga" },
  { id: "laje_cob",   label: "Laje de cobertura",      color: 0x22d3ee, entrance: "drop",
    match: (e) => e.layer === "laje_cob" },
  { id: "alvenaria",  label: "Alvenaria de vedação",   color: 0xf97316, entrance: "courses",
    weight: 3, match: (e) => e.layer === "alvenaria" },
  { id: "verga",      label: "Vergas e contravergas",  color: 0xeab308, entrance: "drop",
    match: (e) => e.layer === "verga" },
  { id: "esquadria",  label: "Portas e janelas",       color: 0x10b981, entrance: "fade",
    match: (e) => e.layer === "esquadria" },
  { id: "contrapiso", label: "Contrapiso",             color: 0x9ca3af, entrance: "fade",
    match: (e) => e.layer === "laje_piso", always: true },
  { id: "reboco",     label: "Chapisco e reboco",      color: 0xe5e7eb, entrance: "finish",
    match: () => false, always: true },
  // ganchos Fase 2
  { id: "instalacoes", label: "Instalações (Fase 2)",  color: 0x60a5fa, entrance: "fade",
    match: (e) => e.layer === "instalacoes" },
];

const STAGE_MIN_MS = 700;
const STAGE_PER_EL_MS = 40;
const STAGE_MAX_MS = 3600;
const STAGE_EMPTY_MS = 900;      // duração de um estágio "always" vazio
const STAGE_GAP_MS = 130;
const EL_RISE_MS = 500;

export function buildSequence(structure, opts = {}) {
  const speed = opts.speed || 1;
  const els = structure.elements;

  const buckets = new Map(STAGE_DEFS.map((s) => [s.id, []]));
  for (const e of els) {
    const def = STAGE_DEFS.find((s) => s.match(e));
    if (def) buckets.get(def.id).push(e);
    else buckets.get("reboco").push(e); // fallback improvável
  }

  const stages = [];
  const entranceOf = new Map();
  let clock = 0;

  for (const def of STAGE_DEFS) {
    const group = buckets.get(def.id);
    group.sort((a, b) => (a.seqIndex || 0) - (b.seqIndex || 0));

    if (!group.length && !def.always) continue;

    const wgt = def.weight || 1;
    const durTotal = group.length
      ? (Math.min(STAGE_MAX_MS, Math.max(STAGE_MIN_MS, group.length * STAGE_PER_EL_MS)) * wgt) / speed
      : STAGE_EMPTY_MS / speed;
    const startMs = clock;
    const stagger = group.length > 1
      ? Math.max(0, (durTotal - EL_RISE_MS / speed) / (group.length - 1))
      : 0;

    group.forEach((e, i) => {
      entranceOf.set(e.id, {
        stageId: def.id,
        startMs: startMs + i * stagger,
        durMs: EL_RISE_MS / speed,
        type: def.entrance,
      });
    });

    stages.push({
      id: def.id,
      label: def.label,
      color: def.color,
      entrance: def.entrance,
      startMs,
      durationMs: durTotal,
      elementIds: group.map((e) => e.id),
      count: group.length,
    });
    clock = startMs + durTotal + STAGE_GAP_MS / speed;
  }

  const rebocoStage = stages.find((s) => s.id === "reboco");
  // instante em que TODA a estrutura + materiais estruturais (concreto,
  // alvenaria, vãos, contrapiso) já estão colocados — antes do acabamento.
  const FINISH_IDS = new Set(["reboco", "instalacoes", "acabamento"]);
  const preFinish = stages.filter((s) => !FINISH_IDS.has(s.id));
  const structuralCompleteMs = preFinish.length
    ? Math.max(...preFinish.map((s) => s.startMs + s.durationMs))
    : Math.max(clock - STAGE_GAP_MS / speed, 1);

  return {
    stages,
    totalMs: Math.max(clock - STAGE_GAP_MS / speed, 1),
    structuralCompleteMs,
    entranceOf,
    rebocoStartMs: rebocoStage ? rebocoStage.startMs : Infinity,

    progressOf(elementId, t) {
      const en = entranceOf.get(elementId);
      if (!en) return 1;
      if (t <= en.startMs) return 0;
      if (t >= en.startMs + en.durMs) return 1;
      return (t - en.startMs) / en.durMs;
    },
    stageAt(t) {
      let cur = this.stages[0] || null;
      for (const s of this.stages) {
        if (t >= s.startMs) cur = s;
        else break;
      }
      return cur;
    },
    stageById(id) {
      return this.stages.find((s) => s.id === id) || null;
    },
    /** progresso 0..1 dentro do estágio ativo em t. */
    stageProgress(t) {
      const s = this.stageAt(t);
      if (!s) return 0;
      return Math.max(0, Math.min(1, (t - s.startMs) / (s.durationMs || 1)));
    },
  };
}

export const SEQUENCE_STAGE_DEFS = STAGE_DEFS;
