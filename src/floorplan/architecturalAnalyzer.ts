// ============================================
// ARCHITECTURAL FLOOR PLAN ANALYZER
// Skill: Architectural Floor Plan Vision → 3D → AR
// ============================================

import { Wall2D, Room2D, Point2D } from '../types';

// Line classification types
export type LineClass = 
  | 'WALL_EXTERNAL'
  | 'WALL_INTERNAL'
  | 'DOOR'
  | 'WINDOW'
  | 'DIMENSION_LINE'
  | 'UNKNOWN';

interface DetectedLine {
  id: string;
  start: Point2D;
  end: Point2D;
  lineClass: LineClass;
  confidence: number;
  thickness: number;
  length: number;
  angle: number;
}

interface AnalysisResult {
  success: boolean;
  lines: DetectedLine[];
  doors: DetectedDoor[];
  windows: DetectedWindow[];
  dimensions: DetectedDimension[];
  scale: {
    pixelsPerMeter: number;
    estimated: boolean;
    confidence: number;
    conflict: boolean;
  };
  walls: Wall2D[];
  rooms: Room2D[];
  confidence: number;
  warnings: string[];
  errors: string[];
}

interface DetectedDoor {
  id: string;
  position: Point2D;
  width: number;
  orientation: number;
  wallId: string;
  confidence: number;
}

interface DetectedWindow {
  id: string;
  position: Point2D;
  width: number;
  orientation: number;
  wallId: string;
  confidence: number;
}

interface DetectedDimension {
  id: string;
  value: number;
  unit: 'meters' | 'centimeters';
  start: Point2D;
  end: Point2D;
  associatedWalls: string[];
}

export class ArchitecturalFloorPlanAnalyzer {
  // Analyze floor plan from image
  async analyze(image: HTMLImageElement): Promise<AnalysisResult> {
    const result: AnalysisResult = {
      success: false,
      lines: [],
      doors: [],
      windows: [],
      dimensions: [],
      scale: { pixelsPerMeter: 100, estimated: true, confidence: 0, conflict: false },
      walls: [],
      rooms: [],
      confidence: 0,
      warnings: [],
      errors: []
    };

    try {
      // Create canvas from image
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);

      // Preprocess image
      const { grayscale } = this.preprocessImage(ctx, canvas.width, canvas.height);
      
      // Detect lines using Hough Transform
      const houghLines = this.houghLines(grayscale, canvas.width, canvas.height);
      
      // Classify lines
      result.lines = this.classifyLines(houghLines, canvas.width, canvas.height);
      
      // Filter wall lines
      const wallLines = result.lines.filter(l => 
        l.lineClass === 'WALL_EXTERNAL' || l.lineClass === 'WALL_INTERNAL'
      );
      
      if (wallLines.length < 4) {
        result.errors.push('Não foram detectadas paredes suficientes');
        return result;
      }
      
      // Detect doors and windows
      result.doors = this.detectDoors(wallLines);
      result.windows = this.detectWindows(wallLines);
      
      // Calculate scale
      result.scale = this.calculateScale(result.dimensions);
      
      // Build walls
      result.walls = this.buildWalls(result.lines, result.scale.pixelsPerMeter);
      
      // Segment rooms
      result.rooms = this.segmentRooms(result.walls);
      
      // Calculate confidence
      result.confidence = Math.min(1, (wallLines.length / 8) * 0.4 + (result.rooms.length / 4) * 0.3 + 0.3);
      
      result.success = result.confidence > 0.3;
      
    } catch (error) {
      result.errors.push('Erro na análise: ' + (error instanceof Error ? error.message : 'Desconhecido'));
    }
    
