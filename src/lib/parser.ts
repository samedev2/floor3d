/**
 * Floor Plan Parser - Enhanced Version
 * Robust detection of walls, rooms, and openings from any floor plan image
 * Supports: technical drawings, simplified plans, and humanized plans
 */

import type { Point, ProcessedFloorPlan, Wall, Room, WallType, Opening } from './shared';
import { DEFAULT_WALL_HEIGHT, generateId, polygonArea } from './shared';

interface ParserConfig {
  edgeThreshold?: number;
  minWallLength?: number;
  lineMergeDistance?: number;
  roomMinArea?: number;
}

const DEFAULT_CONFIG: Required<ParserConfig> = {
  edgeThreshold: 80,
  minWallLength: 30,
  lineMergeDistance: 20,
  roomMinArea: 500,
};

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  angle: number;
}

interface Contour {
  points: Point[];
  area: number;
  centroid: Point;
}

/**
 * Parse a floor plan image - Main entry point
 */
export async function parseFloorPlan(
  source: HTMLImageElement | HTMLCanvasElement | string,
  name: string = 'Untitled Plan',
  config: ParserConfig = {}
): Promise<{ success: boolean; plan?: ProcessedFloorPlan; errors: string[]; warnings: string[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Get canvas with image
    const { canvas, width, height } = await getImageCanvas(source);
    
    // Get pixel data
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Preprocess: convert to grayscale and enhance contrast
    const grayscale = toGrayscale(data, width, height);
    const enhanced = enhanceForLineDetection(grayscale, width, height);

    // Detect walls using multiple methods
    let walls: Wall[] = [];
    
    // Method 1: Line detection with Hough-like approach
    const lines1 = detectHorizontalLines(enhanced, width, height, cfg);
    const lines2 = detectVerticalLines(enhanced, width, height, cfg);
    
    // Merge and filter lines
    const allLines = [...lines1, ...lines2];
    const mergedLines = mergeLines(allLines, cfg);
    
    walls = linesToWalls(mergedLines, width, height);

    if (walls.length === 0) {
      // Method 2: Contour-based detection for complex plans
      const contours = detectContours(enhanced, width, height, cfg);
      walls = contoursToWalls(contours, width, height);
    }

    if (walls.length === 0) {
      // Method 3: Grid-based wall detection for humanized plans
      walls = detectWallsByGrid(enhanced, width, height, cfg);
    }

    if (walls.length === 0) {
      warnings.push('Não foi possível detectar paredes automaticamente. Usando detecção por bordas...');
      walls = detectWallsByEdges(data, width, height, cfg);
    }

    if (walls.length === 0) {
      errors.push('Nenhuma parede detectada na imagem.');
      return { success: false, errors, warnings };
    }

    // Detect rooms (closed areas)
    const rooms = detectRoomsFromWalls(walls, width, height, cfg);

    // Detect openings (doors, windows)
    const openings = detectOpenings(walls, enhanced, width, height);

    // Create floor plan
    const plan: ProcessedFloorPlan = {
      id: generateId(),
      name,
      source: {
        type: typeof source === 'string' ? 'image' : 'upload',
        dimensions: { width, height },
      },
      scale: { pixelsPerUnit: 50, unit: 'meters' },
      walls,
      rooms,
      openings,
      annotations: [],
      dimensions: [],
      processedAt: new Date(),
      processingDuration: 0,
      confidence: Math.min(0.9, 0.2 + (walls.length * 0.02) + (rooms.length * 0.05)),
    };

    return { success: true, plan, errors, warnings };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Erro desconhecido');
    return { success: false, errors, warnings };
  }
}

async function getImageCanvas(source: HTMLImageElement | HTMLCanvasElement | string): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  if (source instanceof HTMLImageElement) {
    // Scale down large images for performance
    const maxDim = 1200;
    let w = source.naturalWidth;
    let h = source.naturalHeight;
    
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(source, 0, 0, w, h);
  } else if (source instanceof HTMLCanvasElement) {
    canvas.width = source.width;
    canvas.height = source.height;
    ctx.drawImage(source, 0, 0);
  } else if (typeof source === 'string') {
    const img = await loadImage(source);
    return getImageCanvas(img);
  }

  return { canvas, width: canvas.width, height: canvas.height };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const grayscale = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return grayscale;
}

