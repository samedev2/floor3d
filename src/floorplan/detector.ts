import {
  FloorPlan2D,
  Wall2D,
  Room2D,
  Opening2D,
  Point2D,
  RoomType,
  DetectionResult,
  DetectionMethod,
  CalibrationPoint,
} from '../types';
import { architecturalAnalyzer } from './architecturalAnalyzer';

// ============================================
// FLOOR PLAN DETECTOR
// Detecção de planta usando CV + AI
// Pipeline: Image → Quality → Document → Perspective → 
//          Line Detection → Wall Classification → Room Segmentation → 3D
// ============================================

export class FloorPlanDetector {
  private minWallLength = 20;
  private scale = 100; // pixels por metro (padrão)

  // Detectar planta de uma imagem
  async detect(
    image: HTMLImageElement | HTMLCanvasElement | ImageData,
    source: string = 'unknown'
  ): Promise<DetectionResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      let floorPlan: FloorPlan2D | null = null;
      let method: DetectionMethod = 'cv';

      // STEP 1: Use Architectural Analyzer (CV + Pattern Recognition)
      // This follows the skill: Line Classification → Wall Detection → Room Segmentation
      try {
        const imgElement = image instanceof HTMLImageElement 
          ? image 
          : await this.canvasToImage(image as HTMLCanvasElement);
        
        const archResult = await architecturalAnalyzer.analyze(imgElement);
        
        if (archResult.success && archResult.confidence > 0.5) {
          // Convert architectural result to FloorPlan2D
          floorPlan = this.convertArchitecturalResult(archResult);
          method = 'cv';
          
          // Add warnings from architectural analysis
          warnings.push(...archResult.warnings);
          
          // Log classification results
          console.log(`[ArchitecturalAnalyzer] Found: ${archResult.walls.length} walls, ${archResult.rooms.length} rooms, ${archResult.doors.length} doors`);
        } else {
          warnings.push(...archResult.errors);
        }
      } catch (e) {
        console.log('Architectural analyzer failed:', e);
        warnings.push('Análise arquitetônica falhou, tentando método alternativo');
      }

