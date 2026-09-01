/**
 * Plant Import Core
 *
 * Lógica UNIFICADA de import de planta 2D, compartilhada entre
 * App.tsx (botão azul principal) e PlantLibrary.tsx (submenu).
 *
 * Pipeline (3-tier cascade):
 *  1) Gemini AI (online, melhor) — se tem API key
 *  2) Parser local (offline) — axis-line + refinamentos
 *  3) Fallback simples (sempre funciona)
 *
 * Sempre salva a imagem original em localStorage para reuso
 * (chat IA, refazer parse, etc).
 */

import { axisLineParser } from '../floorplan/axisLineParser';
import { simpleFallbackParser } from '../floorplan/simpleFallbackParser';
import { geminiChat, hasApiKey, type GeminiFloorPlan } from './geminiChat';
import { convertFileToImage } from './pdfConverter';
import type { GeminiFloorPlan as GeminiPlan } from './geminiChat';

export type ImportSource = 'gemini' | 'parser' | 'fallback';

export interface ImportProgress {
  stage: 'loading' | 'gemini' | 'parser' | 'fallback' | 'finalizing';
  message: string;
  percent?: number;
}

export interface ImportResult {
  success: boolean;
  source: ImportSource;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  plan: GeminiFloorPlan;
  warnings: string[];
  errors: string[];
  stats: {
    wallCount: number;
    externalWalls: number;
    internalWalls: number;
    roomCount: number;
    widthMeters: number;
    heightMeters: number;
    totalArea: number;
    processingTimeMs: number;
  };
}

// Cache da última imagem (sempre preenchido, mesmo se parsing falhar)
const LAST_IMAGE_KEY = 'floorvision_last_image';

export function getLastImage(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(LAST_IMAGE_KEY);
}

export function setLastImage(dataUrl: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_IMAGE_KEY, dataUrl);
}

// ============================================
// CONVERSÕES DE FORMATO
// ============================================
function axisResultToGeminiPlan(
  result: { plan: any; walls: any[]; rooms: any[] },
  img: HTMLImageElement
): GeminiFloorPlan {
  const cx = result.plan.totalWidth / 2;
  const cz = result.plan.totalDepth / 2;
  const ppm = img.width / result.plan.totalWidth;

  return {
    widthMeters: result.plan.totalWidth,
    heightMeters: result.plan.totalDepth,
    walls: result.walls.map(w => ({
      start: {
        x: ((w.sourceStart?.x || 0) / ppm) - cx + cx,
        y: ((w.sourceStart?.y || 0) / ppm) - cz + cz,
      },
      end: {
        x: ((w.sourceEnd?.x || 0) / ppm) - cx + cx,
        y: ((w.sourceEnd?.y || 0) / ppm) - cz + cz,
      },
      thickness: w.thickness,
      type: w.type === 'exterior' ? 'exterior' : 'interior',
    })),
    rooms: result.rooms.map(r => ({
      name: r.name || 'Cômodo',
      type: 'unknown',
      polygon: (r.floor || []).map((p: any) => ({
        x: (p.x || 0) + cx,
        y: (p.z || 0) + cz,
      })),
      area: r.area,
    })),
    notes: 'Detectado por parser local (offline)',
  };
}

function fallbackToGeminiPlan(
  result: { plan: any; walls: any[]; rooms: any[]; warnings: string[] }
): GeminiFloorPlan {
  return {
    widthMeters: result.plan.totalWidth,
    heightMeters: result.plan.totalDepth,
    walls: result.walls.map(w => ({
      start: { x: w.sourceStart?.x ?? 0, y: w.sourceStart?.y ?? 0 },
      end: { x: w.sourceEnd?.x ?? 0, y: w.sourceEnd?.y ?? 0 },
      thickness: w.thickness,
      type: w.type === 'exterior' ? 'exterior' : 'interior',
    })),
    rooms: result.rooms.map(r => ({
      name: r.name,
      type: 'unknown',
      polygon: r.floor || [],
      area: r.area,
    })),
    notes: result.warnings[0] || 'Estrutura padrão gerada',
  };
}