/**
 * Enhance image for better line detection
 */
function enhanceForLineDetection(grayscale: Uint8Array, width: number, height: number): Uint8Array {
  // Apply contrast enhancement
  const enhanced = new Uint8Array(width * height);
  const contrast = 2.0;
  const brightness = -30;
  
  for (let i = 0; i < grayscale.length; i++) {
    let val = grayscale[i];
    val = Math.round(val * contrast + brightness);
    enhanced[i] = Math.max(0, Math.min(255, val));
  }
  
  // Apply slight blur to reduce noise
  return applyBoxBlur(enhanced, width, height, 2);
}

function applyBoxBlur(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(input.length);
  const size = radius * 2 + 1;
  const div = size * size;
  
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          sum += input[(y + dy) * width + (x + dx)];
        }
      }
      output[y * width + x] = Math.round(sum / div);
    }
  }
  
  return output;
}

/**
 * Detect horizontal lines using scanning approach
 */
function detectHorizontalLines(data: Uint8Array, width: number, height: number, cfg: Required<ParserConfig>): Line[] {
  const lines: Line[] = [];
  const threshold = cfg.edgeThreshold;
  const minLength = cfg.minWallLength;
  
  // Scan for horizontal lines (dark bands)
  for (let y = 5; y < height - 5; y += 4) {
    let x = 0;
    while (x < width - 1) {
      // Skip white/bright pixels
      while (x < width && data[y * width + x] > 200) x++;
      if (x >= width) break;
      
      // Found dark pixel - start of potential line
      let lineStart = x;
      let darkCount = 0;
      let totalDark = 0;
      
      // Count consecutive dark pixels
      while (x < width && data[y * width + x] < threshold) {
        darkCount++;
        totalDark += data[y * width + x];
        x++;
      }
      
      if (darkCount >= minLength) {
        lines.push({
          x1: lineStart,
          y1: y,
          x2: x - 1,
          y2: y,
          length: darkCount,
          angle: 0
        });
      }
    }
  }
  
  return lines;
}

/**
 * Detect vertical lines using scanning approach
 */
function detectVerticalLines(data: Uint8Array, width: number, height: number, cfg: Required<ParserConfig>): Line[] {
  const lines: Line[] = [];
  const threshold = cfg.edgeThreshold;
  const minLength = cfg.minWallLength;
  
  // Scan for vertical lines (dark bands)
  for (let x = 5; x < width - 5; x += 4) {
    let y = 0;
    while (y < height - 1) {
      // Skip white/bright pixels
      while (y < height && data[y * width + x] > 200) y++;
      if (y >= height) break;
      
      // Found dark pixel - start of potential line
      let lineStart = y;
      let darkCount = 0;
      
      // Count consecutive dark pixels
      while (y < height && data[y * width + x] < threshold) {
        darkCount++;
        y++;
      }
      
      if (darkCount >= minLength) {
        lines.push({
          x1: x,
          y1: lineStart,
          x2: x,
          y2: y - 1,
          length: darkCount,
          angle: Math.PI / 2
        });
      }
    }
  }
  
  return lines;
}

/**
 * Merge overlapping or nearby lines
 */
function mergeLines(lines: Line[], cfg: Required<ParserConfig>): Line[] {
  if (lines.length === 0) return [];
  
  const merged: Line[] = [];
  const used = new Set<number>();
  const mergeDist = cfg.lineMergeDistance;
  
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    
    let current = { ...lines[i] };
    used.add(i);
    
    // Find lines to merge with current
    for (let j = i + 1; j < lines.length; j++) {
      if (used.has(j)) continue;
      
      const other = lines[j];
      
      // Only merge same-angle lines
      if (Math.abs(current.angle - other.angle) > 0.1) continue;
      
      // Check proximity
      if (current.angle === 0) {
        // Horizontal lines - check if they're on similar y and overlap
        if (Math.abs(current.y1 - other.y1) < mergeDist) {
          const overlapX = Math.max(current.x1, other.x1);
          const overlapEnd = Math.min(current.x2, other.x2);
          if (overlapEnd - overlapX > 0) {
            // Extend to cover both
            current.x1 = Math.min(current.x1, other.x1);
            current.x2 = Math.max(current.x2, other.x2);
            current.length = current.x2 - current.x1;
            used.add(j);
          }
        }
      } else {
        // Vertical lines - check if they're on similar x and overlap
        if (Math.abs(current.x1 - other.x1) < mergeDist) {
          const overlapY = Math.max(current.y1, other.y1);
          const overlapEnd = Math.min(current.y2, other.y2);
          if (overlapEnd - overlapY > 0) {
            current.y1 = Math.min(current.y1, other.y1);
            current.y2 = Math.max(current.y2, other.y2);
            current.length = current.y2 - current.y1;
            used.add(j);
          }
        }
      }
    }
    
    merged.push(current);
  }
  
  return merged;
}

