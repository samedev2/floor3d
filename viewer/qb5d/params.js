// =====================================================================
// QB5D — params.js
// Tabelas de pré-dimensionamento (ABNT/NBR) usadas pelo gerador estrutural.
//
// IMPORTANTE: são valores de ANTEPROJETO / regra de bolso, todos editáveis
// pela UI. NÃO substituem cálculo estrutural de engenheiro (NBR 6118, 6122,
// 8681). O objetivo é coordenar geometria + sequência + quantitativo, não
// dimensionar armadura.
//
// Unidades: SI. Comprimentos em metros salvo sufixo "_cm" / "_mm".
// =====================================================================

// Concreto armado moldado in loco + alvenaria de vedação (não portante).
export const DEFAULT_PARAMS = {
  // ---- Geometria de referência da obra --------------------------------
  peDireito_m: 2.80,        // piso a face inferior da laje de forro
  espessuraPiso_m: 0.10,    // contrapiso + laje de piso térreo (radier/contrapiso)
  nivelTerreno_m: 0.00,     // cota 0 = topo do baldrame / face sup. do radier

  // ---- Pilares (NBR 6118 §13.2.3) ------------------------------------
  pilar: {
    espacamentoMax_m: 4.5,  // vão econômico típico para laje maciça residencial
    espacamentoMin_m: 2.2,  // abaixo disso, funde pilares vizinhos
    // Seção mínima absoluta NBR 6118: menor dim >= 19 cm e área >= 360 cm².
    // (14 cm é permitido só com majoração γn — fora do escopo do anteprojeto.)
    larguraMin_cm: 14,      // alinha à espessura de bloco de vedação de 14
    larguraMax_cm: 19,
    profundidadeMin_cm: 19,
    profundidadeMax_cm: 30,
    // profundidade cresce ~ com a área de influência (m² de laje que ele carrega)
    profPorAreaInfluencia_cm_por_m2: 0.9,
    taxaAco_kg_por_m3: 100,
  },

  // ---- Vigas (NBR 6118 §13.2.2) ------------------------------------
  viga: {
    larguraMin_cm: 12,      // >= 12 cm (14 recomendado p/ caber na alvenaria)
    larguraPadrao_cm: 14,
    // altura útil ~ L/10 (biapoiada) .. L/12 (contínua). Usamos L/11.
    alturaPorVao_ratio: 1 / 11,
    alturaMin_cm: 25,
    alturaMax_cm: 60,
    // baldrame (viga de fundação) — mesma largura, altura fixa mínima
    baldrameAltura_cm: 30,
    baldrameCota_m: -0.30,  // face superior do baldrame abaixo da cota 0
    // cinta / viga de respaldo no topo da alvenaria
    respaldoAltura_cm: 12,
    taxaAco_kg_por_m3: 110,
  },

  // ---- Lajes (NBR 6118 §13.2.4.1) ----------------------------------
  laje: {
    // maciça: h >= L/40 (forro) .. L/35 (piso); mínimo 8 cm p/ cobertura,
    // 10 cm p/ piso. Acima de ~5 m de vão sugere nervurada.
    espessuraPorVao_ratio_piso: 1 / 36,
    espessuraPorVao_ratio_cobertura: 1 / 40,
    espessuraMin_cm: 8,
    espessuraMax_cm: 16,
    vaoNervurada_m: 5.0,    // vão > isto => marca tipo "nervurada"
    taxaAco_kg_por_m3: 85,
    // cobertura
    caimentoCobertura_pct: 1.0,
    impermeabilizacao: true,
  },

  // ---- Fundação (NBR 6122) — seleção automática pelo porte ----------
  // Escolha por área construída total E maior vão livre entre apoios.
  // Ordem de tentativa: radier -> sapata corrida -> sapata isolada -> estaca.
  fundacao: {
    modo: "auto",           // "auto" | "radier" | "sapata_corrida" | "sapata_isolada" | "estaca"
    // limiares (regra de bolso p/ solo de capacidade média ~0,2 MPa):
    radier_areaMax_m2: 70,          // casas térreas compactas
    radier_espessura_cm: 12,        // laje + bordas enrijecidas (pré-dim.)
    sapataCorrida_areaMax_m2: 120,  // térreo, paredes bem distribuídas
    sapataCorrida_largura_cm: 40,
    sapataCorrida_altura_cm: 30,
    sapataIsolada_areaMax_m2: 300,  // acima disso ou 2+ pav. => estaca
    sapataIsolada_ladoMin_cm: 80,
    sapataIsolada_ladoPorCarga_cm_por_m2: 3.5, // lado ~ f(área de influência do pilar)
    sapataIsolada_altura_cm: 30,
    estaca_diametro_cm: 25,
    estaca_profundidade_m: 6.0,
    bloco_coroamento_lado_cm: 60,
    bloco_coroamento_altura_cm: 40,
    lastroConcretoMagro_cm: 5,
    folgaEscavacao_m: 0.15, // sobra de escavação por lado
  },

  // ---- Alvenaria de vedação ---------------------------------------
  alvenaria: {
    // preset selecionado (chave em BLOCK_PRESETS); espessura vem do preset
    presetPadrao: "ceramico9",
    juntaArgamassa_cm: 1.0,
    // revestimento
    chapisco: true,
    rebocoInterno_cm: 2.0,
    rebocoExterno_cm: 2.5,
    // vãos
    vergaFolga_m: 0.20,     // verga/contraverga ultrapassa o vão por lado
    vergaAltura_cm: 10,
    peitorilJanela_m: 1.10,
    alturaPorta_m: 2.10,
    alturaJanela_m: 1.20,
  },
};

