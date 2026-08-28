// ============================================
// SIMPLE FALLBACK PARSER
// Quando IA falha, gera estrutura baseada em aspect ratio da imagem
// Garante que SEMPRE há saída (4 paredes + divisões)
// ============================================

import type { StructuralPlan, WallSegment, Vertex, Room } from './structuralIntelligence';

export interface SimpleParseResult {
  success: boolean;
  plan: StructuralPlan | null;
  walls: WallSegment[];
  vertices: Vertex[];
  rooms: Room[];
  confidence: number;
  warnings: string[];
}

export class SimpleFallbackParser {
  // Dimensões-padrão de casas brasileiras
  private readonly STANDARDS: [number, number][] = [
    [6, 8], [7, 10], [8, 10], [8, 12], [10, 12], [10, 15], [6, 10], [4, 6], [5, 7],
  ];

  async parse(image: HTMLImageElement, options: { 
    widthMeters?: number; 
    heightMeters?: number;
    roomCount?: number;
  } = {}): Promise<SimpleParseResult> {
    const W = image.width;
    const H = image.height;
    const aspect = W / H;

    // Determina dimensões baseado no aspect ratio
    let totalW: number, totalD: number;
    if (options.widthMeters && options.heightMeters) {
      totalW = options.widthMeters;
      totalD = options.heightMeters;
    } else {
      // Encontra melhor match com dimensões padrão
      let best: [number, number] = [6, 8];
      let bestErr = Infinity;
      for (const [w, h] of this.STANDARDS) {
        const err = Math.abs(w / h - aspect);
        if (err < bestErr) { bestErr = err; best = [w, h]; }
      }
      totalW = best[0];
      totalD = best[1];
    }

    const roomCount = options.roomCount ?? 4;
    const cx = totalW / 2;
    const cz = totalD / 2;

    // Cria paredes: 4 externas + divisões internas baseadas em roomCount
    const walls: WallSegment[] = [];
    const vertices: Vertex[] = [];
    let wid = 0, vid = 0;

    // Vértices do perímetro
    const corners = [
      { x: -cx, z: -cz }, { x: cx, z: -cz }, { x: cx, z: cz }, { x: -cx, z: cz },
    ];
    for (const c of corners) {
      vertices.push({ id: `V${++vid}`, x: c.x, y: 0, z: c.z, type: 'corner', description: '' });
    }

    // 4 paredes externas
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      walls.push({
        id: `W${++wid}`,
        startVertexId: `V${vid - 3 + i}`,
        endVertexId: `V${vid - 3 + ((i + 1) % 4)}`,
        length: Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2),
        thickness: 0.25,
        height: 2.80,
        type: 'exterior',
        orientation: Math.abs(b.z - a.z) < 0.01 ? 'horizontal' : 'vertical',
        sourceStart: { x: 0, y: 0 },
        sourceEnd: { x: 0, y: 0 },
      });
    }

    // Divisões internas baseadas no número de cômodos
    if (roomCount === 1) {
      // Sem divisões
    } else if (roomCount === 2) {
      // 1 parede central vertical
      const v: Vertex = { id: `V${++vid}`, x: 0, y: 0, z: 0, type: 'intersection', description: '' };
      vertices.push(v);
      walls.push({
        id: `W${++wid}`,
        startVertexId: v.id,
        endVertexId: v.id,
        length: totalD,
        thickness: 0.15,
        height: 2.80,
        type: 'interior',
        orientation: 'vertical',
        sourceStart: { x: 0, y: 0 },
        sourceEnd: { x: 0, y: 0 },
      });
    } else if (roomCount === 4) {
      // 1 horizontal + 1 vertical (4 quartos)
      // Vertical no centro
      const v1: Vertex = { id: `V${++vid}`, x: 0, y: 0, z: -cz, type: 'intersection', description: '' };
      const v2: Vertex = { id: `V${++vid}`, x: 0, y: 0, z: cz, type: 'intersection', description: '' };
      vertices.push(v1, v2);
      walls.push({
        id: `W${++wid}`,
        startVertexId: v1.id, endVertexId: v2.id,
        length: totalD, thickness: 0.15, height: 2.80,
        type: 'interior', orientation: 'vertical',
        sourceStart: { x: 0, y: 0 }, sourceEnd: { x: 0, y: 0 },
      });
      // Horizontal no centro
      const v3: Vertex = { id: `V${++vid}`, x: -cx, y: 0, z: 0, type: 'intersection', description: '' };
      const v4: Vertex = { id: `V${++vid}`, x: cx, y: 0, z: 0, type: 'intersection', description: '' };
      vertices.push(v3, v4);
      walls.push({
        id: `W${++wid}`,
        startVertexId: v3.id, endVertexId: v4.id,
        length: totalW, thickness: 0.15, height: 2.80,
        type: 'interior', orientation: 'horizontal',
        sourceStart: { x: 0, y: 0 }, sourceEnd: { x: 0, y: 0 },
      });
    } else if (roomCount === 5) {
      // Casa 6x8 clássica: Sala + 2 quartos + cozinha + WC
      walls.push({
        id: `W${++wid}`,
        startVertexId: 'V1', endVertexId: 'V2',
        length: totalW, thickness: 0.15, height: 2.80,
        type: 'interior', orientation: 'horizontal',
        sourceStart: { x: 0, y: 0 }, sourceEnd: { x: 0, y: 0 },
      });
    }

    // Cômodos
    const halfW = totalW / 2;
    const halfD = totalD / 2;
    const rooms: Room[] = [];
    if (roomCount <= 2) {
      rooms.push({
        id: 'R1', name: 'Sala', type: 'living', walls: [],
        floor: [{ x: -cx, y: -cz }, { x: cx, y: -cz }, { x: cx, y: cz }, { x: -cx, y: cz }],
        area: totalW * totalD,
        center: { x: 0, y: 0 },
      });
    } else if (roomCount === 4) {
      rooms.push(
        { id: 'R1', name: 'Sala', type: 'living', walls: [], floor: [{ x: -cx, y: -cz }, { x: 0, y: -cz }, { x: 0, y: 0 }, { x: -cx, y: 0 }], area: halfW * halfD, center: { x: -halfW / 2, y: -halfD / 2 } },
        { id: 'R2', name: 'Cozinha', type: 'kitchen', walls: [], floor: [{ x: 0, y: -cz }, { x: cx, y: -cz }, { x: cx, y: 0 }, { x: 0, y: 0 }], area: halfW * halfD, center: { x: halfW / 2, y: -halfD / 2 } },
        { id: 'R3', name: 'Quarto 1', type: 'bedroom', walls: [], floor: [{ x: -cx, y: 0 }, { x: 0, y: 0 }, { x: 0, y: cz }, { x: -cx, y: cz }], area: halfW * halfD, center: { x: -halfW / 2, y: halfD / 2 } },
        { id: 'R4', name: 'Quarto 2', type: 'bedroom', walls: [], floor: [{ x: 0, y: 0 }, { x: cx, y: 0 }, { x: cx, y: cz }, { x: 0, y: cz }], area: halfW * halfD, center: { x: halfW / 2, y: halfD / 2 } },
      );
    } else {
      rooms.push(
        { id: 'R1', name: 'Sala', type: 'living', walls: [], floor: [{ x: -cx, y: -cz }, { x: cx, y: -cz }, { x: cx, y: 0 }, { x: -cx, y: 0 }], area: totalW * halfD, center: { x: 0, y: -halfD / 2 } },
        { id: 'R2', name: 'Cozinha', type: 'kitchen', walls: [], floor: [{ x: -cx, y: 0 }, { x: 0, y: 0 }, { x: 0, y: cz }, { x: -cx, y: cz }], area: halfW * halfD, center: { x: -halfW / 2, y: halfD / 2 } },
        { id: 'R3', name: 'WC', type: 'bathroom', walls: [], floor: [{ x: 0, y: 0 }, { x: cx / 2, y: 0 }, { x: cx / 2, y: halfD }, { x: 0, y: halfD }], area: (cx / 2) * halfD, center: { x: cx / 4, y: halfD / 2 } },
        { id: 'R4', name: 'Quarto 1', type: 'bedroom', walls: [], floor: [{ x: cx / 2, y: 0 }, { x: cx, y: 0 }, { x: cx, y: halfD }, { x: cx / 2, y: halfD }], area: (cx / 2) * halfD, center: { x: 3 * cx / 4, y: halfD / 2 } },
        { id: 'R5', name: 'Quarto 2', type: 'bedroom', walls: [], floor: [{ x: 0, y: halfD }, { x: cx, y: halfD }, { x: cx, y: cz }, { x: 0, y: cz }], area: totalW * halfD, center: { x: 0, y: 3 * halfD / 2 } },
      );
    }

    const plan: StructuralPlan = {
      projectName: 'Pl Padrão (Fallback)',
      totalArea: totalW * totalD,
      totalWidth: totalW,
      totalDepth: totalD,
      wallHeight: 2.80,
      floors: 1,
      vertices,
      walls,
      dimensions: [],
      rooms,
    };

    return {
      success: true,
      plan,
      walls,
      vertices,
      rooms,
      confidence: 0.3,
      warnings: ['Estrutura gerada por fallback (IA não disponível)'],
    };
  }
}

export const simpleFallbackParser = new SimpleFallbackParser();
