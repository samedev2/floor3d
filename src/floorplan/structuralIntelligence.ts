// ============================================
// STRUCTURAL INTELLIGENCE
// Análise estrutural detalhada da planta desenhada à mão
// Extrai: vértices, paredes, parâmetros horizontais e verticais
// ============================================

export interface Vertex {
  id: string;
  x: number; // metros
  y: number; // metros  
  z: number; // altura (sempre 0 para planta 2D)
  type: 'corner' | 'intersection' | 'endpoint';
  description?: string;
}

export interface WallSegment {
  id: string;
  startVertexId: string;
  endVertexId: string;
  length: number; // metros
  thickness: number; // metros
  height: number; // metros
  type: 'exterior' | 'interior' | 'partition';
  orientation: 'horizontal' | 'vertical' | 'diagonal';
  hasOpening?: 'door' | 'window' | null;
  openingWidth?: number;
  // Reference to source 2D coordinates
  sourceStart?: { x: number; y: number };
  sourceEnd?: { x: number; y: number };
}

export interface Dimension {
  id: string;
  value: number;
  unit: 'm' | 'cm';
  axis: 'horizontal' | 'vertical';
  position: { x: number; y: number };
  // Referência à parede medida
  referenceWalls: string[];
}

export interface Room {
  id: string;
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'corridor' | 'staircase' | 'unknown';
  walls: string[]; // IDs das paredes
  floor: { x: number; y: number }[]; // polígono
  area: number; // m²
  center: { x: number; y: number };
}

export interface StructuralPlan {
  projectName: string;
  totalArea: number;
  totalWidth: number; // metros
  totalDepth: number; // metros
  wallHeight: number; // metros
  floors: number;
  vertices: Vertex[];
  walls: WallSegment[];
  dimensions: Dimension[];
  rooms: Room[];
}

