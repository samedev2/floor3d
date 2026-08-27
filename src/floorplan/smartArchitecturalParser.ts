// ============================================
// SMART ARCHITECTURAL PARSER
// Detecta paredes em uma planta 2D usando análise
// de histograma + clustering de linhas/colunas.
//
// Estratégia:
//   1. Filtra pixels de parede (vermelho OU cinza-escuro)
//   2. Calcula histograma: pixels vermelhos por linha e por coluna
//   3. Encontra PICOS: linhas/colunas com muito mais vermelho que vizinhas
//      (cada pico = posição de uma parede)
//   4. Para cada pico, determina o range X (ou Y) de pixels vermelhos
//      (começo e fim da parede)
//   5. Constrói paredes + vértices + cômodos
// ============================================

import type { StructuralPlan, WallSegment, Vertex, Room } from './structuralIntelligence';

export interface ParseResult {
  success: boolean;
  plan: StructuralPlan | null;
  walls: WallSegment[];
  vertices: Vertex[];
  rooms: Room[];
  confidence: number;
  warnings: string[];
  errors: string[];
  stats: {
    imageW: number;
    imageH: number;
    wallPixels: number;
    horizontalWalls: number;
    verticalWalls: number;
    verticesFound: number;
    roomsFound: number;
    detectedWidthM: number;
    detectedHeightM: number;
  };
}

interface Wall2D {
  start: { x: number; y: number };
  end: { x: number; y: number };
  orientation: 'horizontal' | 'vertical';
}

export class SmartArchitecturalParser {
  // Filtro de cor
  private readonly RED_MIN_R = 130;
  private readonly RED_MAX_G = 100;
  private readonly RED_MAX_B = 100;
  private readonly DARK_MAX_RGB = 80;

  // Margem (corte de título/margens)
  private readonly MARGIN_TOP_FRACTION = 0.13;
  private readonly MARGIN_BOTTOM_FRACTION = 0.02;
  private readonly MARGIN_LEFT_FRACTION = 0.02;
  private readonly MARGIN_RIGHT_FRACTION = 0.02;

  // Dimensões-padrão de casas brasileiras (largura × profundidade)
  private readonly STANDARDS: [number, number][] = [
    [6, 8], [7, 10], [8, 10], [8, 12], [10, 12], [10, 15], [6, 10], [4, 6], [5, 7],
  ];

  // ============================================
  // PIPELINE
  // ============================================
  async parse(
    image: HTMLImageElement,
    options: { hintWidth?: number; hintHeight?: number } = {}
  ): Promise<ParseResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Canvas + pixels
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const W = canvas.width;
      const H = canvas.height;

      // 2. Máscara de pixels de parede
      const { wallMask, wallCount } = this.buildWallMask(data, W, H);

      if (wallCount < 500) {
        errors.push('Poucos pixels de parede detectados. Use uma imagem com maior contraste.');
        return this.emptyResult(W, H, wallCount, 0, 0, 0, 0, warnings, errors);
      }

      // 3. Calcula histograma por linha/coluna
      const rowHist = this.buildHistogram(wallMask, W, H, 'row');
      const colHist = this.buildHistogram(wallMask, W, H, 'col');

      // 4. Corta margens (remove título, legendas)
      const yStart = Math.floor(H * this.MARGIN_TOP_FRACTION);
      const yEnd = H - Math.floor(H * this.MARGIN_BOTTOM_FRACTION);
      const xStart = Math.floor(W * this.MARGIN_LEFT_FRACTION);
      const xEnd = W - Math.floor(W * this.MARGIN_RIGHT_FRACTION);

      // 5. Encontra picos (linhas/colunas com muito mais vermelho que mediana)
      const hPeaks = this.findPeaks(rowHist, yStart, yEnd);
      const vPeaks = this.findPeaks(colHist, xStart, xEnd);

      if (hPeaks.length < 2 || vPeaks.length < 2) {
        warnings.push(`Poucos picos: ${hPeaks.length} horizontais, ${vPeaks.length} verticais.`);
        return this.emptyResult(W, H, wallCount, hPeaks.length, vPeaks.length, 0, 0, warnings, errors);
      }

