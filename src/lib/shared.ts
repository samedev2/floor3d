// Shared Types for FloorVision AR
// Copied from packages/shared for standalone use

export interface Point {
  x: number;
  y: number;
}

export interface Line {
  start: Point;
  end: Point;
}

export interface Polygon {
  points: Point[];
  closed: boolean;
}

export type WallType = 'exterior' | 'interior' | 'partition';
export type OpeningType = 'door' | 'window' | 'arch';
export type RoomType = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'dining' | 'office' | 'garage' | 'utility' | 'unknown';
export type LengthUnit = 'meters' | 'centimeters' | 'feet' | 'inches';

export interface Scale {
  pixelsPerUnit: number;
  unit: LengthUnit;
}

export interface Wall {
  id: string;
  startPoint: Point;
  endPoint: Point;
  thickness: number;
  height: number;
  type: WallType;
}

export interface Opening {
  id: string;
  type: OpeningType;
  position: Point;
  width: number;
  height: number;
  wallId: string;
  rotation: number;
}

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  polygon: Point[];
  area: number;
  walls: string[];
  openings: string[];
  floorColor?: string;
  ceilingHeight?: number;
}

export interface Annotation {
  id: string;
  type: 'measurement' | 'label' | 'arrow' | 'note';
  position: Point;
  content: string;
  style?: {
    color?: string;
    fontSize?: number;
  };
}

export interface Dimension {
  start: Point;
  end: Point;
  value: number;
  label: string;
}

export interface ProcessedFloorPlan {
  id: string;
  name: string;
  source: {
    type: 'image' | 'camera' | 'upload';
    filename?: string;
    dimensions: { width: number; height: number };
  };
  scale: Scale;
  walls: Wall[];
  rooms: Room[];
  openings: Opening[];
  annotations: Annotation[];
  dimensions: Dimension[];
  processedAt: Date;
  processingDuration: number;
  confidence: number;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Material {
  id: string;
  name: string;
  color: string;
  roughness?: number;
  metalness?: number;
  texture?: string;
  opacity?: number;
}

export interface FloorPlan3D {
  id: string;
  planId: string;
  scale: number;
  walls: any[];
  rooms: any[];
  globalHeight: number;
  materials: Material[];
  boundingBox: {
    min: Vector3D;
    max: Vector3D;
    center: Vector3D;
  };
}

export const DEFAULT_WALL_HEIGHT = 2.8;
export const DEFAULT_WALL_THICKNESS = 0.15;
export const DEFAULT_DOOR_WIDTH = 0.90;
export const DEFAULT_DOOR_HEIGHT = 2.10;
export const DEFAULT_WINDOW_HEIGHT_FROM_FLOOR = 0.90;

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}
