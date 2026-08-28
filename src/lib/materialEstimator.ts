/**
 * Material Estimator - Estimativa de materiais de construção civil
 *
 * Baseado em regras de construção civil brasileira para casas térreas.
 * Saída: lista de materiais com quantidade, unidade e descrição para
 * cada item necessário para subir paredes, contrapiso, reboco e piso.
 *
 * REGRAS-CHAVE:
 * - Tijolo cerâmico 6 furos (9x14x19cm) + junta 1cm = 50 un/m²
 * - Bloco cerâmico (11.5x14x24cm) + junta = 32 un/m²
 * - Bloco concreto (14x19x39cm) + junta = 16.7 un/m²
 * - Argamassa assentamento 1:6 (cimento:areia) = 0.02 m³/m² parede
 * - Reboco 1cm 1:3 = 0.01 m³/m²
 * - Contrapiso 5cm 1:4:4 (cimento:areia:brita) = 0.05 m³/m²
 * - Aço estrutural = 4 kg/m² construído (regra residencial simples)
 * - Perdas: +10% para tijolos, +15% para argamassa
 */

// ============================================
// TIPOS
// ============================================
export interface WallInput {
  length: number;       // metros
  height: number;       // metros (padrão 2.80)
  thickness: number;    // metros
  type: 'exterior' | 'interior' | 'partition';
}

export interface FloorInput {
  area: number;         // m²
  perimetro: number;    // metros lineares
  name?: string;
}

export interface OpeningInput {
  type: 'door' | 'window';
  width: number;        // metros
  height: number;       // metros
  count: number;
}

export interface MaterialEstimateInput {
  walls: WallInput[];
  floors: FloorInput[];
  openings?: OpeningInput[];
  ceilingHeight?: number;        // padrão 2.80
  brickType?: BrickType;         // padrão ceramic-6holes
  includeReboco?: boolean;       // padrão true
  includeContrapiso?: boolean;   // padrão true
  includePiso?: boolean;         // padrão false (depende do piso escolhido)
  includeAco?: boolean;          // padrão true
}

export type BrickType =
  | 'ceramic-6holes'   // 9x14x19cm
  | 'block-ceramic'    // 11.5x14x24cm
  | 'block-concrete';  // 14x19x39cm

export interface MaterialLine {
  category: 'Estrutura' | 'Alvenaria' | 'Revestimento' | 'Piso' | 'Acabamento' | 'Cobertura';
  item: string;
  quantity: number;
  unit: string;
  description: string;
  estimatedCostBRL?: number; // opcional
}

export interface MaterialEstimate {
  totalWallArea: number;       // m²
  totalFloorArea: number;      // m²
  totalPerimetro: number;      // metros lineares
  totalOpeningsArea: number;   // m²
  brickType: BrickType;
  lines: MaterialLine[];
  warnings: string[];
  summary: {
    totalItems: number;
    estimatedWeightKg: number;
  };
  generatedAt: string;
}

// ============================================
// CONSTANTES DE TIJOLOS
// ============================================
const BRICK_SPECS: Record<BrickType, {
  name: string;
  unitPerM2: number;          // unidades por m² de parede
  mortarPerM2: number;        // m³ de argamassa por m²
  unitWeight: number;         // kg/unidade (estimado)
}> = {
  'ceramic-6holes': {
    name: 'Tijolo cerâmico 6 furos (9x14x19cm)',
    unitPerM2: 50,
    mortarPerM2: 0.018,
    unitWeight: 1.5,
  },
  'block-ceramic': {
    name: 'Bloco cerâmico (11.5x14x24cm)',
    unitPerM2: 32,
    mortarPerM2: 0.020,
    unitWeight: 2.2,
  },
  'block-concrete': {
    name: 'Bloco de concreto (14x19x39cm)',
    unitPerM2: 16.7,
    mortarPerM2: 0.022,
    unitWeight: 6.0,
  },
};

// Perdas padrão
const WASTE = {
  bricks: 1.10,       // 10% perdas para tijolos
  mortar: 1.15,       // 15% perdas para argamassa
  floor: 1.10,        // 10% perdas para piso
  contrapiso: 1.10,   // 10% perdas para contrapiso
  reboco: 1.10,       // 10% perdas para reboco
};

// Densidades
const DENSITY = {
  cement: 50,         // kg/saco (volume ≈ 32L)
  sand: 1500,         // kg/m³
  gravel: 1500,       // kg/m³
  steel: 7850,        // kg/m³ (não usado, usamos 4kg/m²)
};

