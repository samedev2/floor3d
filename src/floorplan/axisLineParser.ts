// ============================================
// AXIS-ALIGNED LINE PARSER
// Detecta paredes em uma planta 2D de forma DIRETA:
// só procura linhas alinhadas em 0°/90° (horizontais/verticais).
//
// Algoritmo (sem Hough, sem OpenCV):
//   1. Converte para grayscale
//   2. Aplica OTSU threshold (lida com fundo texturizado)
//   3. Encontra, em cada LINHA, a maior sequência contígua
//      de pixels pretos (= uma parede horizontal candidata)
//   4. Encontra, em cada COLUNA, a maior sequência contígua
//      de pixels pretos (= uma parede vertical candidata)
//   5. Filtra por comprimento mínimo (elimina furniture/textura)
//   6. Agrupa linhas adjacentes (mesma orientação, posição próxima)
//   7. Para cada grupo, toma o extent total (de onde começa a onde termina)
//   8. Constrói vértices, cômodos e plano final
//
// Saída: SEMPRE produz ao menos 4 paredes (perímetro de fallback)
//        se nada for detectado. Nunca falha.
// ============================================

import type { StructuralPlan, WallSegment, Vertex, Room } from './structuralIntelligence';

export interface AxisParseResult {
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
    horizontalCandidates: number;
    verticalCandidates: number;
    horizontalWalls: number;
    verticalWalls: number;
    wallsAfterMerge: number;
    roomsDetected: number;
    detectedWidthM: number;
    detectedDepthM: number;
    processingTimeMs: number;
  };
}

interface Wall2D {
  start: { x: number; y: number };
  end: { x: number; y: number };
  orientation: 'horizontal' | 'vertical';
  length: number;
  span: number; // posição central para clusterização
}

export class AxisLineParser {
  // Dimensões-padrão de casas brasileiras (largura × profundidade)
  private readonly STANDARDS: [number, number][] = [
    [6, 8], [7, 10], [8, 10], [8, 12], [10, 12], [10, 15], [6, 10], [4, 6], [5, 7], [12, 16],
  ];

  // Fração mínima de pixels pretos em uma linha/coluna para
  // ser considerada como potencialmente contendo uma parede
  private readonly DENSITY_THRESHOLD = 0.18; // 18% da largura/altura

  // Fração mínima do tamanho da imagem para uma parede
  // ser considerada estrutural (não furniture)
  // Usa fração do MAIOR lado (mais estável em imagens de proporções variadas)
  private readonly MIN_LENGTH_FRACTION = 0.10; // 10% do maior lado

  // Tamanho absoluto mínimo (em pixels) para evitar paredes muito curtas
  private readonly MIN_LENGTH_ABS = 30; // 30 pixels mínimo absoluto

  // Tolerância para mesclar paredes paralelas adjacentes
  private readonly MERGE_TOLERANCE_FRACTION = 0.04; // ~4% da menor dimensão

  // Margens
  private readonly MARGIN_TOP = 0.05;
  private readonly MARGIN_BOTTOM = 0.05;
  private readonly MARGIN_LEFT = 0.05;
  private readonly MARGIN_RIGHT = 0.05;