      // STEP 2: Try AI if CV didn't work well
      if (!floorPlan || floorPlan.walls.length < 4) {
        try {
          const { smartFloorPlanAnalysis } = await import('../lib/gemini');
          
          // Criar versão pequena para análise
          const smallImage = this.createSmallImage(image, 600);
          
          // Análise com timeout
          const aiResult = await Promise.race([
            smartFloorPlanAnalysis(
              smallImage.dataUrl,
              smallImage.width,
              smallImage.height,
              'floorplan',
              'upload'
            ),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('AI_TIMEOUT')), 5000)
            )
          ]);

          if (aiResult && aiResult.walls && aiResult.walls.length >= 4) {
            floorPlan = this.convertAIResultToFloorPlan(aiResult, source);
            method = 'ai';
          }
        } catch (e) {
          console.log('AI detection failed, using CV:', e);
          warnings.push('Análise AI indisponível, usando detecção por visão computacional');
        }
      }

      // STEP 3: Fallback para CV tradicional se AI falhou
      if (!floorPlan || floorPlan.walls.length === 0) {
        floorPlan = this.detectWithCV(image, source);
        method = floorPlan ? 'cv' : 'manual';
      }

      if (!floorPlan || floorPlan.walls.length === 0) {
        errors.push('Não foi possível detectar paredes na imagem. Use uma planta com linhas retas bem definidas.');
        return {
          success: false,
          floorPlan: null,
          confidence: 0,
          processingTime: performance.now() - startTime,
          method,
          errors,
          warnings,
        };
      }

      // Calcular confiança
      const confidence = this.calculateConfidence(floorPlan);

      return {
        success: true,
        floorPlan,
        confidence,
        processingTime: performance.now() - startTime,
        method,
        errors: [],
        warnings,
      };
    } catch (error) {
      console.error('Detection error:', error);
      return {
        success: false,
        floorPlan: null,
        confidence: 0,
        processingTime: performance.now() - startTime,
        method: 'cv',
        errors: [error instanceof Error ? error.message : 'Erro desconhecido'],
        warnings,
      };
    }
  }

  // Convert architectural analyzer result to FloorPlan2D
  private convertArchitecturalResult(result: any): FloorPlan2D {
    const walls: Wall2D[] = [];
    const rooms: Room2D[] = [];
    const doors: Opening2D[] = [];
    const windows: Opening2D[] = [];

    // Convert walls
    if (result.walls) {
      result.walls.forEach((wall: any, index: number) => {
        walls.push({
          id: wall.id || `wall_${index}`,
          start: wall.start,
          end: wall.end,
          thickness: wall.thickness || 0.15,
          isExterior: wall.isExterior || false,
          openings: [],
        });
      });
    }

    // Convert rooms
    if (result.rooms) {
      result.rooms.forEach((room: any, index: number) => {
        rooms.push({
          id: room.id || `room_${index}`,
          name: room.name || `Ambiente ${index + 1}`,
          type: this.inferRoomType(room.name),
          polygon: room.polygon || [],
          area: room.area || 0,
          walls: room.walls || [],
          center: room.center || { x: 0, y: 0 },
        });
      });
    }

    // Convert doors
    if (result.doors) {
      result.doors.forEach((door: any, index: number) => {
        doors.push({
          id: door.id || `door_${index}`,
          type: 'door',
          position: door.position,
          width: door.width || 0.9,
          rotation: door.orientation || 0,
        });
      });
    }

    // Convert windows
    if (result.windows) {
      result.windows.forEach((win: any, index: number) => {
        windows.push({
          id: win.id || `window_${index}`,
          type: 'window',
          position: win.position,
          width: win.width || 1.2,
          height: win.height,
          rotation: win.orientation || 0,
        });
      });
    }

    // Calculate bounds
    const bounds = this.calculateBounds(walls);

    return {
      id: `fp_${Date.now()}`,
      walls,
      rooms,
      doors,
      windows,
      scale: result.scale?.pixelsPerMeter || 100,
      origin: { x: 0, y: 0 },
      dimensions: {
        width: bounds.max.x - bounds.min.x,
        height: bounds.max.y - bounds.min.y,
      },
      bounds,
    };
  }

  // Convert canvas to image element
  private canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = canvas.toDataURL();
    });
  }

  // Infer room type from name
  private inferRoomType(name: string | undefined): RoomType {
    if (!name) return 'unknown';
    const lower = name.toLowerCase();
    
    if (lower.includes('quarto') || lower.includes('suite') || lower.includes('bedroom')) return 'bedroom';
    if (lower.includes('sala') || lower.includes('living')) return 'living';
    if (lower.includes('cozinha') || lower.includes('kitchen')) return 'kitchen';
    if (lower.includes('banho') || lower.includes('bathroom')) return 'bathroom';
    if (lower.includes('varanda') || lower.includes('balcony')) return 'balcony';
    if (lower.includes('garagem') || lower.includes('garage')) return 'garage';
    if (lower.includes('escritorio') || lower.includes('office')) return 'office';
    
    return 'unknown';
  }

  // Converter resultado AI para FloorPlan2D
  private convertAIResultToFloorPlan(result: any, _source: string): FloorPlan2D {
    const walls: Wall2D[] = [];
    const rooms: Room2D[] = [];
    const doors: Opening2D[] = [];
    const windows: Opening2D[] = [];

    // Processar paredes
    if (result.walls) {
      result.walls.forEach((wall: any, index: number) => {
        walls.push({
          id: `wall_${index}`,
          start: { x: wall.x1, y: wall.y1 },
          end: { x: wall.x2, y: wall.y2 },
          thickness: wall.thickness || 10,
          isExterior: wall.isExterior || false,
          openings: [],
        });
      });
    }

    // Processar cômodos
    if (result.rooms) {
      result.rooms.forEach((room: any, index: number) => {
        rooms.push({
          id: `room_${index}`,
          name: room.name || `Room ${index + 1}`,
          type: this.inferRoomType(room.name),
          polygon: room.polygon || [],
          area: room.area || 0,
          walls: room.walls || [],
          center: room.center || { x: 0, y: 0 },
        });
      });
    }

    // Processar portas
    if (result.doors) {
      result.doors.forEach((door: any, index: number) => {
        doors.push({
          id: `door_${index}`,
          type: 'door',
          position: { x: door.x, y: door.y },
          width: door.width || 80,
          rotation: door.rotation || 0,
        });
      });
    }

    // Processar janelas
    if (result.windows) {
      result.windows.forEach((win: any, index: number) => {
        windows.push({
          id: `window_${index}`,
          type: 'window',
          position: { x: win.x, y: win.y },
          width: win.width || 100,
          height: win.height || 120,
          rotation: win.rotation || 0,
        });
      });
    }

    // Calcular bounds
    const bounds = this.calculateBounds(walls);

    return {
      id: `fp_${Date.now()}`,
      walls,
      rooms,
      doors,
      windows,
      scale: this.scale,
      origin: { x: 0, y: 0 },
      dimensions: {
        width: bounds.max.x - bounds.min.x,
        height: bounds.max.y - bounds.min.y,
      },
      bounds,
    };
  }

  // Detecção por Visão Computacional
  private detectWithCV(
    image: HTMLImageElement | HTMLCanvasElement | ImageData,
    _source: string
  ): FloorPlan2D | null {
    // Criar canvas para processamento
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    if (image instanceof HTMLImageElement) {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
    } else if (image instanceof HTMLCanvasElement) {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
    }

    // Obter dados da imagem
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imgData;

    // Converter para escala de cinza
    const gray = this.toGrayscale(data, width, height);

    // Binarização
    const binary = this.otsuThreshold(gray, width, height);

    // Detectar bordas
    const edges = this.detectEdges(binary, width, height);

    // Detectar linhas (Hough)
    const lines = this.houghLines(edges, width, height);

    if (lines.length < 4) {
      console.warn('Not enough lines detected');
      return null;
    }

    // Agrupar linhas em paredes
    const walls = this.groupLinesIntoWalls(lines, width, height);

    if (walls.length < 4) {
      console.warn('Not enough walls detected');
      return null;
    }

    // Detectar cômodos
    const rooms = this.detectRooms(walls, width, height);

    // Detectar aberturas (simplificado)
    const doors = this.detectDoors(edges, walls);
    const windows = this.detectWindows(edges, walls);

    // Calcular bounds
    const bounds = this.calculateBounds(walls);

    return {
      id: `fp_${Date.now()}`,
      walls,
      rooms,
      doors,
      windows,
      scale: this.scale,
      origin: { x: 0, y: 0 },
      dimensions: {
        width: bounds.max.x - bounds.min.x,
        height: bounds.max.y - bounds.min.y,
      },
      bounds,
    };
  }

  // Converter para escala de cinza
  private toGrayscale(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      gray[idx] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    return gray;
  }

  // Threshold de Otsu
  private otsuThreshold(gray: Uint8Array, width: number, height: number): Uint8Array {
    // Calcular histograma
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) {
      hist[gray[i]]++;
    }

    // Calcular threshold
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * hist[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVar = 0;
    let threshold = 0;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);

      if (variance > maxVar) {
        maxVar = variance;
        threshold = t;
      }
    }

    // Aplicar threshold
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      binary[i] = gray[i] > threshold ? 255 : 0;
    }

    return binary;
  }

  // Detectar bordas com Canny simplificado
  private detectEdges(binary: Uint8Array, width: number, height: number): Uint8Array {
    const edges = new Uint8Array(width * height);
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0;
        let gy = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kidx = (ky + 1) * 3 + (kx + 1);
            const pixel = binary[idx] === 255 ? 0 : 255;
            gx += pixel * sobelX[kidx];
            gy += pixel * sobelY[kidx];
          }
        }

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y * width + x] = magnitude > 50 ? 255 : 0;
      }
    }

    return edges;
  }

  // Transformada de Hough para linhas
  private houghLines(
    edges: Uint8Array,
    width: number,
    height: number,
    threshold: number = 100
  ): { x1: number; y1: number; x2: number; y2: number; angle: number; distance: number }[] {
    const maxRho = Math.sqrt(width * width + height * height);
    const numAngles = 180;
    const accumulator = new Uint32Array(Math.ceil(2 * maxRho) * numAngles);
    const lines: { x1: number; y1: number; x2: number; y2: number; angle: number; distance: number }[] = [];

    // Votação
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] === 0) continue;

        for (let theta = 0; theta < 180; theta++) {
          const rad = (theta * Math.PI) / 180;
          const rho = x * Math.cos(rad) + y * Math.sin(rad);
          const idx = Math.round(rho + maxRho) * numAngles + theta;
          accumulator[idx]++;
        }
      }
    }

    // Encontrar picos
    const minVotes = threshold;
    for (let r = 0; r < accumulator.length; r++) {
      if (accumulator[r] < minVotes) continue;

      const rho = (r / numAngles) - maxRho;
      const theta = r % numAngles;
      const rad = (theta * Math.PI) / 180;

      // Calcular pontos da linha
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const x1 = Math.max(0, Math.min(width - 1, rho * cos));
      const y1 = Math.max(0, Math.min(height - 1, rho * sin));
      const x2 = Math.max(0, Math.min(width - 1, x1 + 100 * (-sin)));
      const y2 = Math.max(0, Math.min(height - 1, y1 + 100 * cos));

      lines.push({
        x1: Math.round(x1),
        y1: Math.round(y1),
        x2: Math.round(x2),
        y2: Math.round(y2),
        angle: theta,
        distance: rho,
      });
    }

    return lines;
  }

  // Agrupar linhas em paredes
  private groupLinesIntoWalls(
    lines: { x1: number; y1: number; x2: number; y2: number; angle: number; distance: number }[],
    imgWidth: number,
    imgHeight: number
  ): Wall2D[] {
    const walls: Wall2D[] = [];
    const tolerance = 15; // pixels
    const processed = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      if (processed.has(i)) continue;

      const line = lines[i];
      const length = Math.sqrt(
        Math.pow(line.x2 - line.x1, 2) + Math.pow(line.y2 - line.y1, 2)
      );

      if (length < this.minWallLength) continue;

      // Encontrar linhas similares
      const group: typeof lines = [line];
      processed.add(i);

      for (let j = i + 1; j < lines.length; j++) {
        if (processed.has(j)) continue;

        const line2 = lines[j];
        const angleDiff = Math.abs(line.angle - line2.angle);
        const distDiff = Math.abs(line.distance - line2.distance);

        if (angleDiff < 10 && distDiff < tolerance) {
          group.push(line2);
          processed.add(j);
        }
      }

      // Calcular média da linha
      let totalX1 = 0, totalY1 = 0, totalX2 = 0, totalY2 = 0;
      for (const l of group) {
        totalX1 += l.x1;
        totalY1 += l.y1;
        totalX2 += l.x2;
        totalY2 += l.y2;
      }

      const avgX1 = totalX1 / group.length;
      const avgY1 = totalY1 / group.length;
      const avgX2 = totalX2 / group.length;
      const avgY2 = totalY2 / group.length;

      // Calcular ângulo
      const dx = avgX2 - avgX1;
      const dy = avgY2 - avgY1;
      const isHorizontal = Math.abs(dy) < Math.abs(dx) * 0.3;
      const isVertical = Math.abs(dx) < Math.abs(dy) * 0.3;

      // Determinar se é parede externa
      const isExterior =
        avgX1 < tolerance ||
        avgX1 > imgWidth - tolerance ||
        avgY1 < tolerance ||
        avgY1 > imgHeight - tolerance ||
        avgX2 < tolerance ||
        avgX2 > imgWidth - tolerance ||
        avgY2 < tolerance ||
        avgY2 > imgHeight - tolerance;

      walls.push({
        id: `wall_${walls.length}`,
        start: { x: avgX1, y: avgY1 },
        end: { x: avgX2, y: avgY2 },
        thickness: isHorizontal || isVertical ? 8 : 10,
        isExterior,
        openings: [],
      });
    }

    return walls;
  }

  // Detectar cômodos (simplificado)
  private detectRooms(
    walls: Wall2D[],
    _width: number,
    _height: number
  ): Room2D[] {
    const rooms: Room2D[] = [];

    // Implementação simplificada - detectar cômodos baseado em polígonos fechados
    // Para uma implementação completa, seria necessário usar flood fill ou similar

    // Criar cômodo central se houver paredes
    if (walls.length >= 4) {
      let sumX = 0, sumY = 0;
      for (const wall of walls) {
        sumX += wall.start.x + wall.end.x;
        sumY += wall.start.y + wall.end.y;
      }
      const count = walls.length * 2;
      const centerX = sumX / count;
      const centerY = sumY / count;

      rooms.push({
        id: 'room_main',
        name: 'Ambiente Principal',
        type: 'living',
        polygon: walls.map((w) => w.start),
        area: this.calculatePolygonArea(walls.map((w) => w.start)),
        walls: walls.map((w) => w.id),
        center: { x: centerX, y: centerY },
      });
    }

    return rooms;
  }

  // Detectar portas (simplificado)
  private detectDoors(_edges: Uint8Array, walls: Wall2D[]): Opening2D[] {
    const doors: Opening2D[] = [];
    // Implementação simplificada - detectar aberturas em paredes
    // Procura por gaps nas linhas das paredes

    for (const wall of walls) {
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length < 50) continue;

      // Procurar por espaços na parede
      const steps = Math.floor(length / 10);
      for (let _i = 0; _i < steps; _i++) {
        // Verificar se há uma abertura (menos pixels)
        // Implementação simplificada
      }
    }

    return doors;
  }

  // Detectar janelas
  private detectWindows(_edges: Uint8Array, _walls: Wall2D[]): Opening2D[] {
    return [];
  }

  // Calcular área do polígono
  private calculatePolygonArea(points: Point2D[]): number {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
  }

  // Calcular bounds
  private calculateBounds(walls: Wall2D[]): { min: Point2D; max: Point2D } {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const wall of walls) {
      minX = Math.min(minX, wall.start.x, wall.end.x);
      minY = Math.min(minY, wall.start.y, wall.end.y);
      maxX = Math.max(maxX, wall.start.x, wall.end.x);
      maxY = Math.max(maxY, wall.start.y, wall.end.y);
    }

    return {
      min: { x: minX, y: minY },
      max: { x: maxX, y: maxY },
    };
  }

  // Calcular confiança
  private calculateConfidence(floorPlan: FloorPlan2D): number {
    let confidence = 0;

    // Paredes
    if (floorPlan.walls.length >= 4) confidence += 0.4;
    else if (floorPlan.walls.length >= 3) confidence += 0.2;

    // Cômodos
    if (floorPlan.rooms.length >= 1) confidence += 0.3;

    // Dimensões válidas
    if (floorPlan.dimensions.width > 100 && floorPlan.dimensions.height > 100) {
      confidence += 0.2;
    }

    // Proporção válida
    const ratio = floorPlan.dimensions.width / floorPlan.dimensions.height;
    if (ratio > 0.3 && ratio < 3) confidence += 0.1;

    return Math.min(1, confidence);
  }

  // Criar versão pequena da imagem
  private createSmallImage(
    image: HTMLImageElement | HTMLCanvasElement | ImageData,
    maxDim: number
  ): { dataUrl: string; width: number; height: number } {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    let width: number, height: number;
    if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
      width = image.width;
      height = image.height;
    } else {
      width = image.width;
      height = image.height;
    }

    const ratio = Math.min(maxDim / width, maxDim / height);
    const newWidth = Math.round(width * ratio);
    const newHeight = Math.round(height * ratio);

    canvas.width = newWidth;
    canvas.height = newHeight;

    if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
      ctx.drawImage(image, 0, 0, newWidth, newHeight);
    }

    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.6),
      width: newWidth,
      height: newHeight,
    };
  }

  // Calibrar escala
  setScale(calibration: CalibrationPoint): void {
    const pixelDistance = Math.sqrt(
      Math.pow(calibration.point2.x - calibration.point1.x, 2) +
      Math.pow(calibration.point2.y - calibration.point1.y, 2)
    );
    this.scale = pixelDistance / calibration.realDistance;
  }

  // Obter escala atual
  getScale(): number {
    return this.scale;
  }
}

// Instância singleton
export const floorPlanDetector = new FloorPlanDetector();