// Traços (cimento : areia : brita)
const MIX_RATIOS = {
  assentamento:  { cement: 1, sand: 6 },           // 1:6
  reboco:        { cement: 1, sand: 3 },           // 1:3
  contrapiso:    { cement: 1, sand: 4, gravel: 4 }, // 1:4:4
  pisoCola:      { cementPerM2: 4 },                // kg/m² (argamassa colante)
};

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================
export function estimateMaterials(input: MaterialEstimateInput): MaterialEstimate {
  const warnings: string[] = [];
  const lines: MaterialLine[] = [];
  const ceilingHeight = input.ceilingHeight ?? 2.80;
  const brickType = input.brickType ?? 'ceramic-6holes';
  const includeReboco = input.includeReboco ?? true;
  const includeContrapiso = input.includeContrapiso ?? true;
  const includePiso = input.includePiso ?? true;
  const includeAco = input.includeAco ?? true;

  // 1) Calcular áreas totais
  const totalWallArea = input.walls.reduce(
    (sum, w) => sum + w.length * (w.height ?? ceilingHeight),
    0
  );
  const totalFloorArea = input.floors.reduce((sum, f) => sum + f.area, 0);
  const totalPerimetro = input.floors.reduce((sum, f) => sum + f.perimetro, 0);

  // 2) Calcular área de aberturas (portas + janelas)
  const totalOpeningsArea = (input.openings ?? []).reduce(
    (sum, op) => sum + op.width * op.height * op.count,
    0
  );

  // 3) Área líquida de alvenaria (descontando aberturas)
  const liquidWallArea = Math.max(0, totalWallArea - totalOpeningsArea);

  if (liquidWallArea < 0.5) {
    warnings.push('Área de paredes muito pequena — verifique as dimensões.');
  }

  // 4) Tijolos
  const brickSpec = BRICK_SPECS[brickType];
  const brickQty = Math.ceil(liquidWallArea * brickSpec.unitPerM2 * WASTE.bricks);
  lines.push({
    category: 'Alvenaria',
    item: brickSpec.name,
    quantity: brickQty,
    unit: 'un',
    description: `${(liquidWallArea).toFixed(2)} m² de parede × ${brickSpec.unitPerM2} un/m² + 10% perdas`,
  });

  // 5) Argamassa de assentamento
  // Volume total de argamassa = área × consumo por m²
  const mortarVolume = liquidWallArea * brickSpec.mortarPerM2 * WASTE.mortar;

  // Traço 1:6 → 1 parte cimento : 6 partes areia (em volume)
  // Cimento: 1/7 do volume total
  // Areia: 6/7 do volume total
  const cementVolumeM3 = mortarVolume * (MIX_RATIOS.assentamento.cement / (MIX_RATIOS.assentamento.cement + MIX_RATIOS.assentamento.sand));
  const sandVolumeM3 = mortarVolume * (MIX_RATIOS.assentamento.sand / (MIX_RATIOS.assentamento.cement + MIX_RATIOS.assentamento.sand));

  // Cimento: 1 saco 50kg = 32L ≈ 0.032m³ → precisa de cementVolumeM3/0.032 sacos
  const cementBagsAssent = Math.ceil(cementVolumeM3 / 0.032);

  lines.push({
    category: 'Alvenaria',
    item: 'Cimento (assentamento)',
    quantity: cementBagsAssent,
    unit: 'sacos 50kg',
    description: `Argamassa 1:6 — ${mortarVolume.toFixed(3)} m³ total (cimento ${(cementVolumeM3*1000).toFixed(1)}L)`,
  });

  // Areia em m³ (1 m³ ≈ 1.4 ton)
  const sandTonsAssent = sandVolumeM3 * (DENSITY.sand / 1000);
  lines.push({
    category: 'Alvenaria',
    item: 'Areia média (assentamento)',
    quantity: Number(sandVolumeM3.toFixed(2)),
    unit: 'm³',
    description: `≈ ${sandTonsAssent.toFixed(2)} ton (${(sandVolumeM3*1000).toFixed(0)}L). Traço 1:6`,
  });

  // 6) Reboco (se habilitado)
  if (includeReboco && liquidWallArea > 0) {
    const rebocoVolume = liquidWallArea * 0.01 * WASTE.reboco; // 1cm espessura
    const cementVolumeReboco = rebocoVolume * (1 / (1 + 3));
    const sandVolumeReboco = rebocoVolume * (3 / (1 + 3));
    const cementBagsReboco = Math.ceil(cementVolumeReboco / 0.032);
    const sandM3Reboco = Number(sandVolumeReboco.toFixed(2));

    lines.push({
      category: 'Revestimento',
      item: 'Cimento (reboco)',
      quantity: cementBagsReboco,
      unit: 'sacos 50kg',
      description: `Reboco 1cm — traço 1:3, ${rebocoVolume.toFixed(3)} m³`,
    });

    lines.push({
      category: 'Revestimento',
      item: 'Areia fina (reboco)',
      quantity: sandM3Reboco,
      unit: 'm³',
      description: `≈ ${(sandM3Reboco * 1.4).toFixed(2)} ton. Para reboco 1cm em ${liquidWallArea.toFixed(2)} m²`,
    });
  }

  // 7) Contrapiso (se habilitado)
  if (includeContrapiso && totalFloorArea > 0) {
    const cpVolume = totalFloorArea * 0.05 * WASTE.contrapiso; // 5cm
    // Traço 1:4:4 → soma = 9
    const cementVolumeCP = cpVolume * (1 / 9);
    const sandVolumeCP = cpVolume * (4 / 9);
    const gravelVolumeCP = cpVolume * (4 / 9);
    const cementBagsCP = Math.ceil(cementVolumeCP / 0.032);

    lines.push({
      category: 'Piso',
      item: 'Cimento (contrapiso)',
      quantity: cementBagsCP,
      unit: 'sacos 50kg',
      description: `Contrapiso 5cm traço 1:4:4 — ${cpVolume.toFixed(3)} m³`,
    });

    lines.push({
      category: 'Piso',
      item: 'Areia grossa (contrapiso)',
      quantity: Number(sandVolumeCP.toFixed(2)),
      unit: 'm³',
      description: `≈ ${(sandVolumeCP * 1.4).toFixed(2)} ton`,
    });

    lines.push({
      category: 'Piso',
      item: 'Brita 1 (contrapiso)',
      quantity: Number(gravelVolumeCP.toFixed(2)),
      unit: 'm³',
      description: `≈ ${(gravelVolumeCP * 1.5).toFixed(2)} ton`,
    });
  }

  // 8) Piso (revestimento final)
  if (includePiso && totalFloorArea > 0) {
    const floorAreaWithWaste = totalFloorArea * WASTE.floor;
    const argamassaColanteKg = totalFloorArea * MIX_RATIOS.pisoCola.cementPerM2;

    lines.push({
      category: 'Acabamento',
      item: 'Revestimento cerâmico (piso)',
      quantity: Number(floorAreaWithWaste.toFixed(2)),
      unit: 'm²',
      description: `Área + 10% perdas. Assentar com argamassa colante.`,
    });

    lines.push({
      category: 'Acabamento',
      item: 'Argamassa colante (AC-II)',
      quantity: Math.ceil(argamassaColanteKg / 20), // sacos 20kg
      unit: 'sacos 20kg',
      description: `≈ ${argamassaColanteKg.toFixed(1)} kg (4kg/m²)`,
    });

    lines.push({
      category: 'Acabamento',
      item: 'Rejunte',
      quantity: Number((floorAreaWithWaste * 0.5 / 5).toFixed(1)),
      unit: 'kg',
      description: `Rendimento médio: 0.5kg/m² para juntas 5mm`,
    });
  }

  // 9) Aço estrutural (regra simplificada 4kg/m² construído)
  if (includeAco && totalFloorArea > 0) {
    const acoKg = totalFloorArea * 4;
    const barras10mm = Math.ceil(acoKg / 0.617); // barra 10mm = 0.617 kg/m, ~12m cada
    const barras8mm = Math.ceil((totalPerimetro * 2 * 0.395) / 12); // estribos
    const arameKg = Number((acoKg * 0.02).toFixed(1)); // 2% do peso em arame

    lines.push({
      category: 'Estrutura',
      item: 'Aço CA-50 10mm (vergalhão)',
      quantity: barras10mm,
      unit: 'barras 12m',
      description: `≈ ${acoKg.toFixed(1)} kg de aço total (regra 4kg/m²)`,
    });

    lines.push({
      category: 'Estrutura',
      item: 'Aço CA-60 5mm (estribos)',
      quantity: barras8mm,
      unit: 'barras 12m',
      description: `Estribos para cintas e reforços`,
    });

    lines.push({
      category: 'Estrutura',
      item: 'Arame recozido',
      quantity: arameKg,
      unit: 'kg',
      description: `Para amarração das armações`,
    });
  }

  // 10) Aberturas (portas + janelas)
  if (input.openings && input.openings.length > 0) {
    const doorCount = input.openings.filter(o => o.type === 'door').reduce((s, o) => s + o.count, 0);
    const windowCount = input.openings.filter(o => o.type === 'window').reduce((s, o) => s + o.count, 0);

    if (doorCount > 0) {
      lines.push({
        category: 'Acabamento',
        item: 'Portas (kits completos)',
        quantity: doorCount,
        unit: 'un',
        description: `Inclui marco, folha, dobradiças e fechadura`,
      });
    }
    if (windowCount > 0) {
      lines.push({
        category: 'Acabamento',
        item: 'Janelas (conjuntos)',
        quantity: windowCount,
        unit: 'un',
        description: `Inclui batente, vidro e ferragens`,
      });
    }
  }

  // 11) Tinta (se reboco habilitado, 1 demão = ~10m²/L, 2 demãos = 5m²/L)
  if (includeReboco && liquidWallArea > 0) {
    const tintaL = Math.ceil((liquidWallArea * 2) / 10); // 2 demãos
    lines.push({
      category: 'Acabamento',
      item: 'Tinta acrílica (parede)',
      quantity: tintaL,
      unit: 'L (galão 18L)',
      description: `Rendimento 10m²/L/demão. 2 demãos = ${liquidWallArea.toFixed(2)}×2m²`,
    });

    const massaAcrilica = Math.ceil(liquidWallArea * 0.8); // ~1.2kg/m² → kg
    lines.push({
      category: 'Acabamento',
      item: 'Massa acrílica',
      quantity: massaAcrilica,
      unit: 'kg',
      description: `≈ 0.8 kg/m² para nivelamento`,
    });
  }

  // 12) Hidráulica + Elétrica (regras simples)
  if (totalFloorArea > 0) {
    const pontosLuz = Math.max(4, Math.ceil(totalFloorArea / 6));
    const pontosTomada = Math.max(6, Math.ceil(totalFloorArea / 5));
    const metCanoPVC25 = Math.ceil(totalPerimetro * 1.2);
    const metFio2_5mm = Math.ceil(totalFloorArea * 4);

    lines.push({
      category: 'Estrutura',
      item: 'Mangueira elétrica (2.5mm²)',
      quantity: metFio2_5mm,
      unit: 'metros',
      description: `≈ 4m/m² para tomadas e iluminação`,
    });

    lines.push({
      category: 'Estrutura',
      item: 'Cano PVC soldável 25mm',
      quantity: metCanoPVC25,
      unit: 'metros',
      description: `Água fria — inclui 20% perdas e conexões`,
    });

    lines.push({
      category: 'Acabamento',
      item: 'Pontos de luz (conjunto)',
      quantity: pontosLuz,
      unit: 'un',
      description: `Inclui fiação, interruptor e luminária`,
    });

    lines.push({
      category: 'Acabamento',
      item: 'Pontos de tomada (conjunto)',
      quantity: pontosTomada,
      unit: 'un',
      description: `Inclui fiação e tomada 10A/20A`,
    });
  }

  // Calcular peso total estimado
  const totalWeightKg = lines.reduce((sum, line) => {
    if (line.unit === 'kg' || line.unit === 'sacos 50kg') {
      const factor = line.unit === 'sacos 50kg' ? 50 : 1;
      return sum + line.quantity * factor;
    }
    return sum;
  }, 0);

  return {
    totalWallArea: Number(totalWallArea.toFixed(2)),
    totalFloorArea: Number(totalFloorArea.toFixed(2)),
    totalPerimetro: Number(totalPerimetro.toFixed(2)),
    totalOpeningsArea: Number(totalOpeningsArea.toFixed(2)),
    brickType,
    lines,
    warnings,
    summary: {
      totalItems: lines.length,
      estimatedWeightKg: Math.round(totalWeightKg),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// CONVERSORES DE TIPOS (do GeminiFloorPlan / axisLineParser)
// ============================================

/**
 * Converte resultado do parser local (axisLineParser) para MaterialEstimateInput
 */
export function fromAxisParser(
  walls: { length: number; thickness: number; type: string; sourceStart?: any; sourceEnd?: any }[],
  rooms: { area: number; name: string; center?: any; floor?: any[] }[],
  ceilingHeight: number = 2.80
): MaterialEstimateInput {
  const wallInputs: WallInput[] = walls.map(w => ({
    length: w.length,
    height: ceilingHeight,
    thickness: w.thickness ?? 0.15,
    type: (w.type === 'exterior' ? 'exterior' : 'interior') as 'exterior' | 'interior',
  }));

  const floorInputs: FloorInput[] = rooms
    .filter(r => r.area > 0)
    .map(r => ({
      area: r.area,
      perimetro: Math.sqrt(r.area) * 4, // aproximação quadrada
      name: r.name,
    }));

  return {
    walls: wallInputs,
    floors: floorInputs,
    ceilingHeight,
  };
}

/**
 * Converte resultado do Gemini (GeminiFloorPlan) para MaterialEstimateInput
 */
export function fromGeminiPlan(
  plan: { widthMeters: number; heightMeters: number; walls: { start: any; end: any; thickness: number; type: string }[]; rooms: { name: string; area: number; polygon: any[] }[] },
  ceilingHeight: number = 2.80
): MaterialEstimateInput {
  const wallInputs: WallInput[] = plan.walls.map(w => {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    return {
      length: Math.sqrt(dx * dx + dy * dy),
      height: ceilingHeight,
      thickness: w.thickness,
      type: (w.type === 'exterior' ? 'exterior' : 'interior') as 'exterior' | 'interior',
    };
  });

  const floorInputs: FloorInput[] = plan.rooms.map(r => {
    // perímetro do polígono
    let perimetro = 0;
    if (r.polygon && r.polygon.length > 1) {
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i];
        const b = r.polygon[(i + 1) % r.polygon.length];
        perimetro += Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      }
    }
    return {
      area: r.area,
      perimetro,
      name: r.name,
    };
  });

  return {
    walls: wallInputs,
    floors: floorInputs,
    ceilingHeight,
  };
}

/**
 * Converte do formato model3d (Zustand store) para MaterialEstimateInput
 */
export function fromModel3D(
  objects: { type: string; dimensions: { length: number; thickness: number; height: number }; isExterior?: boolean }[],
  rooms: { name: string; area: number; polygon: any[] }[],
  ceilingHeight: number = 2.80
): MaterialEstimateInput {
  const wallInputs: WallInput[] = objects
    .filter(o => o.type === 'wall')
    .map(w => ({
      length: w.dimensions.length,
      height: w.dimensions.height || ceilingHeight,
      thickness: w.dimensions.thickness,
      type: w.isExterior ? 'exterior' : 'interior',
    }));

  const floorInputs: FloorInput[] = rooms.map(r => {
    let perimetro = 0;
    if (r.polygon && r.polygon.length > 1) {
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i];
        const b = r.polygon[(i + 1) % r.polygon.length];
        perimetro += Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      }
    }
    return {
      area: r.area,
      perimetro,
      name: r.name,
    };
  });

  return {
    walls: wallInputs,
    floors: floorInputs,
    ceilingHeight,
  };
}

