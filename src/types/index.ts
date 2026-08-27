// ============================================
// ARQUITETURA MODULAR - TIPOS PRINCIPAIS
// ============================================

// Sistema de coordenadas 2D
export interface Point2D {
  x: number;
  y: number;
}

// Sistema de coordenadas 3D
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

// Parede 2D detectada na planta
export interface Wall2D {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number;
  isExterior: boolean;
  openings: Opening2D[];
}

// Abertura (porta ou janela)
export interface Opening2D {
  id: string;
  type: 'door' | 'window';
  position: Point2D;
  width: number;
  height?: number;
  rotation: number;
}

// Cômodo identificado
export interface Room2D {
  id: string;
  name: string;
  type: RoomType;
  polygon: Point2D[];
  area: number;
  walls: string[];
  center: Point2D;
}

export type RoomType = 
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'corridor'
  | 'staircase'
  | 'garage'
  | 'balcony'
  | 'dining'
  | 'office'
  | 'storage'
  | 'unknown';

// Planta 2D analisada
export interface FloorPlan2D {
  id: string;
  walls: Wall2D[];
  rooms: Room2D[];
  doors: Opening2D[];
  windows: Opening2D[];
  scale: number;
  origin: Point2D;
  dimensions: { width: number; height: number };
  bounds: { min: Point2D; max: Point2D };
}

// Parede 3D reconstruída
export interface Wall3D {
  id: string;
  position: Point3D;
  length: number;
  height: number;
  thickness: number;
  rotation: number; // em radianos
  openings: Opening3D[];
  material?: string;
  color?: string;
}

// Abertura 3D
export interface Opening3D {
  id: string;
  type: 'door' | 'window';
  position: Point3D; // centro da abertura
  width: number;
  height: number;
  rotation: number;
  depth?: number;
}

// Cômodo 3D
export interface Room3D {
  id: string;
  name: string;
  type: RoomType;
  walls: string[];
  floorArea: Point3D[];
  center: Point3D;
  height: number;
  floorMaterial?: string;
  wallMaterial?: string;
}

// Modelo 3D reconstruído
export interface Model3D {
  id: string;
  walls: Wall3D[];
  rooms: Room3D[];
  floorPlan: FloorPlan2D;
  scale: ScaleConfig;
  coordinateSystem: CoordinateSystem;
  metadata: ModelMetadata;
}

// Configuração de escala
export interface ScaleConfig {
  pixelsPerMeter: number;
  calibrationPoints?: CalibrationPoint[];
  isCalibrated: boolean;
}

// Ponto de calibração
export interface CalibrationPoint {
  point1: Point2D;
  point2: Point2D;
  realDistance: number; // em metros
}