// ============================================
// ANÁLISE DA PLANTA ENVIADA (2 pavimentos, 7.50m x 11.25m)
// ============================================
export const HAND_DRAWN_PLAN: StructuralPlan = {
  projectName: 'Casa 2 Pavimentos',
  totalArea: 84.375, // 7.5 x 11.25
  totalWidth: 7.50,
  totalDepth: 11.25,
  wallHeight: 2.80,
  floors: 2,
  
  // Vértices da estrutura (cantos e interseções)
  vertices: [
    // Perímetro externo (canto inferior esquerdo é origem 0,0)
    { id: 'V1', x: 0, y: 0, z: 0, type: 'corner', description: 'Canto inferior esquerdo (frente-esquerda)' },
    { id: 'V2', x: 7.50, y: 0, z: 0, type: 'corner', description: 'Canto inferior direito (frente-direita)' },
    { id: 'V3', x: 7.50, y: 11.25, z: 0, type: 'corner', description: 'Canto superior direito (fundo-direita)' },
    { id: 'V4', x: 0, y: 11.25, z: 0, type: 'corner', description: 'Canto superior esquerdo (fundo-esquerda)' },
    
    // Vértices internos
    { id: 'V5', x: 0, y: 3.50, z: 0, type: 'intersection', description: 'Divisão Quarto 1' },
    { id: 'V6', x: 3.50, y: 3.50, z: 0, type: 'intersection', description: 'Cruzamento central' },
    { id: 'V7', x: 3.50, y: 0, z: 0, type: 'intersection', description: 'Entrada Sala/Cozinha' },
    { id: 'V8', x: 0, y: 5.00, z: 0, type: 'intersection', description: 'Banheiro' },
    { id: 'V9', x: 1.50, y: 5.00, z: 0, type: 'intersection', description: 'Canto banheiro' },
    { id: 'V10', x: 1.50, y: 7.00, z: 0, type: 'intersection', description: 'Quarto 2' },
    { id: 'V11', x: 0, y: 7.00, z: 0, type: 'intersection', description: 'Quarto 2 fundo' },
    { id: 'V12', x: 3.50, y: 7.00, z: 0, type: 'intersection', description: 'Cruzamento corredor' },
    { id: 'V13', x: 3.50, y: 11.25, z: 0, type: 'intersection', description: 'Corredor final' },
    { id: 'V14', x: 7.50, y: 7.00, z: 0, type: 'intersection', description: 'Cozinha fundo' },
    { id: 'V15', x: 7.50, y: 5.00, z: 0, type: 'intersection', description: 'Cozinha meio' },
    { id: 'V16', x: 4.50, y: 5.00, z: 0, type: 'intersection', description: 'Sala fundo' },
    { id: 'V17', x: 4.50, y: 0, z: 0, type: 'intersection', description: 'Sala entrada' },
  ],
  
  // Paredes (todas com base nas cotas visíveis)
  walls: [
    // === PAREDES EXTERNAS (perímetro) ===
    {
      id: 'W_EXT_1',
      startVertexId: 'V1', endVertexId: 'V2',
      length: 7.50, thickness: 0.25, height: 2.80,
      type: 'exterior', orientation: 'horizontal',
      hasOpening: 'window',
      openingWidth: 1.50,
    },
    {
      id: 'W_EXT_2',
      startVertexId: 'V2', endVertexId: 'V3',
      length: 11.25, thickness: 0.25, height: 2.80,
      type: 'exterior', orientation: 'vertical',
      hasOpening: 'door',
      openingWidth: 0.90,
    },
    {
      id: 'W_EXT_3',
      startVertexId: 'V3', endVertexId: 'V4',
      length: 7.50, thickness: 0.25, height: 2.80,
      type: 'exterior', orientation: 'horizontal',
      hasOpening: 'window',
      openingWidth: 1.20,
    },
    {
      id: 'W_EXT_4',
      startVertexId: 'V4', endVertexId: 'V1',
      length: 11.25, thickness: 0.25, height: 2.80,
      type: 'exterior', orientation: 'vertical',
      hasOpening: 'window',
      openingWidth: 1.50,
    },
    
    // === PAREDES INTERNAS ===
    {
      id: 'W_INT_1', // Sala - Cozinha (horizontal)
      startVertexId: 'V7', endVertexId: 'V17',
      length: 1.00, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'horizontal',
      hasOpening: 'door',
      openingWidth: 0.80,
    },
    {
      id: 'W_INT_2', // Sala - Quarto 1 (vertical, à esquerda)
      startVertexId: 'V5', endVertexId: 'V6',
      length: 3.50, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'vertical',
      hasOpening: 'door',
      openingWidth: 0.80,
    },
    {
      id: 'W_INT_3', // Sala - Corredor (horizontal, fundo)
      startVertexId: 'V6', endVertexId: 'V12',
      length: 3.50, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'horizontal',
      hasOpening: null,
    },
    {
      id: 'W_INT_4', // Quarto 1 - Banheiro (vertical)
      startVertexId: 'V5', endVertexId: 'V8',
      length: 1.50, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'vertical',
      hasOpening: 'door',
      openingWidth: 0.70,
    },
    {
      id: 'W_INT_5', // Banheiro (horizontal)
      startVertexId: 'V8', endVertexId: 'V9',
      length: 1.50, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'horizontal',
    },
    {
      id: 'W_INT_6', // Banheiro - Quarto 2 (vertical)
      startVertexId: 'V9', endVertexId: 'V10',
      length: 2.00, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'vertical',
      hasOpening: 'door',
      openingWidth: 0.70,
    },
    {
      id: 'W_INT_7', // Quarto 2 fundo
      startVertexId: 'V11', endVertexId: 'V10',
      length: 1.50, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'horizontal',
    },
    {
      id: 'W_INT_8', // Quarto 2 - Corredor
      startVertexId: 'V10', endVertexId: 'V12',
      length: 2.00, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'horizontal',
      hasOpening: 'door',
      openingWidth: 0.80,
    },
    {
      id: 'W_INT_9', // Corredor (vertical)
      startVertexId: 'V12', endVertexId: 'V13',
      length: 4.25, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'vertical',
    },
    {
      id: 'W_INT_10', // Cozinha (horizontal, fundo)
      startVertexId: 'V14', endVertexId: 'V15',
      length: 2.00, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'vertical',
      hasOpening: 'window',
      openingWidth: 1.20,
    },
    {
      id: 'W_INT_11', // Sala fundo
      startVertexId: 'V16', endVertexId: 'V17',
      length: 4.50, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'horizontal',
    },
    {
      id: 'W_INT_12', // Sala/Cozinha divisória
      startVertexId: 'V16', endVertexId: 'V6',
      length: 1.00, thickness: 0.15, height: 2.80,
      type: 'interior', orientation: 'vertical',
    },
  ],
  
  // Cotas extraídas
  dimensions: [
    { id: 'D1', value: 7.50, unit: 'm', axis: 'horizontal', position: { x: 3.75, y: -0.5 }, referenceWalls: ['W_EXT_1', 'W_EXT_3'] },
    { id: 'D2', value: 11.25, unit: 'm', axis: 'vertical', position: { x: -0.5, y: 5.625 }, referenceWalls: ['W_EXT_2', 'W_EXT_4'] },
    { id: 'D3', value: 3.50, unit: 'm', axis: 'horizontal', position: { x: 1.75, y: 3.7 }, referenceWalls: ['W_INT_2'] },
    { id: 'D4', value: 2.00, unit: 'm', axis: 'vertical', position: { x: 0.7, y: 6.0 }, referenceWalls: ['W_INT_6'] },
    { id: 'D5', value: 1.50, unit: 'm', axis: 'horizontal', position: { x: 0.75, y: 5.2 }, referenceWalls: ['W_INT_5'] },
    { id: 'D6', value: 3.00, unit: 'm', axis: 'vertical', position: { x: 1.7, y: 8.0 }, referenceWalls: [] },
    { id: 'D7', value: 4.00, unit: 'm', axis: 'horizontal', position: { x: 2.0, y: 0.3 }, referenceWalls: [] },
    { id: 'D8', value: 1.50, unit: 'm', axis: 'horizontal', position: { x: 2.5, y: 0.3 }, referenceWalls: [] },
    { id: 'D9', value: 3.50, unit: 'm', axis: 'horizontal', position: { x: 5.0, y: 7.2 }, referenceWalls: [] },
  ],
  
  // Ambientes detectados
  rooms: [
    {
      id: 'R_SALA', name: 'Sala', type: 'living',
      walls: ['W_EXT_1', 'W_EXT_2', 'W_INT_11', 'W_INT_1', 'W_INT_12'],
      floor: [
        { x: 3.50, y: 0 }, { x: 7.50, y: 0 },
        { x: 7.50, y: 5.00 }, { x: 4.50, y: 5.00 },
        { x: 4.50, y: 0 }, { x: 3.50, y: 0 }
      ],
      area: 15.00, // ~4m x 3.75m
      center: { x: 5.50, y: 2.50 }
    },
    {
      id: 'R_COZINHA', name: 'Cozinha', type: 'kitchen',
      walls: ['W_EXT_2', 'W_EXT_3', 'W_INT_10', 'W_INT_11', 'W_INT_12'],
      floor: [
        { x: 4.50, y: 0 }, { x: 7.50, y: 0 },
        { x: 7.50, y: 7.00 }, { x: 4.50, y: 7.00 },
        { x: 4.50, y: 0 }
      ],
      area: 22.50, // 3m x 7.5m
      center: { x: 6.00, y: 3.50 }
    },
    {
      id: 'R_QUARTO_1', name: 'Quarto 1', type: 'bedroom',
      walls: ['W_EXT_4', 'W_INT_2', 'W_INT_4', 'W_INT_3'],
      floor: [
        { x: 0, y: 0 }, { x: 3.50, y: 0 },
        { x: 3.50, y: 3.50 }, { x: 0, y: 3.50 }
      ],
      area: 12.25,
      center: { x: 1.75, y: 1.75 }
    },
    {
      id: 'R_BANHEIRO', name: 'Banheiro', type: 'bathroom',
      walls: ['W_INT_4', 'W_INT_5', 'W_INT_6', 'W_EXT_4'],
      floor: [
        { x: 0, y: 3.50 }, { x: 1.50, y: 3.50 },
        { x: 1.50, y: 5.00 }, { x: 0, y: 5.00 }
      ],
      area: 2.25,
      center: { x: 0.75, y: 4.25 }
    },
    {
      id: 'R_QUARTO_2', name: 'Quarto 2', type: 'bedroom',
      walls: ['W_INT_5', 'W_INT_7', 'W_INT_8', 'W_EXT_4'],
      floor: [
        { x: 0, y: 5.00 }, { x: 1.50, y: 5.00 },
        { x: 1.50, y: 7.00 }, { x: 0, y: 7.00 }
      ],
      area: 3.00,
      center: { x: 0.75, y: 6.00 }
    },
    {
      id: 'R_CORREDOR', name: 'Corredor', type: 'corridor',
      walls: ['W_INT_3', 'W_INT_8', 'W_INT_9', 'W_EXT_3'],
      floor: [
        { x: 1.50, y: 7.00 }, { x: 7.50, y: 7.00 },
        { x: 7.50, y: 11.25 }, { x: 0, y: 11.25 },
        { x: 0, y: 7.00 }, { x: 1.50, y: 7.00 }
      ],
      area: 28.125,
      center: { x: 4.50, y: 9.00 }
    },
  ],
};