      // 6. Para cada pico horizontal, determina o range X da parede
      const hWalls: Wall2D[] = [];
      for (const peak of hPeaks) {
        const range = this.findWallRangeInRow(wallMask, W, H, peak.pos, xStart, xEnd);
        if (range) {
          hWalls.push({ start: { x: range.start, y: peak.pos }, end: { x: range.end, y: peak.pos }, orientation: 'horizontal' });
        }
      }

      // 7. Para cada pico vertical, determina o range Y
      const vWalls: Wall2D[] = [];
      for (const peak of vPeaks) {
        const range = this.findWallRangeInCol(wallMask, W, H, peak.pos, yStart, yEnd);
        if (range) {
          vWalls.push({ start: { x: peak.pos, y: range.start }, end: { x: peak.pos, y: range.end }, orientation: 'vertical' });
        }
      }

      if (hWalls.length + vWalls.length < 4) {
        warnings.push('Paredes insuficientes após filtragem.');
        return this.emptyResult(W, H, wallCount, hWalls.length, vWalls.length, 0, 0, warnings, errors);
      }

      // 7.5. Mescla paredes próximas (remove duplicatas de paredes espessas)
      this.mergeNearbyWalls(hWalls);
      this.mergeNearbyWalls(vWalls);

      // 7.6. Filtra paredes muito curtas (provavelmente ruído)
      const minWallPx = Math.min(W, H) * 0.05; // 5% da menor dimensão
      const hFiltered = hWalls.filter(w => Math.abs(w.end.x - w.start.x) >= minWallPx);
      const vFiltered = vWalls.filter(w => Math.abs(w.end.y - w.start.y) >= minWallPx);
      hWalls.length = 0; hWalls.push(...hFiltered);
      vWalls.length = 0; vWalls.push(...vFiltered);

      if (hWalls.length + vWalls.length < 4) {
        warnings.push('Paredes insuficientes após merge.');
        return this.emptyResult(W, H, wallCount, hWalls.length, vWalls.length, 0, 0, warnings, errors);
      }

      // 8. Vértices
      const { vertices: verts, vertexByPixel } = this.findVertices(hWalls, vWalls);

      // 9. Escala
      const scale = this.determineScale(hWalls, vWalls, W, H, options.hintWidth, options.hintHeight);

      // 10. Constrói paredes em metros
      const cx = scale.totalWidth / 2;
      const cz = scale.totalDepth / 2;
      const ppm = scale.pixelsPerMeter;

      const walls: WallSegment[] = [];
      let wid = 0;
      for (const w of hWalls) {
        const sV = vertexByPixel.get(`${w.start.x},${w.start.y}`);
        const eV = vertexByPixel.get(`${w.end.x},${w.end.y}`);
        if (!sV || !eV) continue;
        wid++;
        walls.push({
          id: `W_H_${wid}`,
          startVertexId: sV,
          endVertexId: eV,
          length: Math.abs(w.end.x - w.start.x) / ppm,
          thickness: 0.15,
          height: 2.80,
          type: 'interior',
          orientation: 'horizontal',
          sourceStart: { x: w.start.x, y: w.start.y },
          sourceEnd: { x: w.end.x, y: w.end.y },
        });
      }
      for (const w of vWalls) {
        const sV = vertexByPixel.get(`${w.start.x},${w.start.y}`);
        const eV = vertexByPixel.get(`${w.end.x},${w.end.y}`);
        if (!sV || !eV) continue;
        wid++;
        walls.push({
          id: `W_V_${wid}`,
          startVertexId: sV,
          endVertexId: eV,
          length: Math.abs(w.end.y - w.start.y) / ppm,
          thickness: 0.15,
          height: 2.80,
          type: 'interior',
          orientation: 'vertical',
          sourceStart: { x: w.start.x, y: w.start.y },
          sourceEnd: { x: w.end.x, y: w.end.y },
        });
      }

      // 11. Cômodos
      const rooms = this.detectRooms(verts, walls, ppm, cx, cz);

      // 12. Classifica externa vs interna
      this.classifyExternalWalls(walls, scale.totalWidth, scale.totalDepth);

      // 13. Vértices em metros
      const verticesM = verts.map(v => ({
        id: v.id,
        x: v.px / ppm - cx,
        y: v.py / ppm - cz,
        z: 0,
        type: v.type,
        description: '',
      }));