// Sistema de coordenadas local da planta
export interface CoordinateSystem {
  origin: Point2D;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

// Metadados do modelo
export interface ModelMetadata {
  createdAt: Date;
  sourceImage?: string;
  sourceType: 'camera' | 'upload' | 'demo';
  processingTime: number;
  detectedElements: string[];
}

// ============================================
// AR SYSTEM TYPES
// ============================================

// Estado do AR
export type ARState = 
  | 'initializing'
  | 'requesting_permission'
  | 'camera_active'
  | 'scanning'
  | 'detecting_surface'
  | 'detecting_floorplan'
  | 'tracking'
  | 'calibrating'
  | 'model_loading'
  | 'ar_active'
  | 'error'
  | 'unsupported';

// Nível de suporte AR
export type ARSupportLevel = 
  | 'full'      // WebXR + ARCore/ARKit
  | 'image'     // Image tracking
  | 'surface'   // Surface detection + manual positioning
  | 'basic';    // 3D view only

// Info de suporte AR
export interface ARSupportInfo {
  level: ARSupportLevel;
  hasWebXR: boolean;
  hasARCore: boolean;
  hasARKit: boolean;
  hasImageTracking: boolean;
  message: string;
}

// Pose da câmera AR
export interface ARPose {
  position: Point3D;
  rotation: Point3D; // Euler angles
  quaternion: { x: number; y: number; z: number; w: number };
  timestamp: number;
}

// Anchor AR
export interface ARAnchor {
  id: string;
  position: Point3D;
  rotation: Point3D;
  scale: number;
  type: 'image' | 'surface' | 'manual';
}

// Configuração AR
export interface ARConfig {
  enablePlaneDetection: boolean;
  enableImageTracking: boolean;
  enableHitTesting: boolean;
  enableLightEstimation: boolean;
  planeVisualization: boolean;
  debugMode: boolean;
}

// ============================================
// VISUALIZATION MODES
// ============================================

export type VisualizationMode = 
  | 'wireframe'
  | 'structure'
  | 'architectural';

export interface VisualizationConfig {
  mode: VisualizationMode;
  showWalls: boolean;
  showDoors: boolean;
  showWindows: boolean;
  showRooms: boolean;
  showFloor: boolean;
  showCeiling: boolean;
  showDimensions: boolean;
  wallHeight: number;
  wallThickness: number;
  materials: MaterialConfig;
}

// Configuração de materiais
export interface MaterialConfig {
  walls: WallMaterial;
  floor: FloorMaterial;
  ceiling: CeilingMaterial;
  doors: DoorMaterial;
  windows: WindowMaterial;
}

export interface WallMaterial {
  color: string;
  opacity: number;
  wireframe: boolean;
  texture?: string;
}

export interface FloorMaterial {
  color: string;
  opacity: number;
  wireframe: boolean;
  texture?: string;
}

export interface CeilingMaterial {
  visible: boolean;
  color: string;
  opacity: number;
}

export interface DoorMaterial {
  color: string;
  style: 'simple' | 'framed' | 'glass';
}

export interface WindowMaterial {
  color: string;
  style: 'simple' | 'framed' | 'glass';
  showGlass: boolean;
}

// ============================================
// INTERACTION
// ============================================

// Estado de interação
export interface InteractionState {
  selectedWall: string | null;
  selectedRoom: string | null;
  selectedOpening: string | null;
  isDragging: boolean;
  isRotating: boolean;
  isScaling: boolean;
}

// Histórico de ações para undo/redo
export interface ActionHistory {
  actions: ModelAction[];
  currentIndex: number;
}

export interface ModelAction {
  type: ActionType;
  payload: any;
  timestamp: number;
}

export type ActionType = 
  | 'scale_change'
  | 'height_change'
  | 'material_change'
  | 'wall_delete'
  | 'opening_add'
  | 'opening_delete';

// ============================================
// UI STATE
// ============================================

// Estado do scanner AR
export interface ARScannerState {
  status: ARState;
  progress: number;
  message: string;
  detectedFloorPlan: FloorPlan2D | null;
  detectedSurface: boolean;
  detectedImage: boolean;
  trackingQuality: TrackingQuality;
}

// Qualidade de tracking
export type TrackingQuality = 'lost' | 'limited' | 'normal' | 'good';

// Estado da calibração
export interface CalibrationState {
  isActive: boolean;
  step: CalibrationStep;
  calibrationPoints: CalibrationPoint[];
  scale: number | null;
}

export type CalibrationStep = 
  | 'waiting'
  | 'select_first'
  | 'select_second'
  | 'enter_distance'
  | 'calculating'
  | 'complete';

// Resultado de detecção
export interface DetectionResult {
  success: boolean;
  floorPlan: FloorPlan2D | null;
  confidence: number;
  processingTime: number;
  method: DetectionMethod;
  errors: string[];
  warnings: string[];
}

export type DetectionMethod = 
  | 'ai'
  | 'cv'
  | 'hybrid'
  | 'manual';

// Câmera do dispositivo
export interface CameraStream {
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  isActive: boolean;
  facingMode: 'user' | 'environment';
}

// Configuração da aplicação
export interface AppConfig {
  ar: ARConfig;
  visualization: VisualizationConfig;
  detection: DetectionConfig;
  performance: PerformanceConfig;
}

export interface DetectionConfig {
  enableAI: boolean;
  enableCV: boolean;
  aiTimeout: number;
  minWallLength: number;
  minRoomArea: number;
  confidenceThreshold: number;
}

export interface PerformanceConfig {
  targetFPS: number;
  maxTextureSize: number;
  enableShadows: boolean;
  enablePostProcessing: boolean;
  modelComplexity: 'low' | 'medium' | 'high';
}