// ============================================
// HELPERS DE FORMATAÇÃO
// ============================================
export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function estimateToText(estimate: MaterialEstimate): string {
  const lines: string[] = [];
  lines.push('=== ESTIMATIVA DE MATERIAIS ===');
  lines.push(`Gerado em: ${new Date(estimate.generatedAt).toLocaleString('pt-BR')}`);
  lines.push(`Área de paredes: ${formatNumber(estimate.totalWallArea, 2)} m²`);
  lines.push(`Área construída: ${formatNumber(estimate.totalFloorArea, 2)} m²`);
  lines.push(`Perímetro total: ${formatNumber(estimate.totalPerimetro, 2)} m`);
  lines.push(`Tijolo: ${BRICK_SPECS[estimate.brickType].name}`);
  lines.push('');

  const byCategory = new Map<string, MaterialLine[]>();
  for (const line of estimate.lines) {
    if (!byCategory.has(line.category)) byCategory.set(line.category, []);
    byCategory.get(line.category)!.push(line);
  }

  for (const [category, items] of byCategory) {
    lines.push(`-- ${category.toUpperCase()} --`);
    for (const item of items) {
      lines.push(`  • ${item.item}: ${formatNumber(item.quantity, item.quantity < 10 ? 1 : 0)} ${item.unit}`);
      lines.push(`    ${item.description}`);
    }
    lines.push('');
  }

  lines.push(`Total de itens: ${estimate.summary.totalItems}`);
  lines.push(`Peso estimado: ${formatNumber(estimate.summary.estimatedWeightKg)} kg`);

  return lines.join('\n');
}

export function estimateToCSV(estimate: MaterialEstimate): string {
  const headers = ['Categoria', 'Item', 'Quantidade', 'Unidade', 'Descrição'];
  const rows = estimate.lines.map(l => [
    l.category,
    l.item,
    formatNumber(l.quantity, 2),
    l.unit,
    l.description.replace(/[\n\r;]/g, ' '),
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${c}"`).join(';'))
    .join('\n');

  return csv;
}