  async parse(
    image: HTMLImageElement,
    options: { hintWidth?: number; hintHeight?: number; onProgress?: (msg: string) => void } = {}
  ): Promise<AxisParseResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];
    const onProgress = options.onProgress;

    try {
      onProgress?.('Carregando imagem...');
      // 1. Canvas + grayscale + OTSU
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const W = canvas.width;
      const H = canvas.height;

      onProgress?.('Calculando OTSU...');
      const threshold = this.computeOtsuThreshold(data, W, H);

      onProgress?.('Criando máscara binária...');
      const mask = this.buildBinaryMask(data, W, H, threshold);

      // 2. Margens (corta título/legendas)
      const yStart = Math.floor(H * this.MARGIN_TOP);
      const yEnd = H - Math.floor(H * this.MARGIN_BOTTOM);
      const xStart = Math.floor(W * this.MARGIN_LEFT);
      const xEnd = W - Math.floor(W * this.MARGIN_RIGHT);

      // 3. Encontra candidatos a paredes
      onProgress?.('Procurando paredes horizontais...');
      const horizontalCandidates = this.findHorizontalWalls(mask, W, H, xStart, xEnd, yStart, yEnd);

      onProgress?.('Procurando paredes verticais...');
      const verticalCandidates = this.findVerticalWalls(mask, W, H, xStart, xEnd, yStart, yEnd);

      // 4. Mescla candidatos paralelos adjacentes
      onProgress?.(`Mesclando ${horizontalCandidates.length} horizontais e ${verticalCandidates.length} verticais...`);
      const hWalls = this.mergeParallelWalls(horizontalCandidates, 'horizontal', W, H);
      const vWalls = this.mergeParallelWalls(verticalCandidates, 'vertical', W, H);

      // 5. FALLBACK: se não detectou paredes suficientes, usa perímetro
      let allWalls = [...hWalls, ...vWalls];
      if (allWalls.length < 4) {
        warnings.push(`Poucas paredes detectadas (${allWalls.length}), usando perímetro padrão.`);
        onProgress?.('Gerando estrutura de fallback...');
        const fallback = this.generateFallbackStructure(W, H);
        allWalls = [...allWalls, ...fallback];
      }

      // 6. Filtra paredes curtas demais (provavelmente ruído)
      const minLength = Math.max(this.MIN_LENGTH_ABS, Math.max(W, H) * this.MIN_LENGTH_FRACTION);
      const filteredWalls = allWalls.filter(w => w.length >= minLength);

      if (filteredWalls.length < 4) {
        warnings.push(`Ainda poucas paredes (${filteredWalls.length}), usando fallback.`);
        const fallback = this.generateFallbackStructure(W, H);
        filteredWalls.push(...fallback);
      }

      // 7. Vértices
      const { vertices, vertexByPixel } = this.buildVertices(hWalls, vWalls);

      // 8. Escala
      const scale = this.determineScale(hWalls, vWalls, W, H, options.hintWidth, options.hintHeight);

      // 9. Converte para WallSegment em METROS
      const cx = scale.totalWidth / 2;
      const cz = scale.totalDepth / 2;
      const ppm = scale.pixelsPerMeter;

      const walls: WallSegment[] = [];
      let wid = 0;
      for (const w of filteredWalls) {
        const sV = vertexByPixel.get(`${Math.round(w.start.x)},${Math.round(w.start.y)}`);
        const eV = vertexByPixel.get(`${Math.round(w.end.x)},${Math.round(w.end.y)}`);
        if (!sV || !eV) continue;
        wid++;
        const sx = w.start.x / ppm - cx;
        const sz = w.start.y / ppm - cz;
        const ex = w.end.x / ppm - cx;
        const ez = w.end.y / ppm - cz;
        const lengthM = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
        const angle = Math.atan2(ez - sz, ex - sx);
        walls.push({
          id: `W_${wid}`,
          startVertexId: sV,
          endVertexId: eV,
          length: lengthM,
          thickness: 0.15,
          height: 2.80,
          type: 'interior',
          orientation: Math.abs(angle) < Math.PI / 4 ? 'horizontal' : 'vertical',
          sourceStart: { x: w.start.x, y: w.start.y },
          sourceEnd: { x: w.end.x, y: w.end.y },
        });
      }

      // 10. Cômodos via flood-fill (áreas vazias cercadas por paredes)
      const rooms = this.detectRooms(mask, W, H, filteredWalls, ppm, cx, cz, scale);

      // 11. Classifica paredes externas
      this.classifyExternalWalls(walls, scale.totalWidth, scale.totalDepth);

      // 12. Vértices em METROS
      const verticesM: Vertex[] = vertices.map(v => ({
        id: v.id,
        x: v.px / ppm - cx,
        y: v.py / ppm - cz,
        z: 0,
        type: v.type,
        description: '',
      }));

      // 13. Plano final
      const plan: StructuralPlan = {
        projectName: 'Planta Detectada (AxisLine)',
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

      const processingTime = Date.now() - startTime;
      onProgress?.(`Concluído: ${walls.length} paredes em ${processingTime}ms`);

      return {
        success: walls.length >= 4,
        plan,
        walls,
        vertices: verticesM,
        rooms,
        confidence: Math.min(1, (walls.length / 10) * 0.4 + (rooms.length / 4) * 0.3 + 0.3),
        warnings,
        errors,
        stats: {
          imageW: W,
          imageH: H,
          horizontalCandidates: horizontalCandidates.length,
          verticalCandidates: verticalCandidates.length,
          horizontalWalls: hWalls.length,
          verticalWalls: vWalls.length,
          wallsAfterMerge: filteredWalls.length,
          roomsDetected: rooms.length,
          detectedWidthM: scale.totalWidth,
          detectedDepthM: scale.totalDepth,
          processingTimeMs: processingTime,
        },
      };
    } catch (e) {
      errors.push('Erro: ' + (e instanceof Error ? e.message : String(e)));
      return this.emptyResult(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, warnings, errors, Date.now() - startTime);
    }
  }

  // ============================================
  // OTSU THRESHOLD: encontra threshold ótimo
  // para separar pixels escuros de claros
  // ============================================
  private computeOtsuThreshold(data: Uint8ClampedArray, W: number, H: number): number {
    // Histograma (256 bins)
    const hist = new Array<number>(256).fill(0);
    const total = W * H;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gray = Math.floor((r + g + b) / 3);
      hist[gray]++;
    }

    // Soma total
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let maxVar = 0;
    let threshold = 127;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) ** 2;
      if (between > maxVar) {
        maxVar = between;
        threshold = t;
      }
    }
    return threshold;
  }

  // ============================================
  // BINARIZAÇÃO: pixels com grayscale < threshold = 1
  // ============================================
  private buildBinaryMask(data: Uint8ClampedArray, W: number, H: number, threshold: number): Uint8Array {
    const mask = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gray = (r + g + b) / 3;
      mask[j] = gray < threshold ? 1 : 0;
    }
    return mask;
  }

  // ============================================
  // PAREDES HORIZONTAIS: para cada linha y, encontra
  // a MAIOR EXTENSÃO (do primeiro ao último pixel preto),
  // considerando gaps pequenos como continuação
  // ============================================
  private findHorizontalWalls(
    mask: Uint8Array, W: number, _H: number,
    xStart: number, xEnd: number, yStart: number, yEnd: number
  ): Wall2D[] {
    const minExtent = (xEnd - xStart) * this.DENSITY_THRESHOLD;
    const walls: Wall2D[] = [];

    for (let y = yStart; y < yEnd; y++) {
      let firstX = -1;
      let lastX = -1;
      let blackCount = 0;

      for (let x = xStart; x < xEnd; x++) {
        if (mask[y * W + x]) {
          if (firstX === -1) firstX = x;
          lastX = x;
          blackCount++;
        }
      }

      if (firstX === -1) continue;

      const extent = lastX - firstX;
      // Só considera se a extensão for grande o suficiente
      // E se houver uma densidade razoável de pixels pretos
      // (extensão grande mas com pouca densidade = wall quebrada)
      if (extent >= minExtent && blackCount >= extent * 0.4) {
        walls.push({
          start: { x: firstX, y },
          end: { x: lastX, y },
          orientation: 'horizontal',
          length: extent,
          span: y,
        });
      }
    }

    return walls;
  }

  // ============================================
  // PAREDES VERTICAIS: para cada coluna x, encontra
  // a extensão (primeiro ao último pixel preto)
  // ============================================
  private findVerticalWalls(
    mask: Uint8Array, W: number, _H: number,
    xStart: number, xEnd: number, yStart: number, yEnd: number
  ): Wall2D[] {
    const minExtent = (yEnd - yStart) * this.DENSITY_THRESHOLD;
    const walls: Wall2D[] = [];

    for (let x = xStart; x < xEnd; x++) {
      let firstY = -1;
      let lastY = -1;
      let blackCount = 0;

      for (let y = yStart; y < yEnd; y++) {
        if (mask[y * W + x]) {
          if (firstY === -1) firstY = y;
          lastY = y;
          blackCount++;
        }
      }

      if (firstY === -1) continue;

      const extent = lastY - firstY;
      if (extent >= minExtent && blackCount >= extent * 0.4) {
        walls.push({
          start: { x, y: firstY },
          end: { x, y: lastY },
          orientation: 'vertical',
          length: extent,
          span: x,
        });
      }
    }

    return walls;
  }

  // ============================================
  // MESCLA PAREDES PARALELAS ADJACENTES
  // Paredes horizontais em y=100 e y=102 (mesma "linha")
  // viram uma única parede que cobre o extent total
  // ============================================
  private mergeParallelWalls(walls: Wall2D[], orientation: 'horizontal' | 'vertical', W: number, H: number): Wall2D[] {
    if (walls.length < 2) return walls;

    const tol = Math.min(W, H) * this.MERGE_TOLERANCE_FRACTION;
    const sorted = [...walls].sort((a, b) => a.span - b.span);

    const merged: Wall2D[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];

      if (Math.abs(prev.span - curr.span) <= tol) {
        // Mescla: estende extent e usa span médio
        let minStart: number, maxEnd: number;
        if (orientation === 'horizontal') {
          minStart = Math.min(prev.start.x, prev.end.x, curr.start.x, curr.end.x);
          maxEnd = Math.max(prev.start.x, prev.end.x, curr.start.x, curr.end.x);
          const yMid = Math.round((prev.span + curr.span) / 2);
          merged[merged.length - 1] = {
            start: { x: minStart, y: yMid },
            end: { x: maxEnd, y: yMid },
            orientation,
            length: maxEnd - minStart,
            span: yMid,
          };
        } else {
          minStart = Math.min(prev.start.y, prev.end.y, curr.start.y, curr.end.y);
          maxEnd = Math.max(prev.start.y, prev.end.y, curr.start.y, curr.end.y);
          const xMid = Math.round((prev.span + curr.span) / 2);
          merged[merged.length - 1] = {
            start: { x: xMid, y: minStart },
            end: { x: xMid, y: maxEnd },
            orientation,
            length: maxEnd - minStart,
            span: xMid,
          };
        }
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }

  // ============================================
  // FALLBACK: estrutura básica do tamanho da imagem
  // (4 paredes de perímetro + 1 parede central em cada eixo)
  // ============================================
  private generateFallbackStructure(W: number, H: number): Wall2D[] {
    const margin = Math.min(W, H) * 0.08;
    const x1 = margin;
    const y1 = margin;
    const x2 = W - margin;
    const y2 = H - margin;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    return [
      // Perímetro
      { start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, orientation: 'horizontal', length: x2 - x1, span: y1 },
      { start: { x: x1, y: y2 }, end: { x: x2, y: y2 }, orientation: 'horizontal', length: x2 - x1, span: y2 },
      { start: { x: x1, y: y1 }, end: { x: x1, y: y2 }, orientation: 'vertical', length: y2 - y1, span: x1 },
      { start: { x: x2, y: y1 }, end: { x: x2, y: y2 }, orientation: 'vertical', length: y2 - y1, span: x2 },
      // Divisões internas
      { start: { x: x1, y: midY }, end: { x: x2, y: midY }, orientation: 'horizontal', length: x2 - x1, span: midY },
      { start: { x: midX, y: y1 }, end: { x: midX, y: y2 }, orientation: 'vertical', length: y2 - y1, span: midX },
    ];
  }

  // ============================================
  // VÉRTICES: endpoints de paredes + cruzamentos
  // ============================================
  private buildVertices(hWalls: Wall2D[], vWalls: Wall2D[]): {
    vertices: { id: string; px: number; py: number; type: 'corner' | 'intersection' | 'endpoint' }[];
    vertexByPixel: Map<string, string>;
  } {
    const vertices: { id: string; px: number; py: number; type: 'corner' | 'intersection' | 'endpoint' }[] = [];
    const vertexByPixel = new Map<string, string>();
    const TOL = 8;

    const addVertex = (px: number, py: number, type: 'corner' | 'intersection' | 'endpoint' = 'endpoint'): string => {
      for (const v of vertices) {
        if (Math.abs(v.px - px) <= TOL && Math.abs(v.py - py) <= TOL) {
          if (type === 'intersection' && v.type === 'endpoint') v.type = 'intersection';
          const key = `${Math.round(px)},${Math.round(py)}`;
          vertexByPixel.set(key, v.id);
          return v.id;
        }
      }
      const id = `V${vertices.length + 1}`;
      const rx = Math.round(px);
      const ry = Math.round(py);
      vertices.push({ id, px: rx, py: ry, type });
      vertexByPixel.set(`${rx},${ry}`, id);
      return id;
    };

    for (const w of hWalls) {
      addVertex(w.start.x, w.start.y);
      addVertex(w.end.x, w.end.y);
    }
    for (const w of vWalls) {
      addVertex(w.start.x, w.start.y);
      addVertex(w.end.x, w.end.y);
    }
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
    hWalls: Wall2D[], vWalls: Wall2D[],
    W: number, H: number,
    hintW?: number, hintH?: number
  ): { pixelsPerMeter: number; totalWidth: number; totalDepth: number } {
    let maxH = 0, maxV = 0;
    for (const w of hWalls) if (w.length > maxH) maxH = w.length;
    for (const w of vWalls) if (w.length > maxV) maxV = w.length;

    if (maxH === 0 && maxV === 0) {
      // Sem paredes detectadas — usa tamanho da imagem
      if (hintW && hintH) {
        return { pixelsPerMeter: W / hintW, totalWidth: hintW, totalDepth: hintH };
      }
      return { pixelsPerMeter: W / 8, totalWidth: 8, totalDepth: (H / W) * 8 };
    }

    if (hintW && hintH) {
      const refLength = Math.max(maxH, maxV);
      const refDim = hintW >= hintH ? hintW : hintH;
      return { pixelsPerMeter: refLength / refDim, totalWidth: hintW, totalDepth: hintH };
    }

    const aspectRatio = maxV / (maxH || 1);
    let bestMatch: [number, number] = [6, 8];
    let bestErr = Infinity;
    for (const [w, h] of this.STANDARDS) {
      const err = Math.abs(h / w - aspectRatio);
      if (err < bestErr) { bestErr = err; bestMatch = [w, h]; }
    }

    let ppm: number;
    if (aspectRatio >= 1) {
      ppm = maxV / bestMatch[1];
    } else {
      ppm = maxH / bestMatch[0];
    }

    return { pixelsPerMeter: ppm, totalWidth: bestMatch[0], totalDepth: bestMatch[1] };
  }

  // ============================================
  // DETECÇÃO DE CÔMODOS via flood-fill
  // Encontra regiões vazias (sem pixels pretos) cercadas
  // pelas paredes detectadas
  // ============================================
  private detectRooms(
    _mask: Uint8Array, W: number, H: number,
    walls: Wall2D[],
    ppm: number, cx: number, cz: number,
    scale: { pixelsPerMeter: number; totalWidth: number; totalDepth: number }
  ): Room[] {
    // Cria máscara de paredes (1 onde tem parede, 0 onde tem cômodo)
    const wallMask = new Uint8Array(W * H);
    for (const w of walls) {
      if (w.orientation === 'horizontal') {
        const y = Math.round(w.start.y);
        for (let x = Math.round(w.start.x); x <= Math.round(w.end.x); x++) {
          if (x >= 0 && x < W && y >= 0 && y < H) wallMask[y * W + x] = 1;
        }
      } else {
        const x = Math.round(w.start.x);
        for (let y = Math.round(w.start.y); y <= Math.round(w.end.y); y++) {
          if (x >= 0 && x < W && y >= 0 && y < H) wallMask[y * W + x] = 1;
        }
      }
    }

    // Dilata levemente a máscara (une paredes com gap)
    const dilated = this.dilateMask(wallMask, W, H, 3);

    // Encontra componentes conexos em regiões VAZIAS (sem parede)
    const visited = new Uint8Array(W * H);
    const minArea = (1.5 * ppm) * (1.5 * ppm);
    const maxArea = (scale.totalWidth * scale.totalDepth * 1.5) * ppm * ppm;
    const rooms: Room[] = [];

    for (let y = 10; y < H - 10; y++) {
      for (let x = 10; x < W - 10; x++) {
        if (visited[y * W + x] || dilated[y * W + x]) continue;

        // BFS flood-fill
        const stack: [number, number][] = [[x, y]];
        const pixels: [number, number][] = [];
        while (stack.length > 0) {
          const [cx_, cy_] = stack.pop()!;
          if (cx_ < 0 || cx_ >= W || cy_ < 0 || cy_ >= H) continue;
          if (visited[cy_ * W + cx_] || dilated[cy_ * W + cx_]) continue;
          visited[cy_ * W + cx_] = 1;
          pixels.push([cx_, cy_]);
          stack.push([cx_ + 1, cy_], [cx_ - 1, cy_], [cx_, cy_ + 1], [cx_, cy_ - 1]);
        }

        if (pixels.length < minArea || pixels.length > maxArea) continue;

        // Calcula bounding box e converte para polígono
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [px, py] of pixels) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }

        const poly: { x: number; y: number }[] = [
          { x: minX / ppm - cx, y: minY / ppm - cz },
          { x: maxX / ppm - cx, y: minY / ppm - cz },
          { x: maxX / ppm - cx, y: maxY / ppm - cz },
          { x: minX / ppm - cx, y: maxY / ppm - cz },
        ];
        const areaM2 = pixels.length / (ppm * ppm);
        rooms.push({
          id: `R${rooms.length + 1}`,
          name: `Cômodo ${rooms.length + 1}`,
          type: 'unknown',
          walls: [],
          floor: poly,
          area: areaM2,
          center: {
            x: ((minX + maxX) / 2) / ppm - cx,
            y: ((minY + maxY) / 2) / ppm - cz,
          },
        });
      }
    }

    return rooms;
  }

  // ============================================
  // DILATE MANUAL (sem OpenCV)
  // ============================================
  private dilateMask(mask: Uint8Array, W: number, H: number, radius: number): Uint8Array {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let any = 0;
        for (let dy = -radius; dy <= radius && !any; dy++) {
          for (let dx = -radius; dx <= radius && !any; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < H && nx >= 0 && nx < W && mask[ny * W + nx]) {
              any = 1;
            }
          }
        }
        out[y * W + x] = any;
      }
    }
    return out;
  }

  // ============================================
  // CLASSIFICAÇÃO DE PAREDES EXTERNAS
  // ============================================
  private classifyExternalWalls(walls: WallSegment[], totalW: number, totalD: number): void {
    for (const w of walls) {
      if (!w.sourceStart || !w.sourceEnd) continue;
      const maxDim = Math.max(totalW, totalD);
      if (w.length > maxDim * 0.65) {
        w.type = 'exterior';
        w.thickness = 0.25;
      }
    }
  }

  private emptyResult(
    W: number, H: number,
    hCand: number, vCand: number,
    hWalls: number, vWalls: number,
    wallsAfter: number, rooms: number,
    wM: number, dM: number,
    warnings: string[], errors: string[], procTime: number
  ): AxisParseResult {
    return {
      success: false,
      plan: null,
      walls: [], vertices: [], rooms: [],
      confidence: 0,
      warnings, errors,
      stats: {
        imageW: W, imageH: H,
        horizontalCandidates: hCand,
        verticalCandidates: vCand,
        horizontalWalls: hWalls,
        verticalWalls: vWalls,
        wallsAfterMerge: wallsAfter,
        roomsDetected: rooms,
        detectedWidthM: wM,
        detectedDepthM: dM,
        processingTimeMs: procTime,
      },
    };
  }
}

export const axisLineParser = new AxisLineParser();