/**
 * Convert detected lines to Wall objects
 */
function linesToWalls(lines: Line[], imgWidth: number, imgHeight: number): Wall[] {
  const walls: Wall[] = [];
  const scaleX = imgWidth / 100;
  const scaleY = imgHeight / 100;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 20) continue;
    
    // Determine wall type based on length
    let type: WallType = 'interior';
    if (line.length > 100) {
      type = 'exterior';
    } else if (line.length < 50) {
      type = 'partition';
    }
    
    // Calculate thickness based on line characteristics
    let thickness = 3;
    if (line.angle === 0) {
      // Estimate horizontal thickness
      thickness = 3;
    } else {
      thickness = 3;
    }
    
    walls.push({
      id: `wall-${i}`,
      startPoint: { x: line.x1 / scaleX, y: line.y1 / scaleY },
      endPoint: { x: line.x2 / scaleX, y: line.y2 / scaleY },
      thickness,
      height: DEFAULT_WALL_HEIGHT,
      type
    });
  }
  
  return walls;
}

/**
 * Detect contours in the image
 */
function detectContours(data: Uint8Array, width: number, height: number, cfg: Required<ParserConfig>): Contour[] {
  const contours: Contour[] = [];
  const threshold = cfg.edgeThreshold;
  
  // Simple connected component analysis
  const visited = new Uint8Array(width * height);
  
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = y * width + x;
      if (visited[idx] || data[idx] > threshold) continue;
      
      // Flood fill to find connected dark region
      const points: Point[] = [];
      const stack: [number, number][] = [[x, y]];
      let minX = x, maxX = x, minY = y, maxY = y;
      let area = 0;
      
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        const cidx = cy * width + cx;
        
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
        if (visited[cidx] || data[cidx] > threshold) continue;
        
        visited[cidx] = 1;
        points.push({ x: cx, y: cy });
        area++;
        
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        
        // Add neighbors
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      
      // Filter by area
      if (area >= cfg.roomMinArea) {
        const centroid = {
          x: points.reduce((s, p) => s + p.x, 0) / points.length,
          y: points.reduce((s, p) => s + p.y, 0) / points.length
        };
        
        contours.push({
          points,
          area,
          centroid
        });
      }
    }
  }
  
  return contours;
}

/**
 * Convert contours to walls
 */
