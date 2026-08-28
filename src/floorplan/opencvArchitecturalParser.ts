// ============================================
// OPENCV ARCHITECTURAL PARSER
// Usa OpenCV.js (industry standard para visão computacional)
// para análise de plantas arquitetônicas.
//
// Pipeline:
//   1. Carregar OpenCV.js (lazy)
//   2. Filtro de cor (HSV) para isolar paredes vermelhas/pretas
//   3. GaussianBlur para suavizar
//   4. Canny edge detection
//   5. Morphological CLOSE (dilate + erode) para conectar quebras
//   6. HoughLinesP para detectar linhas (muito melhor que histograma)
//   7. Filtrar linhas: longas, alinhadas a 0°/90°
//   8. Snap a 0°/90°
//   9. findContours para detectar cômodos
// ============================================

import type { StructuralPlan, WallSegment, Vertex, Room } from './structuralIntelligence';

export interface OpenCVParseResult {
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
    rawLinesDetected: number;
    wallLinesDetected: number;
    roomsDetected: number;
    detectedWidthM: number;
    detectedHeightM: number;
    opencvLoadTimeMs: number;
    processingTimeMs: number;
  };
}

interface Line {
  x1: number; y1: number;
  x2: number; y2: number;
  orientation: 'horizontal' | 'vertical';
  length: number;
  angle: number;
}

interface PixelVertex {
  id: string;
  px: number;
  py: number;
  type: 'corner' | 'intersection' | 'endpoint';
}

// Variável para cachear o OpenCV
let cvPromise: Promise<any> | null = null;

/**
 * Lazy load OpenCV.js. Carrega apenas uma vez.
 */
async function loadOpenCV(onProgress?: (msg: string) => void): Promise<any> {
  if (cvPromise) return cvPromise;

  cvPromise = (async () => {
    onProgress?.('Carregando OpenCV.js (~13 MB)...');
    const startTime = Date.now();
    const cv = await import('@techstark/opencv-js');
    // Espera inicialização (pode demorar um pouco)
    if (typeof (cv as any).ready === 'function') {
      await (cv as any).ready;
    } else if (typeof (cv as any).onRuntimeInitialized !== 'undefined') {
      // Algumas versões expõem onRuntimeInitialized
      await new Promise<void>((resolve) => {
        if ((cv as any).onRuntimeInitialized) {
          (cv as any).onRuntimeInitialized = resolve;
        } else {
          resolve();
        }
      });
    }
    const loadTime = Date.now() - startTime;
    onProgress?.(`OpenCV.js carregado em ${loadTime}ms`);
    return cv;
  })();

  return cvPromise;
}

export class OpenCVArchitecturalParser {
  // Dimensões-padrão de casas brasileiras
  private readonly STANDARDS: [number, number][] = [
    [6, 8], [7, 10], [8, 10], [8, 12], [10, 12], [10, 15], [6, 10], [4, 6], [5, 7],
  ];

  // Margens (corte de título/margens)
  private readonly MARGIN_TOP_FRACTION = 0.13;
  private readonly MARGIN_LEFT_FRACTION = 0.02;

  // ============================================
  // PIPELINE PRINCIPAL
  // ============================================
  async parse(
    image: HTMLImageElement,
    options: { hintWidth?: number; hintHeight?: number; onProgress?: (msg: string) => void } = {}
  ): Promise<OpenCVParseResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const onProgress = options.onProgress;