// ============================================
// PROJETO CASA 6x8 (5 cômodos: 2 Quartos, Cozinha, Wc, Sala)
// 6m largura × 8m profundidade = 48m²
// ============================================
export const CASA_6X8_PLAN: StructuralPlan = {
  projectName: 'Projeto de Casa 6x8',
  totalArea: 48.0,
  totalWidth: 6.0,
  totalDepth: 8.0,
  wallHeight: 2.80,
  floors: 1,

  // Vértices — origem (0,0) no canto inferior-esquerdo
  // Planta:
  //   y=8  +-------+-------+
  //        |  Q1   |  C    |   <- Quarto 3x3, Cozinha 3x3
  //   y=5  +-------+       |
  //        |  Wc   |       |   <- Wc 1.95x1.4
  //   y=3.6+--+    |       |
  //        |  |    |       |
  //        |  Q2   |  S    |   <- Quarto 3x3, Sala 3x5
  //   y=0  +--+----+-------+
  //        x=0 x=1.95 x=3  x=6
  vertices: [
    // Perímetro externo
    { id: 'V1', x: 0,   y: 0,   z: 0, type: 'corner',       description: 'Canto inferior esquerdo' },
    { id: 'V2', x: 6,   y: 0,   z: 0, type: 'corner',       description: 'Canto inferior direito' },
    { id: 'V3', x: 6,   y: 8,   z: 0, type: 'corner',       description: 'Canto superior direito' },
    { id: 'V4', x: 0,   y: 8,   z: 0, type: 'corner',       description: 'Canto superior esquerdo' },
    // Divisões verticais
    { id: 'V5', x: 3,   y: 0,   z: 0, type: 'intersection', description: 'Divisão Sala/Quarto 2 (baixo)' },
    { id: 'V6', x: 3,   y: 5,   z: 0, type: 'intersection', description: 'Divisão Sala/Cozinha (em cima de V5)' },
    { id: 'V7', x: 3,   y: 8,   z: 0, type: 'intersection', description: 'Topo da divisória central' },
    // Divisões horizontais
    { id: 'V8',  x: 0,   y: 5,   z: 0, type: 'intersection', description: 'Canto entre Q1 e Wc' },
    { id: 'V9',  x: 0,   y: 3,   z: 0, type: 'intersection', description: 'Canto entre Q2 e corredor' },
    { id: 'V10', x: 1.95, y: 5,   z: 0, type: 'intersection', description: 'Topo da direita do Wc' },
    { id: 'V11', x: 1.95, y: 3.6, z: 0, type: 'intersection', description: 'Baixo da direita do Wc' },
  ],

  // Paredes
  walls: [
    // === PERÍMETRO EXTERNO (4 paredes) ===
    { id: 'W_EXT_1', startVertexId: 'V1', endVertexId: 'V2', length: 6.0,  thickness: 0.25, height: 2.80, type: 'exterior', orientation: 'horizontal', hasOpening: 'door',   openingWidth: 0.90 },
    { id: 'W_EXT_2', startVertexId: 'V2', endVertexId: 'V3', length: 8.0,  thickness: 0.25, height: 2.80, type: 'exterior', orientation: 'vertical',   hasOpening: 'window', openingWidth: 1.20 },
    { id: 'W_EXT_3', startVertexId: 'V3', endVertexId: 'V4', length: 6.0,  thickness: 0.25, height: 2.80, type: 'exterior', orientation: 'horizontal', hasOpening: 'window', openingWidth: 1.20 },
    { id: 'W_EXT_4', startVertexId: 'V4', endVertexId: 'V1', length: 8.0,  thickness: 0.25, height: 2.80, type: 'exterior', orientation: 'vertical',   hasOpening: 'window', openingWidth: 1.20 },

    // === DIVISÓRIA CENTRAL VERTICAL (entre Quarto/Cozinha e Sala) ===
    { id: 'W_INT_1', startVertexId: 'V5', endVertexId: 'V6', length: 5.0,  thickness: 0.15, height: 2.80, type: 'interior', orientation: 'vertical', hasOpening: 'door',   openingWidth: 0.80 },
    { id: 'W_INT_2', startVertexId: 'V6', endVertexId: 'V7', length: 3.0,  thickness: 0.15, height: 2.80, type: 'interior', orientation: 'vertical', hasOpening: null },

    // === DIVISÓRIA HORIZONTAL SUPERIOR (entre Quarto 1 e Wc) ===
    { id: 'W_INT_3', startVertexId: 'V8',  endVertexId: 'V10', length: 1.95, thickness: 0.15, height: 2.80, type: 'interior', orientation: 'horizontal', hasOpening: null },
    // Continuidade da horizontal entre V10 e V6
    { id: 'W_INT_4', startVertexId: 'V10', endVertexId: 'V6',  length: 1.05, thickness: 0.15, height: 2.80, type: 'interior', orientation: 'horizontal', hasOpening: 'door',   openingWidth: 0.80 },

    // === DIVISÓRIA HORIZONTAL INFERIOR (entre Quarto 2 e corredor/Sala) ===
    { id: 'W_INT_5', startVertexId: 'V9',  endVertexId: 'V11', length: 1.95, thickness: 0.15, height: 2.80, type: 'interior', orientation: 'horizontal', hasOpening: 'door',   openingWidth: 0.80 },
    { id: 'W_INT_6', startVertexId: 'V11', endVertexId: 'V5',  length: 1.05, thickness: 0.15, height: 2.80, type: 'interior', orientation: 'horizontal', hasOpening: null },

    // === PAREDES DO WC (laterais) ===
    { id: 'W_INT_7', startVertexId: 'V10', endVertexId: 'V11', length: 1.4,  thickness: 0.15, height: 2.80, type: 'interior', orientation: 'vertical',   hasOpening: 'door',   openingWidth: 0.70 },
  ],

  // Cotas (apenas referência)
  dimensions: [
    { id: 'D1', value: 6.0,  unit: 'm', axis: 'horizontal', position: { x: 3.0, y: -0.3 }, referenceWalls: ['W_EXT_1', 'W_EXT_3'] },
    { id: 'D2', value: 8.0,  unit: 'm', axis: 'vertical',   position: { x: -0.3, y: 4.0 }, referenceWalls: ['W_EXT_2', 'W_EXT_4'] },
    { id: 'D3', value: 3.0,  unit: 'm', axis: 'horizontal', position: { x: 1.5, y: 5.2 },  referenceWalls: [] },
    { id: 'D4', value: 3.0,  unit: 'm', axis: 'horizontal', position: { x: 1.5, y: 2.8 },  referenceWalls: [] },
    { id: 'D5', value: 1.95, unit: 'm', axis: 'horizontal', position: { x: 0.975, y: 5.2 }, referenceWalls: ['W_INT_3'] },
    { id: 'D6', value: 1.4,  unit: 'm', axis: 'vertical',   position: { x: 2.1, y: 4.3 },   referenceWalls: ['W_INT_7'] },
    { id: 'D7', value: 4.55, unit: 'm', axis: 'vertical',   position: { x: 6.3, y: 2.275 }, referenceWalls: [] },
  ],

  // Ambientes (5 cômodos)
  rooms: [
    {
      id: 'R_Q1', name: 'Quarto 1', type: 'bedroom',
      walls: ['W_EXT_4', 'W_INT_3', 'W_INT_2', 'W_EXT_3'],
      floor: [
        { x: 0, y: 5 }, { x: 3, y: 5 }, { x: 3, y: 8 }, { x: 0, y: 8 }
      ],
      area: 9.0,
      center: { x: 1.5, y: 6.5 }
    },
    {
      id: 'R_COZINHA', name: 'Cozinha Americana', type: 'kitchen',
      walls: ['W_EXT_3', 'W_EXT_2', 'W_INT_2', 'W_INT_4'],
      floor: [
        { x: 3, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 8 }, { x: 3, y: 8 }
      ],
      area: 9.0,
      center: { x: 4.5, y: 6.5 }
    },
    {
      id: 'R_WC', name: 'Wc', type: 'bathroom',
      walls: ['W_INT_3', 'W_INT_7', 'W_INT_5', 'W_EXT_4'],
      floor: [
        { x: 0,    y: 3.6 }, { x: 1.95, y: 3.6 },
        { x: 1.95, y: 5   }, { x: 0,    y: 5   }
      ],
      area: 2.73,
      center: { x: 0.975, y: 4.3 }
    },
    {
      id: 'R_Q2', name: 'Quarto 2', type: 'bedroom',
      walls: ['W_EXT_4', 'W_INT_5', 'W_INT_6', 'W_INT_1'],
      floor: [
        { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }
      ],
      area: 9.0,
      center: { x: 1.5, y: 1.5 }
    },
    {
      id: 'R_SALA', name: 'Sala', type: 'living',
      walls: ['W_EXT_1', 'W_EXT_2', 'W_INT_4', 'W_INT_6', 'W_INT_1'],
      floor: [
        { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 3, y: 5 }
      ],
      area: 15.0,
      center: { x: 4.5, y: 2.5 }
    },
  ],
};