      const plan: StructuralPlan = {
        projectName: 'Planta Detectada',
        totalArea: scale.totalWidth * scale.totalDepth,
        totalWidth: scale.totalWidth,
        totalDepth: scale.totalDepth,
        wallHeight: 2.80,
        floors: 1,
        vertices: verticesM,
        walls,
        dimensions: [],
        rooms,
      };

      return {
        success: walls.length >= 4 && rooms.length >= 1,
        plan,
        walls,
        vertices: verticesM,
        rooms,
        confidence: Math.min(1, (walls.length / 12) * 0.4 + (rooms.length / 4) * 0.3 + 0.3),
        warnings,
        errors,
        stats: {
          imageW: W,
          imageH: H,
          wallPixels: wallCount,
          horizontalWalls: hWalls.length,
          verticalWalls: vWalls.length,
          verticesFound: verts.length,
          roomsFound: rooms.length,
          detectedWidthM: scale.totalWidth,
          detectedHeightM: scale.totalDepth,
        },
      };
    } catch (e) {
      errors.push('Erro no parser: ' + (e instanceof Error ? e.message : String(e)));
      return this.emptyResult(0, 0, 0, 0, 0, 0, 0, warnings, errors);
    }
  }

  // ============================================
  // FILTRO DE COR
  // ============================================
  private buildWallMask(data: Uint8ClampedArray, W: number, H: number): { wallMask: Uint8Array; wallCount: number } {
    const wallMask = new Uint8Array(W * H);
    let wallCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const isRed = r >= this.RED_MIN_R && g <= this.RED_MAX_G && b <= this.RED_MAX_B;
      const isDark = r <= this.DARK_MAX_RGB && g <= this.DARK_MAX_RGB && b <= this.DARK_MAX_RGB;
      if (isRed || isDark) {
        wallMask[i / 4] = 1;
        wallCount++;
      }
    }
    return { wallMask, wallCount };
  }

  // ============================================
  // HISTOGRAMA: pixels de parede por linha ou coluna
  // ============================================
  private buildHistogram(mask: Uint8Array, W: number, H: number, axis: 'row' | 'col'): number[] {
    if (axis === 'row') {
      const hist = new Array(H).fill(0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (mask[y * W + x]) hist[y]++;
        }
      }
      return hist;
    } else {
      const hist = new Array(W).fill(0);
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          if (mask[y * W + x]) hist[x]++;
        }
      }
      return hist;
    }
  }

  // ============================================
  // ENCONTRA PICOS: linhas/colunas com histograma
  // significativamente acima da mediana local
  // ============================================
  private findPeaks(hist: number[], start: number, end: number): { pos: number; value: number }[] {
    if (end <= start) return [];

    // Calcula percentis
    const values: number[] = [];
    for (let i = start; i < end; i++) values.push(hist[i]);
    values.sort((a, b) => a - b);
    const p75 = values[Math.floor(values.length * 0.75)];
    const p90 = values[Math.floor(values.length * 0.90)];

    // Threshold: precisa estar no top 5% do histograma
    // (paredes são as linhas/colunas com mais pixels vermelhos)
    const threshold = Math.max(p90, p75 * 1.5, 30);

    // Encontra picos com non-maximum suppression
    const peaks: { pos: number; value: number }[] = [];
    const suppressionRadius = 10;
    for (let i = start; i < end; i++) {
      if (hist[i] < threshold) continue;
      // Verifica se é um máximo local na janela
      let isMax = true;
      for (let j = Math.max(start, i - 3); j <= Math.min(end - 1, i + 3); j++) {
        if (j !== i && hist[j] > hist[i]) { isMax = false; break; }
      }
      if (!isMax) continue;
      // Suprime picos próximos
      if (peaks.length > 0 && i - peaks[peaks.length - 1].pos < suppressionRadius) {
        if (hist[i] > peaks[peaks.length - 1].value) {
          peaks[peaks.length - 1] = { pos: i, value: hist[i] };
        }
        continue;
      }
      peaks.push({ pos: i, value: hist[i] });
    }

    // Se não encontrou nenhum pico com threshold alto, relaxa
    if (peaks.length === 0) {
      const relaxedThreshold = Math.max(p75, 15);
      for (let i = start; i < end; i++) {
        if (hist[i] < relaxedThreshold) continue;
        let isMax = true;
        for (let j = Math.max(start, i - 3); j <= Math.min(end - 1, i + 3); j++) {
          if (j !== i && hist[j] > hist[i]) { isMax = false; break; }
        }
        if (!isMax) continue;
        if (peaks.length > 0 && i - peaks[peaks.length - 1].pos < suppressionRadius) {
          if (hist[i] > peaks[peaks.length - 1].value) {
            peaks[peaks.length - 1] = { pos: i, value: hist[i] };
          }
          continue;
        }
        peaks.push({ pos: i, value: hist[i] });
      }
    }
    return peaks;
  }

  // ============================================
  // RANGE X DA PAREDE: para uma linha y (pico horizontal)
  // encontra a extensão X dos pixels vermelhos
  // Verifica também DENSIDADE: paredes têm pixels vermelhos em
  // ≥ 50% do range (dimensão/tick marks têm < 30%)
  // ============================================
  private findWallRangeInRow(mask: Uint8Array, W: number, _H: number, y: number, xStart: number, xEnd: number): { start: number; end: number } | null {
    let minX = Infinity, maxX = -Infinity;
    let redCount = 0;
    for (let x = xStart; x < xEnd; x++) {
      if (mask[y * W + x]) {
        redCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (minX === Infinity || maxX - minX < 20) return null;
    // Verifica densidade: o número de pixels vermelhos na linha deve ser
    // uma fração significativa da linha (≥ 30%)
    const rowLength = xEnd - xStart;
    if (redCount < rowLength * 0.30) return null;
    return { start: minX, end: maxX };
  }

  // ============================================
  // RANGE Y DA PAREDE: para uma coluna x (pico vertical)
  // ============================================
  private findWallRangeInCol(mask: Uint8Array, W: number, _H: number, x: number, yStart: number, yEnd: number): { start: number; end: number } | null {
    let minY = Infinity, maxY = -Infinity;
    let redCount = 0;
    for (let y = yStart; y < yEnd; y++) {
      if (mask[y * W + x]) {
        redCount++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (minY === Infinity || maxY - minY < 20) return null;
    const colLength = yEnd - yStart;
    if (redCount < colLength * 0.30) return null;
    return { start: minY, end: maxY };
  }

  // ============================================
  // MESCLA PAREDES PRÓXIMAS
  // Remove duplicatas: se duas paredes horizontais estão dentro de
  // MERGE_TOLERANCE_PX pixels no Y, mescla em uma só
  // ============================================
  private mergeNearbyWalls(walls: Wall2D[]): void {
    if (walls.length < 2) return;
    const isHorizontal = walls[0].orientation === 'horizontal';
    const tol = 8;
    const sorted = [...walls].sort((a, b) => {
      if (isHorizontal) return a.start.y - b.start.y || a.start.x - b.start.x;
      return a.start.x - b.start.x || a.start.y - b.start.y;
    });
    const merged: Wall2D[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];
      if (isHorizontal) {
        if (Math.abs(prev.start.y - curr.start.y) <= tol) {
          // Mescla: estende X e usa Y médio
          const minX = Math.min(prev.start.x, prev.end.x, curr.start.x, curr.end.x);
          const maxX = Math.max(prev.start.x, prev.end.x, curr.start.x, curr.end.x);
          const yMid = Math.round((prev.start.y + curr.start.y) / 2);
          prev.start = { x: minX, y: yMid };
          prev.end = { x: maxX, y: yMid };
        } else {
          merged.push(curr);
        }
      } else {
        if (Math.abs(prev.start.x - curr.start.x) <= tol) {
          const minY = Math.min(prev.start.y, prev.end.y, curr.start.y, curr.end.y);
          const maxY = Math.max(prev.start.y, prev.end.y, curr.start.y, curr.end.y);
          const xMid = Math.round((prev.start.x + curr.start.x) / 2);
          prev.start = { x: xMid, y: minY };
          prev.end = { x: xMid, y: maxY };
        } else {
          merged.push(curr);
        }
      }
    }
    walls.length = 0;
    walls.push(...merged);
  }

  // ============================================
  // VÉRTICES: cruzamentos de paredes H e V
  // ============================================
  private findVertices(hWalls: Wall2D[], vWalls: Wall2D[]): {
    vertices: { id: string; px: number; py: number; type: 'corner' | 'intersection' | 'endpoint' }[];
    vertexByPixel: Map<string, string>;
  } {
    const vertices: { id: string; px: number; py: number; type: 'corner' | 'intersection' | 'endpoint' }[] = [];
    const vertexByPixel = new Map<string, string>();
    const TOL = 10;

    const addVertex = (px: number, py: number, type: 'corner' | 'intersection' | 'endpoint' = 'endpoint'): string => {
      // Procura vértice próximo (não mesclado ainda)
      for (const v of vertices) {
        if (Math.abs(v.px - px) <= TOL && Math.abs(v.py - py) <= TOL) {
          if (type === 'intersection' && v.type === 'endpoint') v.type = 'intersection';
          vertexByPixel.set(`${px},${py}`, v.id);
          return v.id;
        }
      }
      // Cria novo
      const id = `V${vertices.length + 1}`;
      vertices.push({ id, px, py, type });
      vertexByPixel.set(`${px},${py}`, id);
      return id;
    };

    // Adiciona endpoints de paredes horizontais
    for (const w of hWalls) {
      addVertex(w.start.x, w.start.y);
      addVertex(w.end.x, w.end.y);
    }
    // Adiciona endpoints de paredes verticais (vai mesclar com horizontais)
    for (const w of vWalls) {
      addVertex(w.start.x, w.start.y);
      addVertex(w.end.x, w.end.y);
    }
    // Adiciona cruzamentos
    for (const h of hWalls) {
      for (const v of vWalls) {
        if (v.start.x >= h.start.x - TOL && v.start.x <= h.end.x + TOL
         && h.start.y >= v.start.y - TOL && h.start.y <= v.end.y + TOL) {
          addVertex(v.start.x, h.start.y, 'intersection');
        }
      }
    }

    return { vertices, vertexByPixel };
  }

  // ============================================
  // ESCALA
  // ============================================
  private determineScale(
    hWalls: Wall2D[],
    vWalls: Wall2D[],
    _W: number, _H: number,
    hintW?: number, hintH?: number
  ): { pixelsPerMeter: number; totalWidth: number; totalDepth: number } {
    let maxH = 0, maxV = 0;
    for (const w of hWalls) {
      const l = Math.abs(w.end.x - w.start.x);
      if (l > maxH) maxH = l;
    }
    for (const w of vWalls) {
      const l = Math.abs(w.end.y - w.start.y);
      if (l > maxV) maxV = l;
    }
    if (maxH === 0 && maxV === 0) {
      return { pixelsPerMeter: 50, totalWidth: 1, totalDepth: 1 };
    }

    if (hintW && hintH) {
      const ppm = maxH / hintW;
      return { pixelsPerMeter: ppm, totalWidth: hintW, totalDepth: hintH };
    }

    // Aspect ratio das maiores paredes
    const aspectRatio = maxV / (maxH || 1);

    // Casa mais alta que larga: maxV é a profundidade
    let totalWidth: number, totalDepth: number;
    if (aspectRatio >= 1) {
      totalDepth = 8;
      totalWidth = totalDepth / aspectRatio;
    } else {
      totalWidth = 6;
      totalDepth = totalWidth * aspectRatio;
    }

    // Encontra melhor match nas dimensões-padrão
    let bestMatch: [number, number] = [Math.round(totalWidth), Math.round(totalDepth)];
    let bestError = Infinity;
    for (const [w, h] of this.STANDARDS) {
      const expectedRatio = h / w;
      const error = Math.abs(expectedRatio - aspectRatio);
      if (error < bestError) {
        bestError = error;
        bestMatch = [w, h];
      }
    }

    // Calcula pixelsPerMeter
    let pixelsPerMeter: number;
    if (aspectRatio >= 1) {
      pixelsPerMeter = maxV / bestMatch[1];
    } else {
      pixelsPerMeter = maxH / bestMatch[0];
    }

    return {
      pixelsPerMeter,
      totalWidth: bestMatch[0],
      totalDepth: bestMatch[1],
    };
  }

  // ============================================
  // CÔMODOS: encontra polígonos fechados
  // ============================================
  private detectRooms(
    vertices: { id: string; px: number; py: number }[],
    walls: WallSegment[],
    ppm: number, cx: number, cz: number
  ): Room[] {
    const graph = new Map<string, Set<string>>();
    const addEdge = (a: string, b: string) => {
      if (!graph.has(a)) graph.set(a, new Set());
      if (!graph.has(b)) graph.set(b, new Set());
      graph.get(a)!.add(b);
      graph.get(b)!.add(a);
    };
    for (const w of walls) addEdge(w.startVertexId, w.endVertexId);

    const visitedEdges = new Set<string>();
    const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const rooms: Room[] = [];
    const vCoords = new Map(vertices.map(v => [v.id, { x: v.px, y: v.py }]));

    for (const startV of graph.keys()) {
      for (const nextV of graph.get(startV)!) {
        const eKey = edgeKey(startV, nextV);
        if (visitedEdges.has(eKey)) continue;
        const cycle = this.findCycle(startV, nextV, graph, visitedEdges);
        if (cycle.length >= 3) {
          const poly = cycle.map(vid => {
            const c = vCoords.get(vid)!;
            return { x: c.x / ppm - cx, y: c.y / ppm - cz };
          });
          const area = this.polygonArea(poly);
          if (area > 0.4 && area < 200) {
            rooms.push({
              id: `R${rooms.length + 1}`,
              name: `Cômodo ${rooms.length + 1}`,
              type: 'unknown',
              walls: cycle.flatMap((vid, i) => {
                const next = cycle[(i + 1) % cycle.length];
                const w = walls.find(w =>
                  (w.startVertexId === vid && w.endVertexId === next) ||
                  (w.startVertexId === next && w.endVertexId === vid)
                );
                return w ? [w.id] : [];
              }),
              floor: poly,
              area,
              center: {
                x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
                y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
              },
            });
          }
        }
      }
    }
    return rooms;
  }

  private findCycle(
    start: string,
    current: string,
    graph: Map<string, Set<string>>,
    visitedEdges: Set<string>
  ): string[] {
    const path: string[] = [start];
    const visited = new Set<string>([start]);
    return this.dfsCycle(start, current, graph, visited, path, visitedEdges);
  }
  private dfsCycle(
    start: string,
    current: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    path: string[],
    visitedEdges: Set<string>
  ): string[] {
    for (const next of graph.get(current) || []) {
      const eKey = start < next ? `${start}|${next}` : `${next}|${start}`;
      if (visitedEdges.has(eKey)) continue;
      if (next === start && path.length >= 3) {
        for (let i = 0; i < path.length - 1; i++) {
          const a = path[i], b = path[i + 1];
          visitedEdges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
        }
        visitedEdges.add(eKey);
        return [...path];
      }
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const result = this.dfsCycle(start, next, graph, visited, path, visitedEdges);
      if (result.length > 0) return result;
      path.pop();
      visited.delete(next);
    }
    return [];
  }

  private polygonArea(poly: { x: number; y: number }[]): number {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      area += poly[i].x * poly[j].y;
      area -= poly[j].x * poly[i].y;
    }
    return Math.abs(area) / 2;
  }

  // ============================================
  // PAREDE EXTERNA: se toca o bounding box externo
  // ============================================
  private classifyExternalWalls(walls: WallSegment[], _totalW: number, _totalD: number): void {
    for (const w of walls) {
      if (!w.sourceStart || !w.sourceEnd) continue;
      w.thickness = w.thickness || 0.15;
    }
  }

  // ============================================
  // HELPER
  // ============================================
  private emptyResult(
    W: number, H: number, wallPx: number,
    hWalls: number, vWalls: number, verts: number, roomsCount: number,
    warnings: string[], errors: string[]
  ): ParseResult {
    return {
      success: false,
      plan: null,
      walls: [], vertices: [], rooms: [],
      confidence: 0,
      warnings, errors,
      stats: {
        imageW: W, imageH: H,
        wallPixels: wallPx,
        horizontalWalls: hWalls,
        verticalWalls: vWalls,
        verticesFound: verts,
        roomsFound: roomsCount,
        detectedWidthM: 0, detectedHeightM: 0,
      },
    };
  }
}

export const smartArchitecturalParser = new SmartArchitecturalParser();