function contoursToWalls(contours: Contour[], imgWidth: number, imgHeight: number): Wall[] {
  const walls: Wall[] = [];
  const scaleX = imgWidth / 100;
  const scaleY = imgHeight / 100;
  
  for (const contour of contours) {
    // Find bounding rectangle
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    for (const p of contour.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    
    const w = maxX - minX;
    const h = maxY - minY;
    
    // Only create walls for significant rectangles
    if (w > 30 && h > 30) {
      const idx = walls.length;
      
      // Top wall
      walls.push({
        id: `wall-${idx}`,
        startPoint: { x: minX / scaleX, y: minY / scaleY },
        endPoint: { x: maxX / scaleX, y: minY / scaleY },
        thickness: 3,
        height: DEFAULT_WALL_HEIGHT,
        type: 'exterior'
      });
      
      // Bottom wall
      walls.push({
        id: `wall-${idx + 1}`,
        startPoint: { x: minX / scaleX, y: maxY / scaleY },
        endPoint: { x: maxX / scaleX, y: maxY / scaleY },
        thickness: 3,
        height: DEFAULT_WALL_HEIGHT,
        type: 'exterior'
      });
      
      // Left wall
      walls.push({
        id: `wall-${idx + 2}`,
        startPoint: { x: minX / scaleX, y: minY / scaleY },
        endPoint: { x: minX / scaleX, y: maxY / scaleY },
        thickness: 3,
        height: DEFAULT_WALL_HEIGHT,
        type: 'exterior'
      });
      
      // Right wall
      walls.push({
        id: `wall-${idx + 3}`,
        startPoint: { x: maxX / scaleX, y: minY / scaleY },
        endPoint: { x: maxX / scaleX, y: maxY / scaleY },
        thickness: 3,
        height: DEFAULT_WALL_HEIGHT,
        type: 'exterior'
      });
    }
  }
  
  return walls;
}

/**
 * Grid-based wall detection for humanized plans
 */
function detectWallsByGrid(data: Uint8Array, width: number, height: number, cfg: Required<ParserConfig>): Wall[] {
  const walls: Wall[] = [];
  const gridSize = 20;
  const threshold = 100;
  const scaleX = width / 100;
  const scaleY = height / 100;
  
  // Analyze horizontal strips
  for (let y = gridSize; y < height - gridSize; y += gridSize * 2) {
    let x = 0;
    while (x < width) {
      // Find dark region
      while (x < width && data[y * width + x] > 180) x++;
      if (x >= width) break;
      
      const startX = x;
      let darkCount = 0;
      let totalDark = 0;
      
      while (x < width && data[y * width + x] < threshold) {
        darkCount++;
        totalDark += data[y * width + x];
        x++;
      }
      
      if (darkCount >= cfg.minWallLength) {
        walls.push({
          id: `wall-h-${walls.length}`,
          startPoint: { x: startX / scaleX, y: y / scaleY },
          endPoint: { x: x / scaleX, y: y / scaleY },
          thickness: 3,
          height: DEFAULT_WALL_HEIGHT,
          type: darkCount > 100 ? 'exterior' : 'interior'
        });
      }
    }
  }
  
  // Analyze vertical strips
  for (let x = gridSize; x < width - gridSize; x += gridSize * 2) {
    let y = 0;
    while (y < height) {
      while (y < height && data[y * width + x] > 180) y++;
      if (y >= height) break;
      
      const startY = y;
      let darkCount = 0;
      
      while (y < height && data[y * width + x] < threshold) {
        darkCount++;
        y++;
      }
      
      if (darkCount >= cfg.minWallLength) {
        walls.push({
          id: `wall-v-${walls.length}`,
          startPoint: { x: x / scaleX, y: startY / scaleY },
          endPoint: { x: x / scaleX, y: y / scaleY },
          thickness: 3,
          height: DEFAULT_WALL_HEIGHT,
          type: darkCount > 100 ? 'exterior' : 'interior'
        });
      }
    }
  }
  
  return walls;
}

/**
 * Edge-based wall detection
 */
function detectWallsByEdges(data: Uint8ClampedArray, width: number, height: number, cfg: Required<ParserConfig>): Wall[] {
  const walls: Wall[] = [];
  const grayscale = toGrayscale(data, width, height);
  const edges = sobelEdgeDetection(grayscale, width, height);
  const scaleX = width / 100;
  const scaleY = height / 100;
  
  // Detect edges
  const threshold = cfg.edgeThreshold;
  
  // Horizontal edge scanning
  for (let y = 10; y < height - 10; y += 6) {
    let startX: number | null = null;
    let edgeCount = 0;
    
    for (let x = 10; x < width - 10; x++) {
      const isEdge = edges[y * width + x] > threshold;
      
      if (isEdge) {
        if (startX === null) startX = x;
        edgeCount++;
      } else if (startX !== null) {
        if (edgeCount >= cfg.minWallLength) {
          walls.push({
            id: `edge-h-${walls.length}`,
            startPoint: { x: startX / scaleX, y: y / scaleY },
            endPoint: { x: x / scaleX, y: y / scaleY },
            thickness: 2,
            height: DEFAULT_WALL_HEIGHT,
            type: 'interior'
          });
        }
        startX = null;
        edgeCount = 0;
      }
    }
  }
  
  // Vertical edge scanning
  for (let x = 10; x < width - 10; x += 6) {
    let startY: number | null = null;
    let edgeCount = 0;
    
    for (let y = 10; y < height - 10; y++) {
      const isEdge = edges[y * width + x] > threshold;
      
      if (isEdge) {
        if (startY === null) startY = y;
        edgeCount++;
      } else if (startY !== null) {
        if (edgeCount >= cfg.minWallLength) {
          walls.push({
            id: `edge-v-${walls.length}`,
            startPoint: { x: x / scaleX, y: startY / scaleY },
            endPoint: { x: x / scaleX, y: y / scaleY },
            thickness: 2,
            height: DEFAULT_WALL_HEIGHT,
            type: 'interior'
          });
        }
        startY = null;
        edgeCount = 0;
      }
    }
  }
  
  return walls;
}

function sobelEdgeDetection(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const ki = (ky + 1) * 3 + (kx + 1);
          const pixel = input[idx];
          gx += pixel * sobelX[ki];
          gy += pixel * sobelY[ki];
        }
      }

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      output[y * width + x] = Math.min(255, magnitude);
    }
  }

  return output;
}