// ============================================
// PIPELINE PRINCIPAL
// ============================================
export async function importFloorPlan(
  file: File,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  onProgress?.({ stage: 'loading', message: 'Carregando arquivo...' });

  // 1) Converte PDF se necessário, ou lê como imagem
  const imageDataUrl = await convertFileToImage(file);

  // 2) Carrega como Image
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const imgEl = new Image();
    imgEl.onload = () => resolve(imgEl);
    imgEl.onerror = () => reject(new Error('Falha ao carregar imagem'));
    imgEl.src = imageDataUrl;
  });

  // 3) SEMPRE salva no localStorage (mesmo se parsing falhar)
  setLastImage(imageDataUrl);

  // 4) ESTRATÉGIA 1: Gemini AI
  if (hasApiKey()) {
    try {
      onProgress?.({ stage: 'gemini', message: 'Gemini AI analisando...' });
      const plan = await geminiChat.analyzeImage(imageDataUrl);
      if (plan && plan.walls.length >= 4) {
        const extCount = plan.walls.filter(w => w.type === 'exterior').length;
        const intCount = plan.walls.filter(w => w.type !== 'exterior').length;
        return {
          success: true,
          source: 'gemini',
          imageDataUrl,
          imageWidth: img.width,
          imageHeight: img.height,
          plan,
          warnings: [`Gemini AI detectou ${plan.walls.length} paredes`],
          errors,
          stats: {
            wallCount: plan.walls.length,
            externalWalls: extCount,
            internalWalls: intCount,
            roomCount: plan.rooms.length,
            widthMeters: plan.widthMeters,
            heightMeters: plan.heightMeters,
            totalArea: plan.widthMeters * plan.heightMeters,
            processingTimeMs: Date.now() - startTime,
          },
        };
      }
    } catch (e: any) {
      errors.push(`Gemini: ${e.message}`);
      // Continua para fallback
    }
  }

  // 5) ESTRATÉGIA 2: Parser local
  try {
    onProgress?.({ stage: 'parser', message: 'Parser local (offline)...' });
    const result = await axisLineParser.parse(img, {
      onProgress: msg => onProgress?.({ stage: 'parser', message: msg }),
    });

    if (result.success && result.walls.length >= 4) {
      const plan = axisResultToGeminiPlan(result, img);
      const extCount = plan.walls.filter(w => w.type === 'exterior').length;
      const intCount = plan.walls.filter(w => w.type !== 'exterior').length;
      warnings.push(...result.warnings);
      return {
        success: true,
        source: 'parser',
        imageDataUrl,
        imageWidth: img.width,
        imageHeight: img.height,
        plan,
        warnings,
        errors,
        stats: {
          wallCount: plan.walls.length,
          externalWalls: extCount,
          internalWalls: intCount,
          roomCount: plan.rooms.length,
          widthMeters: plan.widthMeters,
          heightMeters: plan.heightMeters,
          totalArea: plan.widthMeters * plan.heightMeters,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }
  } catch (e: any) {
    errors.push(`Parser: ${e.message}`);
  }

  // 6) ESTRATÉGIA 3: Fallback simples
  try {
    onProgress?.({ stage: 'fallback', message: 'Estrutura padrão...' });
    const fallback = await simpleFallbackParser.parse(img);
    if (fallback.success) {
      const plan = fallbackToGeminiPlan(fallback);
      const extCount = plan.walls.filter(w => w.type === 'exterior').length;
      const intCount = plan.walls.filter(w => w.type !== 'exterior').length;
      warnings.push(fallback.warnings[0] || 'Estrutura padrão gerada');
      warnings.push('Para melhor detecção, configure a chave Gemini em Configurações.');
      return {
        success: true,
        source: 'fallback',
        imageDataUrl,
        imageWidth: img.width,
        imageHeight: img.height,
        plan,
        warnings,
        errors,
        stats: {
          wallCount: plan.walls.length,
          externalWalls: extCount,
          internalWalls: intCount,
          roomCount: plan.rooms.length,
          widthMeters: plan.widthMeters,
          heightMeters: plan.heightMeters,
          totalArea: plan.widthMeters * plan.heightMeters,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }
  } catch (e: any) {
    errors.push(`Fallback: ${e.message}`);
  }

  // Se chegou aqui, falhou
  return {
    success: false,
    source: 'fallback',
    imageDataUrl,
    imageWidth: img.width,
    imageHeight: img.height,
    plan: geminiChat.simpleFallback(),
    warnings,
    errors: [...errors, 'Todas as estratégias falharam'],
    stats: {
      wallCount: 0,
      externalWalls: 0,
      internalWalls: 0,
      roomCount: 0,
      widthMeters: 0,
      heightMeters: 0,
      totalArea: 0,
      processingTimeMs: Date.now() - startTime,
    },
  };
}

// ============================================
// PLANT → MODEL 3D
// ============================================
import type { RoomData } from '../floorplan/typesExtensions';
import { LAYERS } from '../floorplan/typesExtensions';

export interface Model3DObjects {
  objects: any[];
  rooms: RoomData[];
}

/**
 * Converte um plano importado em objetos 3D para visualização
 */
export function planToModel3D(plan: GeminiPlan, ceilingHeight: number = 2.80): Model3DObjects {
  const cx = plan.widthMeters / 2;
  const cz = plan.heightMeters / 2;

  const objects: any[] = [];
  let extCount = 0, intCount = 0;
  plan.walls.forEach((w, i) => {
    const sx = w.start.x - cx;
    const sz = w.start.y - cz;
    const ex = w.end.x - cx;
    const ez = w.end.y - cz;
    const length = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
    if (length < 0.1) return;
    if (w.type === 'exterior') extCount++; else intCount++;
    objects.push({
      id: `wall_${i}`,
      type: 'wall',
      source_2d: `wall_${i}`,
      position: [(sx + ex) / 2, ceilingHeight / 2, (sz + ez) / 2],
      rotation: [0, -Math.atan2(ez - sz, ex - sx), 0],
      dimensions: { length, thickness: w.thickness, height: ceilingHeight },
      confidence: 1.0,
      editable: true,
      layer: LAYERS.WALLS,
      isExterior: w.type === 'exterior',
    });
  });

  const rooms: RoomData[] = plan.rooms.map((r, i) => {
    const center = r.polygon.reduce(
      (acc, p) => ({ x: acc.x + p.x, z: acc.z + p.y }),
      { x: 0, z: 0 }
    );
    if (r.polygon.length > 0) {
      center.x /= r.polygon.length;
      center.z /= r.polygon.length;
    }
    return {
      id: `room_${i}`,
      name: r.name,
      type: r.type as any,
      walls: [],
      polygon: r.polygon.map(p => ({ x: p.x - cx, z: p.y - cz })),
      area: r.area,
      center: { x: center.x - cx, z: center.z - cz },
    };
  });

  rooms.forEach(room => {
    const size = Math.max(2, Math.sqrt(Math.max(1, room.area)) * 1.2);
    objects.push({
      id: `floor_${room.id}`,
      type: 'floor',
      source_2d: room.id,
      position: [room.center.x, 0.01, room.center.z],
      rotation: [0, 0, 0],
      dimensions: { length: size, thickness: size, height: 0.02 },
      confidence: 1,
      editable: true,
      layer: LAYERS.FLOORS,
      roomId: room.id,
      name: room.name,
    });
    objects.push({
      id: `ceiling_${room.id}`,
      type: 'ceiling',
      source_2d: room.id,
      position: [room.center.x, ceilingHeight, room.center.z],
      rotation: [0, 0, 0],
      dimensions: { length: size, thickness: size, height: 0.02 },
      confidence: 1,
      editable: true,
      layer: LAYERS.CEILINGS,
      roomId: room.id,
      name: room.name,
    });
  });

  // Piso térreo (chão)
  objects.push({
    id: 'ground_floor',
    type: 'floor',
    source_2d: 'ground',
    position: [0, -0.01, 0],
    rotation: [0, 0, 0],
    dimensions: {
      length: plan.widthMeters + 0.5,
      thickness: plan.heightMeters + 0.5,
      height: 0.02,
    },
    confidence: 1,
    editable: true,
    layer: LAYERS.FLOORS,
    name: 'Piso Térreo',
  });

  return { objects, rooms };
}

/**
 * Converte um plano importado em formato FloorPlan (legacy)
 */
export function planToFloorPlan(plan: GeminiPlan, ceilingHeight: number = 2.80) {
  return {
    projectName: 'Planta Importada',
    totalArea: plan.widthMeters * plan.heightMeters,
    totalWidth: plan.widthMeters,
    totalDepth: plan.heightMeters,
    wallHeight: ceilingHeight,
    floors: 1,
    vertices: [],
    walls: plan.walls.map((w, i) => ({
      id: `W${i}`,
      length: Math.sqrt((w.end.x - w.start.x) ** 2 + (w.end.y - w.start.y) ** 2),
      thickness: w.thickness,
      height: ceilingHeight,
      type: w.type,
      sourceStart: { x: 0, y: 0 },
      sourceEnd: { x: 0, y: 0 },
    })),
    dimensions: [],
    rooms: plan.rooms.map((r, i) => ({
      id: `R${i}`,
      name: r.name,
      type: r.type,
      walls: [],
      floor: r.polygon,
      area: r.area,
      center: { x: 0, y: 0 },
    })),
  };
}