// ============================================
// BUILDER - Gera SemanticObjects a partir do plano
// ============================================
import { SemanticObject, RoomData, LAYERS, DimensionalContext } from './typesExtensions';

export function buildStructuralPlan(
  plan: StructuralPlan = HAND_DRAWN_PLAN,
  context: DimensionalContext
): { objects: SemanticObject[]; rooms: RoomData[] } {
  const objects: SemanticObject[] = [];
  const rooms: RoomData[] = [];

  // Build walls from vertices
  plan.walls.forEach(wall => {
    const startV = plan.vertices.find(v => v.id === wall.startVertexId);
    const endV = plan.vertices.find(v => v.id === wall.endVertexId);
    
    if (!startV || !endV) return;

    // Convert vertex coords to world space (centered at origin)
    const startWorld = {
      x: startV.x - context.originX / context.pixelsPerMeter,
      z: startV.y - context.originY / context.pixelsPerMeter,
    };
    const endWorld = {
      x: endV.x - context.originX / context.pixelsPerMeter,
      z: endV.y - context.originY / context.pixelsPerMeter,
    };

    const dx = endWorld.x - startWorld.x;
    const dz = endWorld.z - startWorld.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    objects.push({
      id: `wall_${wall.id}`,
      type: 'wall',
      source_2d: wall.id,
      position: [
        (startWorld.x + endWorld.x) / 2,
        plan.wallHeight / 2,
        (startWorld.z + endWorld.z) / 2,
      ],
      rotation: [0, -angle, 0],
      dimensions: { length, thickness: wall.thickness, height: plan.wallHeight },
      confidence: 1.0,
      editable: true,
      layer: LAYERS.WALLS,
      isExterior: wall.type === 'exterior',
    });

    // Add door/window openings
    if (wall.hasOpening === 'door') {
      objects.push({
        id: `door_${wall.id}`,
        type: 'door',
        source_2d: wall.id,
        position: [
          (startWorld.x + endWorld.x) / 2,
          1.0,
          (startWorld.z + endWorld.z) / 2,
        ],
        rotation: [0, -angle, 0],
        dimensions: { length: wall.openingWidth || 0.9, thickness: 0.05, height: 2.10 },
        confidence: 0.9,
        editable: true,
        layer: LAYERS.DOORS,
      });
    } else if (wall.hasOpening === 'window') {
      objects.push({
        id: `window_${wall.id}`,
        type: 'window',
        source_2d: wall.id,
        position: [
          (startWorld.x + endWorld.x) / 2,
          1.4,
          (startWorld.z + endWorld.z) / 2,
        ],
        rotation: [0, -angle, 0],
        dimensions: { length: wall.openingWidth || 1.2, thickness: 0.05, height: 1.20 },
        confidence: 0.9,
        editable: true,
        layer: LAYERS.WINDOWS,
      });
    }
  });

  // Build rooms
  plan.rooms.forEach(room => {
    const polygonWorld = room.floor.map(p => ({
      x: p.x - context.originX / context.pixelsPerMeter,
      z: p.y - context.originY / context.pixelsPerMeter,
    }));
    
    rooms.push({
      id: room.id,
      name: room.name,
      type: room.type as any,
      walls: room.walls,
      polygon: polygonWorld,
      area: room.area,
      center: {
        x: room.center.x - context.originX / context.pixelsPerMeter,
        z: room.center.y - context.originY / context.pixelsPerMeter,
      },
    });

    // Add floor
    const xs = polygonWorld.map(p => p.x);
    const zs = polygonWorld.map(p => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);

    objects.push({
      id: `floor_${room.id}`,
      type: 'floor',
      source_2d: room.id,
      position: [(minX + maxX) / 2, 0.01, (minZ + maxZ) / 2],
      rotation: [0, 0, 0],
      dimensions: { length: maxX - minX, thickness: maxZ - minZ, height: 0.01 },
      confidence: 0.95,
      editable: true,
      layer: LAYERS.FLOORS,
      roomId: room.id,
      name: room.name,
    });

    // Add ceiling
    objects.push({
      id: `ceiling_${room.id}`,
      type: 'ceiling',
      source_2d: room.id,
      position: [(minX + maxX) / 2, plan.wallHeight, (minZ + maxZ) / 2],
      rotation: [0, 0, 0],
      dimensions: { length: maxX - minX, thickness: maxZ - minZ, height: 0.01 },
      confidence: 0.95,
      editable: true,
      layer: LAYERS.CEILINGS,
      roomId: room.id,
      name: room.name,
    });
  });

  return { objects, rooms };
}
