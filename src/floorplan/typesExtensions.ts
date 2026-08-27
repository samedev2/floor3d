// Tipos compartilhados para Structural Intelligence

export interface SemanticObject {
  id: string;
  type: 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'room';
  source_2d: string;
  position: [number, number, number];
  rotation: [number, number, number];
  dimensions: { length: number; thickness: number; height: number };
  confidence: number;
  editable: boolean;
  layer: string;
  isExterior?: boolean;
  estimated?: boolean;
  roomId?: string;
  name?: string;
}

export interface RoomData {
  id: string;
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'corridor' | 'staircase' | 'unknown';
  walls: string[];
  polygon: { x: number; z: number }[];
  area: number;
  center: { x: number; z: number };
}

export const LAYERS = {
  REFERENCE: 'LAYER_00_REFERENCE',
  WALLS: 'LAYER_01_WALLS',
  FLOORS: 'LAYER_02_FLOORS',
  CEILINGS: 'LAYER_03_CEILINGS',
  DOORS: 'LAYER_04_DOORS',
  WINDOWS: 'LAYER_05_WINDOWS',
  FURNITURE: 'LAYER_06_FURNITURE',
};

export interface DimensionalContext {
  totalWidth: number;
  totalDepth: number;
  pixelsPerMeter: number;
  originX: number;
  originY: number;
}