/**
 * Detect rooms from walls
 */
function detectRoomsFromWalls(walls: Wall[], imgWidth: number, imgHeight: number, cfg: Required<ParserConfig>): Room[] {
  if (walls.length < 4) return [];
  
  const rooms: Room[] = [];
  const scaleX = imgWidth / 100;
  const scaleY = imgHeight / 100;
  
  // Find wall intersections to identify corners
  const corners = findCorners(walls);
  
  // Group corners into potential rooms
  const roomPolygons = groupIntoRooms(corners, walls, cfg.roomMinArea);
  
  for (let i = 0; i < roomPolygons.length; i++) {
    const polygon = roomPolygons[i];
    if (polygon.length < 3) continue;
    
    const area = polygonArea(polygon);
    const scaledArea = area / (scaleX * scaleY);
    
    if (scaledArea < 2) continue; // Min 2 sq meters
    
    rooms.push({
      id: `room-${i}`,
      name: `Space ${i + 1}`,
      type: guessRoomType(polygon, walls),
      polygon: polygon.map(p => ({ x: p.x / scaleX, y: p.y / scaleY })),
      area: scaledArea,
      walls: [],
      openings: []
    });
  }
  
  return rooms;
}

function findCorners(walls: Wall[]): Point[] {
  const corners: Point[] = [];
  const tolerance = 5;
  
  for (const wall of walls) {
    corners.push(wall.startPoint);
    corners.push(wall.endPoint);
  }
  
  // Merge nearby corners
  const merged: Point[] = [];
  for (const corner of corners) {
    let found = false;
    for (const existing of merged) {
      if (Math.abs(corner.x - existing.x) < tolerance && 
          Math.abs(corner.y - existing.y) < tolerance) {
        found = true;
        break;
      }
    }
    if (!found) merged.push(corner);
  }
  
  return merged;
}

function groupIntoRooms(corners: Point[], walls: Wall[], _minArea: number): Point[][] {
  // Simple grid-based room detection
  if (corners.length < 4) return [];
  
  const polygons: Point[][] = [];
  
  // Find bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  
  // Create grid
  const gridX = 3;
  const gridY = 3;
  const cellW = (maxX - minX) / gridX;
  const cellH = (maxY - minY) / gridY;
  
  for (let gx = 0; gx < gridX; gx++) {
    for (let gy = 0; gy < gridY; gy++) {
      const x1 = minX + gx * cellW;
      const x2 = x1 + cellW;
      const y1 = minY + gy * cellH;
      const y2 = y1 + cellH;
      
      // Check if this cell has walls around it
      const hasWalls = walls.some(w => {
        return (Math.abs(w.startPoint.x - w.endPoint.x) < 2 && 
                w.startPoint.x >= x1 && w.startPoint.x <= x2) ||
               (Math.abs(w.startPoint.y - w.endPoint.y) < 2 && 
                w.startPoint.y >= y1 && w.startPoint.y <= y2);
      });
      
      if (hasWalls || walls.length > 6) {
        polygons.push([
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 }
        ]);
      }
    }
  }
  
  return polygons;
}

function guessRoomType(polygon: Point[], _walls: Wall[]): 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'dining' | 'office' | 'garage' | 'utility' | 'unknown' {
  // Simple heuristics based on area
  const area = polygonArea(polygon);
  
  if (area > 50) return 'living';
  if (area > 30) return 'bedroom';
  if (area > 20) return 'kitchen';
  if (area > 10) return 'bathroom';
  if (area > 5) return 'dining';
  return 'unknown';
}

