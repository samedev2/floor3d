/**
 * 3D Generator - Simplified Version
 * Converts 2D floor plan to 3D model
 */

import type { ProcessedFloorPlan, FloorPlan3D, Vector3D } from './shared';

interface GeneratorConfig {
  defaultWallHeight?: number;
  defaultWallThickness?: number;
  scale?: number;
}

const DEFAULT_CONFIG: Required<GeneratorConfig> = {
  defaultWallHeight: 2.8,
  defaultWallThickness: 0.15,
  scale: 1,
};

/**
 * Generate 3D model from floor plan
 */
export function generate3DModel(
  plan: ProcessedFloorPlan,
  config: GeneratorConfig = {}
): FloorPlan3D {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const wall of plan.walls) {
    minX = Math.min(minX, wall.startPoint.x, wall.endPoint.x);
    minY = Math.min(minY, wall.startPoint.y, wall.endPoint.y);
    maxX = Math.max(maxX, wall.startPoint.x, wall.endPoint.x);
    maxY = Math.max(maxY, wall.startPoint.y, wall.endPoint.y);
  }

  const center: Vector3D = {
    x: (minX + maxX) / 2,
    y: cfg.defaultWallHeight / 2,
    z: (minY + maxY) / 2,
  };

  return {
    id: `3d-${plan.id}`,
    planId: plan.id,
    scale: cfg.scale,
    walls: plan.walls.map(w => ({
      ...w,
      height: w.height || cfg.defaultWallHeight,
      thickness: w.thickness || cfg.defaultWallThickness,
    })),
    rooms: plan.rooms,
    globalHeight: cfg.defaultWallHeight,
    materials: [
      { id: 'wall', name: 'wall', color: '#E2E8F0', roughness: 0.9 },
      { id: 'floor', name: 'floor', color: '#94A3B8', roughness: 0.8 },
    ],
    boundingBox: {
      min: { x: minX, y: 0, z: minY },
      max: { x: maxX, y: cfg.defaultWallHeight, z: maxY },
      center,
    },
  };
}