// Blocos/tijolos comuns no Brasil. `esp_cm` = espessura da parede acabada
// SEM revestimento. Consumos são referência de orçamento (variam por
// fornecedor / junta / técnica) — editáveis na UI.
export const BLOCK_PRESETS = {
  ceramico9:  { label: "Bloco cerâmico 9×19×19 (1/2 vez)", esp_cm: 9,  unidPorM2: 24,  argamassaM3PorM2: 0.010 },
  ceramico14: { label: "Bloco cerâmico 14×19×29",           esp_cm: 14, unidPorM2: 16,  argamassaM3PorM2: 0.013 },
  ceramico19: { label: "Bloco cerâmico 19×19×39",           esp_cm: 19, unidPorM2: 12.5, argamassaM3PorM2: 0.017 },
  concreto14: { label: "Bloco de concreto 14×19×39",        esp_cm: 14, unidPorM2: 12.5, argamassaM3PorM2: 0.014 },
  concreto19: { label: "Bloco de concreto 19×19×39",        esp_cm: 19, unidPorM2: 12.5, argamassaM3PorM2: 0.018 },
  baiano9:    { label: "Tijolo baiano vazado 9×19×39",      esp_cm: 9,  unidPorM2: 24,  argamassaM3PorM2: 0.010 },
  macico:     { label: "Tijolo maciço 5×10×20",             esp_cm: 10, unidPorM2: 78,  argamassaM3PorM2: 0.020 },
};

// Preços unitários de referência (BRL) — DESLIGADOS por padrão (5D opcional).
// Sem curva regional embutida; o usuário preenche o que fizer sentido.
export const DEFAULT_PRICES_BRL = {
  concreto_m3: 0,        // usinado fck 25, lançado
  forma_m2: 0,           // chapa + montagem + desmontagem
  aco_kg: 0,             // CA-50 cortado e dobrado
  alvenaria_m2: 0,       // bloco + assentamento
  reboco_m2: 0,
  escavacao_m3: 0,
  concreto_magro_m3: 0,
};

// Camadas do modelo — id, rótulo, cor base (hex) e nível vertical nominal.
// A ordem aqui é a ordem construtiva (usada por sequence.js como fallback).
// Cores = cor do MATERIAL do elemento no 3D (concreto claro tipo maquete,
// alvenaria com cor de tijolo — a textura de fiada é aplicada por cima).
export const LAYERS = [
  { id: "terreno",     label: "Terreno / locação",     color: 0x8d7b68 },
  { id: "escavacao",   label: "Escavação",             color: 0x6f5b45 },
  { id: "lastro",      label: "Lastro / magro",        color: 0xc4c4c0 },
  { id: "fundacao",    label: "Fundação",              color: 0xdadde0 },
  { id: "baldrame",    label: "Vigas baldrame",        color: 0xdadde0 },
  { id: "pilar",       label: "Pilares",               color: 0xdfe1e3 },
  { id: "laje_piso",   label: "Contrapiso",            color: 0xcfcabb },
  { id: "alvenaria",   label: "Alvenaria de vedação",  color: 0xb0512c },
  { id: "verga",       label: "Vergas / contravergas", color: 0xd8dade },
  { id: "esquadria",   label: "Portas e janelas",      color: 0x9a8158 },
  { id: "mobilia",     label: "Louças e mobília",      color: 0x5f9ea0 },
  { id: "viga",        label: "Vigas",                 color: 0xdfe1e3 },
  { id: "laje_cob",    label: "Laje de cobertura",     color: 0xe4e2dc },
  { id: "instalacoes", label: "Instalações (Fase 2)",  color: 0x3b82f6 },
  { id: "acabamento",  label: "Reboco / acabamento",   color: 0xe8e2d6 },
];

// Cor da alvenaria depois de chapisco + reboco (fase de acabamento).
export const PLASTER_COLOR = 0xe9e4d8;

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

// Peso relativo de densidade de aço nula/positiva por elemento — usado só
// para checagem rápida; o número real vem de params.<elem>.taxaAco_kg_por_m3.
export const CONCRETE_DENSITY_KG_M3 = 2500;
export const MORTAR_CEMENT_BAGS_PER_M3 = 8;   // traço 1:2:8 aprox., saco 50 kg
export const RENDER_CEMENT_BAGS_PER_M3 = 7;