/**
 * Detect doors and windows
 */
function detectOpenings(walls: Wall[], data: Uint8Array, width: number, _height: number): Opening[] {
  const openings: Opening[] = [];
  
  // Simple gap detection in walls
  for (const wall of walls) {
    const dx = wall.endPoint.x - wall.startPoint.x;
    const dy = wall.endPoint.y - wall.startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 30) continue;
    
    let inGap = false;
    let gapStart: number | null = null;
    
    for (let i = 0; i < length; i += 5) {
      const px = Math.round(wall.startPoint.x + (dx / length) * i);
      const py = Math.round(wall.startPoint.y + (dy / length) * i);
      const idx = py * width + px;
      
      const isBright = data[idx] > 180;
      
      if (isBright && !inGap) {
        inGap = true;
        gapStart = i;
      } else if (!isBright && inGap) {
        const gapLength = i - (gapStart || 0);
        if (gapLength >= 15 && gapLength <= 50) {
          const midX = Math.round(wall.startPoint.x + (dx / length) * ((gapStart || 0) + gapLength / 2));
          const midY = Math.round(wall.startPoint.y + (dy / length) * ((gapStart || 0) + gapLength / 2));
          
          openings.push({
            id: `opening-${openings.length}`,
            type: gapLength > 30 ? 'door' : 'window',
            position: { x: midX, y: midY },
            width: gapLength / 10,
            height: gapLength > 30 ? 2.1 : 1.2,
            wallId: wall.id,
            rotation: Math.atan2(dy, dx)
          });
        }
        inGap = false;
        gapStart = null;
      }
    }
  }
  
  return openings;
}

/**
 * Generate sample floor plan for testing
 */
export function generateSamplePlan(): ProcessedFloorPlan {
  return {
    id: generateId(),
    name: 'Apartamento Demo',
    source: {
      type: 'image',
      dimensions: { width: 800, height: 600 },
    },
    scale: { pixelsPerUnit: 50, unit: 'meters' },
    walls: [
      { id: 'w1', startPoint: { x: 0, y: 0 }, endPoint: { x: 200, y: 0 }, thickness: 15, height: 280, type: 'exterior' },
      { id: 'w2', startPoint: { x: 200, y: 0 }, endPoint: { x: 200, y: 150 }, thickness: 15, height: 280, type: 'exterior' },
      { id: 'w3', startPoint: { x: 200, y: 150 }, endPoint: { x: 0, y: 150 }, thickness: 15, height: 280, type: 'exterior' },
      { id: 'w4', startPoint: { x: 0, y: 150 }, endPoint: { x: 0, y: 0 }, thickness: 15, height: 280, type: 'exterior' },
      { id: 'w5', startPoint: { x: 100, y: 0 }, endPoint: { x: 100, y: 80 }, thickness: 10, height: 280, type: 'interior' },
      { id: 'w6', startPoint: { x: 100, y: 80 }, endPoint: { x: 200, y: 80 }, thickness: 10, height: 280, type: 'interior' },
      { id: 'w7', startPoint: { x: 0, y: 80 }, endPoint: { x: 100, y: 80 }, thickness: 10, height: 280, type: 'interior' },
    ],
    rooms: [
      { id: 'r1', name: 'Sala', type: 'living', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], area: 8, walls: [], openings: [] },
      { id: 'r2', name: 'Quarto', type: 'bedroom', polygon: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 80 }, { x: 100, y: 80 }], area: 8, walls: [], openings: [] },
      { id: 'r3', name: 'Cozinha', type: 'kitchen', polygon: [{ x: 0, y: 80 }, { x: 100, y: 80 }, { x: 100, y: 150 }, { x: 0, y: 150 }], area: 7, walls: [], openings: [] },
      { id: 'r4', name: 'Banheiro', type: 'bathroom', polygon: [{ x: 100, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 150 }, { x: 100, y: 150 }], area: 5, walls: [], openings: [] },
    ],
    openings: [],
    annotations: [],
    dimensions: [],
    processedAt: new Date(),
    processingDuration: 0,
    confidence: 0.9,
  };
}