    try {
      onProgress?.('Inicializando OpenCV...');
      const cv = await loadOpenCV(onProgress);
      const startTime = Date.now();

      // 1. Canvas + pixels
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const W = canvas.width;
      const H = canvas.height;

      // 2. Carrega no OpenCV
      onProgress?.('Convertendo para OpenCV Mat...');
      const src = cv.imread(canvas);
      const processed = this.preprocessImage(cv, src, W, H, onProgress);

      if (!processed) {
        errors.push('Poucos pixels de parede após pré-processamento.');
        return this.emptyResult(W, H, 0, 0, 0, 0, 0, warnings, errors);
      }

      // 3. TENTATIVA 1: Detecta linhas com HoughLinesP na máscara de cor
      onProgress?.('Detectando linhas (HoughLinesP) na máscara de cor...');
      let rawLines = this.detectLinesHough(cv, processed, W, H);

      // 4. TENTATIVA 2: Se encontrou poucas linhas, detecta na imagem em grayscale
      //    (pega paredes pretas, traços a lápis, etc)
      if (rawLines.length < 4) {
        onProgress?.('Poucas linhas. Tentando grayscale...');
        const grayLines = this.detectLinesGrayscale(cv, src, W, H);
        if (grayLines.length > rawLines.length) {
          rawLines = grayLines;
        }
      }

      // 5. TENTATIVA 3: LSD Line Segment Detector (pega segmentos curtos)
      if (rawLines.length < 4) {
        onProgress?.('Poucas linhas. Tentando LSD...');
        const lsdLines = this.detectLinesLSD(cv, processed, W, H);
        if (lsdLines.length > rawLines.length) {
          rawLines = lsdLines;
        }
      }

      // 6. Filtra linhas (orientação 0°/90°, comprimento mínimo)
      onProgress?.(`Filtrando ${rawLines.length} linhas...`);
      let wallLines = this.filterAndSnapLines(rawLines, W, H);

      // 7. FALLBACK: se ainda tem < 4 paredes, gera estrutura básica do tamanho da imagem
      if (wallLines.length < 4) {
        onProgress?.(`Poucas paredes (${wallLines.length}). Gerando estrutura básica...`);
        warnings.push(`Apenas ${wallLines.length} paredes detectadas, usando estrutura padrão.`);
        wallLines = this.generateFallbackStructure(W, H, wallLines);
      }

      // 5. Constrói paredes + vértices
      const { walls, vertices } = this.buildWallsAndVertices(wallLines);

      // 6. Determina escala
      const scale = this.determineScale(wallLines, W, H, options.hintWidth, options.hintHeight);
      const cx = scale.totalWidth / 2;
      const cz = scale.totalDepth / 2;
      const ppm = scale.pixelsPerMeter;

      // 7. Converte paredes para coordenadas em METROS
      const wallsM: WallSegment[] = [];
      let wid = 0;
      for (const w of walls) {
        if (!w.sourceStart || !w.sourceEnd) continue;
        wid++;
        const sx = w.sourceStart.x / ppm - cx;
        const sz = w.sourceStart.y / ppm - cz;
        const ex = w.sourceEnd.x / ppm - cx;
        const ez = w.sourceEnd.y / ppm - cz;
        const lengthM = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
        const angle = Math.atan2(ez - sz, ex - sx);
        wallsM.push({
          id: `W_${wid}`,
          startVertexId: w.startVertexId,
          endVertexId: w.endVertexId,
          length: lengthM,
          thickness: 0.15,
          height: 2.80,
          type: 'interior',
          orientation: Math.abs(angle) < Math.PI / 4 ? 'horizontal' : 'vertical',
          sourceStart: { x: w.sourceStart.x, y: w.sourceStart.y },
          sourceEnd: { x: w.sourceEnd.x, y: w.sourceEnd.y },
        });
      }

      // 8. Detecta cômodos via findContours
      onProgress?.('Detectando cômodos (findContours)...');
      const rooms = this.detectRooms(cv, processed, walls, new Map(), ppm, cx, cz, scale);

      // 9. Classifica paredes externas (no perímetro)
      this.classifyExternalWalls(wallsM, scale.totalWidth, scale.totalDepth);

      // 10. Converte vértices para coordenadas em metros
      const verticesM: Vertex[] = vertices.map(v => ({
        id: v.id,
        x: v.px / ppm - cx,
        y: v.py / ppm - cz,
        z: 0,
        type: v.type,
        description: '',
      }));

      // 11. Monta o plano
      const plan: StructuralPlan = {
        projectName: 'Planta Detectada (OpenCV)',
        totalArea: scale.totalWidth * scale.totalDepth,
        totalWidth: scale.totalWidth,
        totalDepth: scale.totalDepth,
        wallHeight: 2.80,
        floors: 1,
        vertices: verticesM,
        walls: wallsM,
        dimensions: [],
        rooms,
      };

      // Limpa memória OpenCV
      src.delete();
      processed.delete();

      const processingTime = Date.now() - startTime;
      onProgress?.(`Concluído em ${processingTime}ms`);

      return {
        success: wallsM.length >= 4 && rooms.length >= 1,
        plan,
        walls: wallsM,
        vertices: verticesM,
        rooms,
        confidence: Math.min(1, (wallsM.length / 12) * 0.4 + (rooms.length / 4) * 0.3 + 0.3),
        warnings,
        errors,
        stats: {
          imageW: W,
          imageH: H,
          rawLinesDetected: rawLines.length,
          wallLinesDetected: wallLines.length,
          roomsDetected: rooms.length,
          detectedWidthM: scale.totalWidth,
          detectedHeightM: scale.totalDepth,
          opencvLoadTimeMs: 0, // medido separadamente se necessário
          processingTimeMs: processingTime,
        },
      };
    } catch (e) {
      errors.push('Erro no parser OpenCV: ' + (e instanceof Error ? e.message : String(e)));
      return this.emptyResult(0, 0, 0, 0, 0, 0, 0, warnings, errors);
    }
  }

  // ============================================
  // PRÉ-PROCESSAMENTO
  // Filtra cor (HSV) → Blur → Canny → Close
  // Otimizado para plantas arquitetônicas:
  // - Vermelho mais agressivo (cobre variações como #C00, #B22, etc)
  // - Bordas mais espessas via dilatação maior
  // - Fecha gaps em paredes tracejadas
  // ============================================
  private preprocessImage(cv: any, src: any, W: number, H: number, onProgress?: (msg: string) => void): any | null {
    // 1. Converte para HSV
    onProgress?.('Convertendo para HSV...');
    const hsv = new cv.Mat();
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

    // 2. MÁSCARA VERMELHA AGRESSIVA
    //    H: 0-15 (laranja-avermelhado) e 165-180 (rosa-avermelhado)
    //    S: >60 (saturação mínima baixa para pegar vermelho desbotado)
    //    V: >40 (permite vermelho escuro)
    const maskRed1 = new cv.Mat();
    const maskRed2 = new cv.Mat();
    const maskRed = new cv.Mat();
    cv.inRange(hsv, new cv.Scalar(0, 60, 40, 0), new cv.Scalar(15, 255, 255, 0), maskRed1);
    cv.inRange(hsv, new cv.Scalar(165, 60, 40, 0), new cv.Scalar(180, 255, 255, 0), maskRed2);
    cv.add(maskRed1, maskRed2, maskRed);

    // 3. MÁSCARA VERMELHO ESCURO (RGB direto, para vermelhos muito escuros)
    //    Pega tons de vermelho que o HSV pode perder
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const maskRedDark = new cv.Mat();
    cv.inRange(rgb, new cv.Scalar(80, 0, 0, 0), new cv.Scalar(255, 100, 100, 0), maskRedDark);
    cv.add(maskRed, maskRedDark, maskRed);
    rgb.delete();
    maskRed1.delete(); maskRed2.delete(); maskRedDark.delete();

    // 4. MÁSCARA PRETO/CINZA (linhas pretas de paredes)
    const maskDark = new cv.Mat();
    cv.inRange(hsv, new cv.Scalar(0, 0, 0, 0), new cv.Scalar(180, 255, 100, 0), maskDark);

    // 5. Combina as máscaras
    const mask = new cv.Mat();
    cv.add(maskRed, maskDark, mask);
    maskRed.delete(); maskDark.delete();

    // 6. Corta margens (remove título no topo)
    const marginTop = Math.floor(H * this.MARGIN_TOP_FRACTION);
    void Math.floor(W * this.MARGIN_LEFT_FRACTION);
    if (marginTop > 0) {
      const dst = new cv.Mat();
      dst.create(H, W, cv.CV_8UC1);
      dst.setTo(new cv.Scalar(0, 0, 0, 0));
      const roi = mask.roi(new cv.Rect(0, marginTop, W, H - marginTop));
      roi.copyTo(dst.roi(new cv.Rect(0, marginTop, W, H - marginTop)));
      mask.delete();
      roi.delete();
      hsv.delete();
      return dst;
    }

    // 6. MORPHOLOGICAL CLOSE na máscara ANTES do Canny
    //    Fecha gaps em paredes tracejadas (ex: porta ou cotagem quebrando a parede)
    onProgress?.('Morphological close (fecha quebras)...');
    const closeKernel = cv.Mat.ones(5, 5, cv.CV_8U);
    const closed = new cv.Mat();
    cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, closeKernel, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    closeKernel.delete();

    // 7. GaussianBlur para suavizar
    onProgress?.('Aplicando GaussianBlur...');
    const blurred = new cv.Mat();
    cv.GaussianBlur(closed, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    closed.delete();

    // 8. Canny edge detection (threshold mais sensível)
    onProgress?.('Aplicando Canny edge...');
    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 30, 100, 3, false);

    // 9. DILATAÇÃO MAIOR para conectar quebras
    onProgress?.('Dilatando para conectar quebras...');
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    const dilated = new cv.Mat();
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

    // Verifica se tem pixels suficientes
    const nonZero = cv.countNonZero(dilated);
    if (nonZero < 100) {
      hsv.delete(); mask.delete(); blurred.delete(); edges.delete(); kernel.delete(); dilated.delete();
      return null;
    }

    hsv.delete(); mask.delete(); blurred.delete(); edges.delete(); kernel.delete();
    return dilated;
  }

  // ============================================
  // HOUGHLINESP: detecta segmentos de linha
  // ============================================
  private detectLinesHough(cv: any, edges: any, W: number, H: number): Line[] {
    const lines = new cv.Mat();
    // Parâmetros otimizados para plantas arquitetônicas:
    // - threshold 30 (era 50): mais sensível, detecta linhas curtas
    // - minLineLength 3% (era 4%): aceita paredes menores
    // - maxLineGap 3% (era 2%): conecta quebras maiores em paredes tracejadas
    cv.HoughLinesP(
      edges,
      lines,
      1,                    // rho: 1 pixel
      Math.PI / 180,        // theta: 1 grau
      30,                   // threshold: mínimo de votos (era 50)
      Math.min(W, H) * 0.03, // minLineLength: 3% da menor dimensão
      Math.min(W, H) * 0.03  // maxLineGap: 3% (era 2%)
    );

    const result: Line[] = [];
    for (let i = 0; i < lines.rows; i++) {
      const x1 = lines.data32S[i * 4];
      const y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2];
      const y2 = lines.data32S[i * 4 + 3];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;

      result.push({ x1, y1, x2, y2, length, angle, orientation: 'horizontal' });
    }
    lines.delete();
    return result;
  }

  // ============================================
  // HOUGHLINESP em GRAYSCALE
  // Detecta linhas na imagem em tons de cinza (pega paredes pretas, traços)
  // ============================================
  private detectLinesGrayscale(cv: any, src: any, W: number, H: number): Line[] {
    // Converte para grayscale
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Blur mais agressivo para suavizar textura de fundo
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    // OTSU threshold (automático, ignora fundo texturizado)
    const binary = new cv.Mat();
    cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    // Morphological CLOSE fecha gaps em paredes
    const closeKernel = cv.Mat.ones(3, 3, cv.CV_8U);
    const closed = new cv.Mat();
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, closeKernel, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    closeKernel.delete();

    // Dilata para conectar quebras
    const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
    const dilated = new cv.Mat();
    cv.dilate(closed, dilated, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    kernel.delete();
    gray.delete();
    binary.delete();
    closed.delete();

    // HoughLinesP com parâmetros muito sensíveis
    const lines = new cv.Mat();
    cv.HoughLinesP(
      dilated,
      lines,
      1,
      Math.PI / 180,
      20,  // threshold muito baixo
      Math.min(W, H) * 0.02, // minLineLength: 2%
      Math.min(W, H) * 0.04  // maxLineGap: 4%
    );
    dilated.delete();

    const result: Line[] = [];
    for (let i = 0; i < lines.rows; i++) {
      const x1 = lines.data32S[i * 4];
      const y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2];
      const y2 = lines.data32S[i * 4 + 3];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      result.push({ x1, y1, x2, y2, length, angle, orientation: 'horizontal' });
    }
    lines.delete();
    return result;
  }

  // ============================================
  // LSD Line Segment Detector
  // Detecta segmentos de linha curtos (pega detalhes)
  // ============================================
  private detectLinesLSD(cv: any, processed: any, _W: number, _H: number): Line[] {
    try {
      // LSD só está disponível em algumas builds do OpenCV.js
      if (typeof cv.LineSegmentDetector === 'undefined') {
        return [];
      }
      const lsd = cv.LineSegmentDetector();
      const lines = new cv.Mat();
      lsd.detect(processed, lines);

      const result: Line[] = [];
      for (let i = 0; i < lines.rows; i++) {
        const x1 = lines.data32S[i * 4];
        const y1 = lines.data32S[i * 4 + 1];
        const x2 = lines.data32S[i * 4 + 2];
        const y2 = lines.data32S[i * 4 + 3];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (length > 5) { // ignora ruído muito pequeno
          result.push({ x1, y1, x2, y2, length, angle, orientation: 'horizontal' });
        }
      }
      lines.delete();
      return result;
    } catch (e) {
      return [];
    }
  }

  // ============================================
  // FALLBACK: estrutura básica quando não detecta paredes suficientes
  // Gera um retângulo do tamanho da imagem com algumas subdivisões
  // ============================================
  private generateFallbackStructure(W: number, H: number, existing: Line[]): Line[] {
    // Margens internas (não usar pixels das bordas)
    const margin = Math.min(W, H) * 0.05;
    const x1 = margin;
    const y1 = margin;
    const x2 = W - margin;
    const y2 = H - margin;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const fallback: Line[] = [
      // Perímetro
      { x1: x1, y1: y1, x2: x2, y2: y1, length: x2 - x1, angle: 0, orientation: 'horizontal' },
      { x1: x1, y1: y2, x2: x2, y2: y2, length: x2 - x1, angle: 0, orientation: 'horizontal' },
      { x1: x1, y1: y1, x2: x1, y2: y2, length: y2 - y1, angle: 90, orientation: 'vertical' },
      { x1: x2, y1: y1, x2: x2, y2: y2, length: y2 - y1, angle: 90, orientation: 'vertical' },
      // Divisões internas (cria 4 ambientes)
      { x1: x1, y1: midY, x2: x2, y2: midY, length: x2 - x1, angle: 0, orientation: 'horizontal' },
      { x1: midX, y1: y1, x2: midX, y2: y2, length: y2 - y1, angle: 90, orientation: 'vertical' },
    ];

    // Combina fallback com o que já foi detectado
    return [...existing, ...fallback];
  }

  // ============================================
  // FILTRA E SNAP: mantém só linhas alinhadas (0°/90°)
  // ============================================
  private filterAndSnapLines(rawLines: Line[], W: number, H: number): Line[] {
    const minLength = Math.min(W, H) * 0.04; // mínimo 4% da menor dimensão
    const angleTol = 12; // tolerância em graus

    const filtered: Line[] = [];
    for (const line of rawLines) {
      if (line.length < minLength) continue;
      let a = line.angle;
      while (a < 0) a += 180;
      while (a >= 180) a -= 180;

      const distToH = Math.min(a, 180 - a);
      const distToV = Math.abs(a - 90);

      if (distToH < distToV && distToH < angleTol) {
        // Horizontal: alinha Y
        const y = Math.round((line.y1 + line.y2) / 2);
        filtered.push({
          x1: line.x1, y1: y,
          x2: line.x2, y2: y,
          length: Math.abs(line.x2 - line.x1),
          angle: 0,
          orientation: 'horizontal',
        });
      } else if (distToV < angleTol) {
        // Vertical: alinha X
        const x = Math.round((line.x1 + line.x2) / 2);
        filtered.push({
          x1: x, y1: line.y1,
          x2: x, y2: line.y2,
          length: Math.abs(line.y2 - line.y1),
          angle: 90,
          orientation: 'vertical',
        });
      }
    }

    // Mescla linhas próximas (mesma orientação, sobrepostas)
    return this.mergeOverlappingLines(filtered);
  }

  private mergeOverlappingLines(lines: Line[]): Line[] {
    if (lines.length < 2) return lines;
    // Separa por orientação
    const horizontals = lines.filter(l => l.orientation === 'horizontal');
    const verticals = lines.filter(l => l.orientation === 'vertical');

    return [
      ...this.mergeLines(horizontals, 'horizontal'),
      ...this.mergeLines(verticals, 'vertical'),
    ];
  }

  private mergeLines(lines: Line[], orientation: 'horizontal' | 'vertical'): Line[] {
    if (lines.length < 2) return lines;
    // Ordena por (eixo perpendicular, eixo paralelo)
    const sorted = [...lines].sort((a, b) => {
      if (orientation === 'horizontal') return a.y1 - b.y1 || a.x1 - b.x1;
      return a.x1 - b.x1 || a.y1 - b.y1;
    });

    const merged: Line[] = [sorted[0]];
    const tol = 8;
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];
      if (orientation === 'horizontal') {
        if (Math.abs(prev.y1 - curr.y1) <= tol && curr.x1 <= prev.x2 + tol * 2) {
          // Mescla
          const minX = Math.min(prev.x1, curr.x1);
          const maxX = Math.max(prev.x2, curr.x2);
          const y = Math.round((prev.y1 + curr.y1) / 2);
          merged[merged.length - 1] = { x1: minX, y1: y, x2: maxX, y2: y, length: maxX - minX, angle: 0, orientation: 'horizontal' };
          continue;
        }
      } else {
        if (Math.abs(prev.x1 - curr.x1) <= tol && curr.y1 <= prev.y2 + tol * 2) {
          const minY = Math.min(prev.y1, curr.y1);
          const maxY = Math.max(prev.y2, curr.y2);
          const x = Math.round((prev.x1 + curr.x1) / 2);
          merged[merged.length - 1] = { x1: x, y1: minY, x2: x, y2: maxY, length: maxY - minY, angle: 90, orientation: 'vertical' };
          continue;
        }
      }
      merged.push(curr);
    }
    return merged;
  }

  // ============================================
  // VÉRTICES + PAREDES
  // ============================================
  private buildWallsAndVertices(lines: Line[]): {
    walls: WallSegment[];
    vertices: PixelVertex[];
    vertexByPixel: Map<string, string>;
  } {
    const vertices: PixelVertex[] = [];
    const vertexByPixel = new Map<string, string>();
    const TOL = 12;

    const addVertex = (px: number, py: number, type: 'corner' | 'intersection' | 'endpoint' = 'endpoint'): string => {
      for (const v of vertices) {
        if (Math.abs(v.px - px) <= TOL && Math.abs(v.py - py) <= TOL) {
          if (type === 'intersection' && v.type === 'endpoint') v.type = 'intersection';
          vertexByPixel.set(`${px},${py}`, v.id);
          return v.id;
        }
      }
      const id = `V${vertices.length + 1}`;
      vertices.push({ id, px, py, type });
      vertexByPixel.set(`${px},${py}`, id);
      return id;
    };

    // Endpoints
    for (const l of lines) {
      addVertex(l.x1, l.y1);
      addVertex(l.x2, l.y2);
    }
    // Cruzamentos H x V
    const hLines = lines.filter(l => l.orientation === 'horizontal');
    const vLines = lines.filter(l => l.orientation === 'vertical');
    for (const h of hLines) {
      for (const v of vLines) {
        if (v.x1 >= h.x1 - TOL && v.x1 <= h.x2 + TOL
         && h.y1 >= v.y1 - TOL && h.y1 <= v.y2 + TOL) {
          addVertex(v.x1, h.y1, 'intersection');
        }
      }
    }

    // Constrói paredes
    const walls: WallSegment[] = [];
    for (const l of lines) {
      const sV = vertexByPixel.get(`${l.x1},${l.y1}`);
      const eV = vertexByPixel.get(`${l.x2},${l.y2}`);
      if (!sV || !eV || sV === eV) continue;
      walls.push({
        id: `W_${walls.length + 1}`,
        startVertexId: sV,
        endVertexId: eV,
        length: l.length,
        thickness: 0.15,
        height: 2.80,
        type: 'interior',
        orientation: l.orientation,
        sourceStart: { x: l.x1, y: l.y1 },
        sourceEnd: { x: l.x2, y: l.y2 },
      });
    }
    return { walls, vertices, vertexByPixel };
  }

  // ============================================
  // ESCALA
  // ============================================
  private determineScale(
    lines: Line[],
    _W: number, _H: number,
    hintW?: number, hintH?: number
  ): { pixelsPerMeter: number; totalWidth: number; totalDepth: number } {
    let maxH = 0, maxV = 0;
    for (const l of lines) {
      if (l.orientation === 'horizontal') {
        if (l.length > maxH) maxH = l.length;
      } else {
        if (l.length > maxV) maxV = l.length;
      }
    }

    if (hintW && hintH) {
      const ppm = maxH / hintW;
      return { pixelsPerMeter: ppm, totalWidth: hintW, totalDepth: hintH };
    }

    const aspectRatio = maxV / (maxH || 1);
    let bestMatch: [number, number] = [6, 8];
    let bestError = Infinity;
    for (const [w, h] of this.STANDARDS) {
      const err = Math.abs(h / w - aspectRatio);
      if (err < bestError) { bestError = err; bestMatch = [w, h]; }
    }

    let pixelsPerMeter: number;
    if (aspectRatio >= 1) {
      pixelsPerMeter = maxV / bestMatch[1];
    } else {
      pixelsPerMeter = maxH / bestMatch[0];
    }
    return { pixelsPerMeter, totalWidth: bestMatch[0], totalDepth: bestMatch[1] };
  }

  // ============================================
  // DETECÇÃO DE CÔMODOS via findContours
  // ============================================
  private detectRooms(
    cv: any,
    edges: any,
    walls: WallSegment[],
    _vertexByPixel: Map<string, string>,
    ppm: number, cx: number, cz: number,
    scale: { pixelsPerMeter: number; totalWidth: number; totalDepth: number }
  ): Room[] {
    // Usa findContours para encontrar regiões fechadas
    // Cria máscara preta e desenha as paredes
    const W = edges.cols;
    const H = edges.rows;
    const wallMask = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0, 0, 0, 0));
    for (const w of walls) {
      if (!w.sourceStart || !w.sourceEnd) continue;
      const p1 = new cv.Point(w.sourceStart.x, w.sourceStart.y);
      const p2 = new cv.Point(w.sourceEnd.x, w.sourceEnd.y);
      cv.line(wallMask, p1, p2, new cv.Scalar(255, 255, 255, 0), 3, cv.LINE_8, 0);
    }

    // Fecha as paredes (fecha gaps) e dilata
    const kernel = cv.Mat.ones(15, 15, cv.CV_8U);
    const closed = new cv.Mat();
    cv.morphologyEx(wallMask, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

    // Inverte (fundo vira paredes)
    const inverted = new cv.Mat();
    cv.bitwise_not(closed, inverted);

    // Acha contornos
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(inverted, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const rooms: Room[] = [];
    const minArea = (1.0 * ppm) * (1.0 * ppm); // mínimo 1m²
    const maxArea = scale.totalWidth * scale.totalDepth * 1.2 * ppm * ppm;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < minArea || area > maxArea) continue;

      // Aproxima o contorno a um polígono
      const approx = new cv.Mat();
      const epsilon = 0.02 * cv.arcLength(contour, true);
      cv.approxPolyDP(contour, approx, epsilon, true);

      if (approx.rows < 3) {
        approx.delete();
        continue;
      }

      // Extrai pontos
      const poly: { x: number; y: number }[] = [];
      for (let j = 0; j < approx.rows; j++) {
        const x = approx.data32S[j * 2];
        const y = approx.data32S[j * 2 + 1];
        poly.push({ x: x / ppm - cx, y: y / ppm - cz });
      }
      const areaM2 = area / (ppm * ppm);

      rooms.push({
        id: `R${rooms.length + 1}`,
        name: `Cômodo ${rooms.length + 1}`,
        type: 'unknown',
        walls: [],
        floor: poly,
        area: areaM2,
        center: {
          x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
          y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
        },
      });
      approx.delete();
    }

    wallMask.delete(); kernel.delete(); closed.delete(); inverted.delete();
    contours.delete(); hierarchy.delete();

    return rooms;
  }

  private classifyExternalWalls(walls: WallSegment[], totalW: number, totalD: number): void {
    for (const w of walls) {
      if (!w.sourceStart || !w.sourceEnd) continue;
      // Paredes muito longas (>70% da maior dimensão) são candidatas a externas
      const maxDim = Math.max(totalW, totalD);
      if (w.length > maxDim * 0.7) {
        w.type = 'exterior';
        w.thickness = 0.25;
      }
    }
  }

  // ============================================
  // HELPER
  // ============================================
  private emptyResult(
    W: number, H: number, raw: number, walls: number, rooms: number,
    procTime: number, opencvTime: number = 0,
    warnings: string[], errors: string[]
  ): OpenCVParseResult {
    return {
      success: false,
      plan: null,
      walls: [], vertices: [], rooms: [],
      confidence: 0,
      warnings, errors,
      stats: {
        imageW: W, imageH: H,
        rawLinesDetected: raw,
        wallLinesDetected: walls,
        roomsDetected: rooms,
        detectedWidthM: 0, detectedHeightM: 0,
        opencvLoadTimeMs: opencvTime,
        processingTimeMs: procTime,
      },
    };
  }
}

export const openCVArchitecturalParser = new OpenCVArchitecturalParser();