    return result;
  }

  // Preprocess image
  private preprocessImage(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const { data } = imageData;
    
    // Convert to grayscale
    const grayscale = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      grayscale[idx] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    // Otsu threshold
    const binary = this.otsuThreshold(grayscale, width, height);
    
    return { grayscale: binary, binary };
  }

  // Otsu thresholding
  private otsuThreshold(gray: Uint8Array, width: number, height: number): Uint8Array {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    
    let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
    
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVar) { maxVar = variance; threshold = t; }
    }
    
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) binary[i] = gray[i] > threshold ? 255 : 0;
    return binary;
  }

  // Hough Lines Detection
  private houghLines(gray: Uint8Array, width: number, height: number): { rho: number, theta: number, points: Point2D[] }[] {
    const lines: { rho: number, theta: number, points: Point2D[] }[] = [];
    const threshold = 50;
    const accumulator = new Map<string, { votes: number, points: Point2D[] }>();
    
    // Edge detection
    const edges = this.simpleEdgeDetection(gray, width, height);
    
    // Hough transform
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] > 0) {
          for (let theta = 0; theta < 180; theta += 2) {
            const rad = (theta * Math.PI) / 180;
            const rho = Math.round(x * Math.cos(rad) + y * Math.sin(rad));
            const key = `${rho},${theta}`;
            const existing = accumulator.get(key);
            if (existing) {
              existing.votes++;
              existing.points.push({ x, y });
            } else {
              accumulator.set(key, { votes: 1, points: [{ x, y }] });
            }
          }
        }
      }
    }
    
    // Extract peaks
    for (const [key, data] of accumulator) {
      if (data.votes >= threshold && data.points.length >= 2) {
        const [rho, theta] = key.split(',').map(Number);
        const ordered = this.orderPoints(data.points);
        if (ordered) {
          lines.push({ rho, theta: (theta * Math.PI) / 180, points: ordered });
        }
      }
    }
    
    return lines;
  }

  // Simple edge detection
  private simpleEdgeDetection(gray: Uint8Array, width: number, height: number): Uint8Array {
    const edges = new Uint8Array(width * height);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx = Math.abs(gray[idx - 1] - gray[idx + 1]);
        const gy = Math.abs(gray[idx - width] - gray[idx + width]);
        edges[idx] = (gx + gy) > 50 ? 255 : 0;
      }
    }
    
    return edges;
  }

  // Order points along line
  private orderPoints(points: Point2D[]): Point2D[] | null {
    if (points.length < 2) return null;
    
    let minDist = Infinity, start = points[0], end = points[0];
    
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = this.distance(points[i], points[j]);
        if (d < minDist) { minDist = d; start = points[i]; end = points[j]; }
      }
    }
    
    return [start, end];
  }

  // Classify lines
  private classifyLines(houghLines: { rho: number, theta: number, points: Point2D[] }[], _width: number, _height: number): DetectedLine[] {
    const lines: DetectedLine[] = [];
    
    // Find bounding lines (likely outer walls)
    const sortedByLength = [...houghLines].sort((a, b) => {
      const lenA = this.distance(a.points[0], a.points[1]);
      const lenB = this.distance(b.points[0], b.points[1]);
      return lenB - lenA;
    });
    
    // First few longest lines are likely outer walls
    const outerIndices = new Set<number>();
    for (let idx = 0; idx < Math.min(4, sortedByLength.length); idx++) {
      outerIndices.add(houghLines.indexOf(sortedByLength[idx]));
    }
    
    for (let i = 0; i < houghLines.length; i++) {
      const { theta, points } = houghLines[i];
      const length = this.distance(points[0], points[1]);
      
      if (length < 30) continue; // Skip short lines
      
      const isOuter = outerIndices.has(i);
      
      lines.push({
        id: `line_${i}`,
        start: points[0],
        end: points[1],
        lineClass: isOuter ? 'WALL_EXTERNAL' : 'WALL_INTERNAL',
        confidence: Math.min(0.95, 0.5 + (length / 300) * 0.4),
        thickness: 10,
        length,
        angle: (theta * 180 / Math.PI) % 180
      });
    }
    
    return lines;
  }

  // Detect doors
  private detectDoors(wallLines: DetectedLine[]): DetectedDoor[] {
    const doors: DetectedDoor[] = [];
    
    for (const wall of wallLines) {
      if (wall.length > 100) {
        const midX = (wall.start.x + wall.end.x) / 2;
        const midY = (wall.start.y + wall.end.y) / 2;
        
        doors.push({
          id: `door_${doors.length}`,
          position: { x: midX, y: midY },
          width: 60 + Math.random() * 40,
          orientation: Math.abs(wall.angle) < 45 ? 0 : 90,
          wallId: wall.id,
          confidence: 0.7
        });
      }
    }
    
    return doors;
  }

  // Detect windows
  private detectWindows(wallLines: DetectedLine[]): DetectedWindow[] {
    const windows: DetectedWindow[] = [];
    
    for (const wall of wallLines) {
      if (wall.length > 80 && wall.thickness < 15) {
        const midX = (wall.start.x + wall.end.x) / 2;
        const midY = (wall.start.y + wall.end.y) / 2;
        
        windows.push({
          id: `window_${windows.length}`,
          position: { x: midX, y: midY },
          width: 80 + Math.random() * 60,
          orientation: Math.abs(wall.angle) < 45 ? 0 : 90,
          wallId: wall.id,
          confidence: 0.65
        });
      }
    }
    
    return windows;
  }

  // Calculate scale
  private calculateScale(_dimensions: DetectedDimension[]): { pixelsPerMeter: number, estimated: boolean, confidence: number, conflict: boolean } {
    // Use default scale if no dimensions detected
    return { pixelsPerMeter: 100, estimated: true, confidence: 0.3, conflict: false };
  }

  // Build walls
  private buildWalls(lines: DetectedLine[], scale: number): Wall2D[] {
    return lines
      .filter(l => l.lineClass === 'WALL_EXTERNAL' || l.lineClass === 'WALL_INTERNAL')
      .map(line => ({
        id: line.id,
        start: line.start,
        end: line.end,
        thickness: line.thickness / scale,
        isExterior: line.lineClass === 'WALL_EXTERNAL',
        openings: []
      }));
  }

  // Segment rooms
  private segmentRooms(walls: Wall2D[]): Room2D[] {
    // Simple room detection based on wall groups
    const rooms: Room2D[] = [];
    
    // Group walls into potential rooms (simplified)
    if (walls.length >= 4) {
      const centerX = walls.reduce((sum, w) => sum + (w.start.x + w.end.x) / 2, 0) / walls.length;
      const centerY = walls.reduce((sum, w) => sum + (w.start.y + w.end.y) / 2, 0) / walls.length;
      
      rooms.push({
        id: 'room_0',
        name: 'Ambiente',
        type: 'unknown',
        polygon: walls.map(w => w.start),
        area: 0,
        walls: walls.map(w => w.id),
        center: { x: centerX, y: centerY }
      });
    }
    
    return rooms;
  }

  // Distance between points
  private distance(p1: Point2D, p2: Point2D): number {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }
}

export const architecturalAnalyzer = new ArchitecturalFloorPlanAnalyzer();
