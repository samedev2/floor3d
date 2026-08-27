import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import { 
  Upload, 
  Eye, 
  Box, 
  Layers, 
  RotateCw, 
  X,
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  Edit3,
  Grid3x3,
  Ruler,
} from 'lucide-react';

// ============================================
// TYPES
// ============================================

import { 
  SemanticObject, 
  RoomData, 
  LAYERS, 
  DimensionalContext 
} from '../floorplan/typesExtensions';
import { 
  HAND_DRAWN_PLAN, 
  buildStructuralPlan, 
} from '../floorplan/structuralIntelligence';
import { openCVArchitecturalParser } from '../floorplan/opencvArchitecturalParser';

interface SourceLine2D {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  semanticClass: 'WALL_EXTERNAL' | 'WALL_INTERNAL' | 'DOOR' | 'WINDOW' | 'UNKNOWN';
}

// ============================================
// DIMENSIONAL ENGINE - Normalize 2D to 3D world
// ============================================
class DimensionalEngine {
  /**
   * Converts pixel coordinates to world coordinates (meters)
   * centered at origin, scaled to real dimensions
   */
  static pixelToWorld(
    px: number, 
    py: number, 
    context: DimensionalContext
  ): { x: number; z: number } {
    // Center around origin
    const centeredX = px - context.originX;
    const centeredY = py - context.originY;
    
    // Convert to meters
    const x = centeredX / context.pixelsPerMeter;
    const z = centeredY / context.pixelsPerMeter;
    
    return { x, z };
  }

  /**
   * Build dimensional context from detected walls
   * Assumes standard residential scale if no calibration available
   */
  static buildContext(
    lines: SourceLine2D[],
    imageWidth: number,
    imageHeight: number
  ): DimensionalContext {
    // Find bounding box of all lines
    if (lines.length === 0) {
      return {
        totalWidth: 10,
        totalDepth: 8,
        pixelsPerMeter: 50,
        originX: imageWidth / 2,
        originY: imageHeight / 2,
      };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    lines.forEach(line => {
      minX = Math.min(minX, line.start.x, line.end.x);
      maxX = Math.max(maxX, line.start.x, line.end.x);
      minY = Math.min(minY, line.start.y, line.end.y);
      maxY = Math.max(maxY, line.start.y, line.end.y);
    });

    const widthPx = maxX - minX;
    const heightPx = maxY - minY;

    // Auto-scale: assume standard residential plan
    // Typical house: 10m x 8m (or similar)
    // Use the larger dimension as the reference
    const maxDimPx = Math.max(widthPx, heightPx);
    const targetMaxDimM = 10; // 10 meters max dimension
    
    const pixelsPerMeter = maxDimPx / targetMaxDimM;

    return {
      totalWidth: widthPx / pixelsPerMeter,
      totalDepth: heightPx / pixelsPerMeter,
      pixelsPerMeter,
      originX: (minX + maxX) / 2,
      originY: (minY + maxY) / 2,
    };
  }

  /**
   * Calculate bounding box of all walls
   */
  static calculateBounds(objects: SemanticObject[]): { 
    minX: number; maxX: number; 
    minZ: number; maxZ: number;
  } {
    if (objects.length === 0) {
      return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    objects.forEach(obj => {
      const halfL = obj.dimensions.length / 2;
      const halfT = obj.dimensions.thickness / 2;
      
      // For walls, length is along X axis, thickness along Z
      // For floors, length is X, thickness is Z
      const objMinX = obj.position[0] - halfL;
      const objMaxX = obj.position[0] + halfL;
      const objMinZ = obj.position[2] - halfT;
      const objMaxZ = obj.position[2] + halfT;
      
      minX = Math.min(minX, objMinX);
      maxX = Math.max(maxX, objMaxX);
      minZ = Math.min(minZ, objMinZ);
      maxZ = Math.max(maxZ, objMaxZ);
    });

    return { minX, maxX, minZ, maxZ };
  }
}

// ============================================
// EXTRUSION ENGINE - 2D → 3D with dimensional accuracy
// ============================================
class ExtrusionEngine {
  /**
   * Extrude a 2D line into a 3D wall using dimensional context
   */
  static extrudeWall(
    line: SourceLine2D,
    height: number,
    thickness: number,
    isExterior: boolean,
    context: DimensionalContext
  ): SemanticObject {
    // Convert pixel coordinates to world coordinates (meters)
    const startWorld = DimensionalEngine.pixelToWorld(
      line.start.x, line.start.y, context
    );
    const endWorld = DimensionalEngine.pixelToWorld(
      line.end.x, line.end.y, context
    );

    // Calculate 3D geometry
    const dx = endWorld.x - startWorld.x;
    const dz = endWorld.z - startWorld.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    // Center position (mid-point of the line)
    const cx = (startWorld.x + endWorld.x) / 2;
    const cz = (startWorld.z + endWorld.z) / 2;

    return {
      id: `wall_${line.id}`,
      type: 'wall',
      source_2d: line.id,
      position: [cx, height / 2, cz],
      rotation: [0, -angle, 0],
      dimensions: { 
        length: Math.max(0.1, length), // Min 10cm
        thickness, 
        height 
      },
      confidence: 0.95,
      editable: true,
      layer: LAYERS.WALLS,
      isExterior,
    };
  }

  static createFloor(
    room: RoomData,
    height: number = 0.01
  ): SemanticObject {
    const xs = room.polygon.map(p => p.x);
    const zs = room.polygon.map(p => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    
    return {
      id: `floor_${room.id}`,
      type: 'floor',
      source_2d: room.id,
      position: [(minX + maxX) / 2, height, (minZ + maxZ) / 2],
      rotation: [0, 0, 0],
      dimensions: { 
        length: maxX - minX, 
        thickness: maxZ - minZ, 
        height: 0.01 
      },
      confidence: 0.9,
      editable: true,
      layer: LAYERS.FLOORS,
      roomId: room.id,
      name: room.name,
    };
  }

  static createCeiling(
    room: RoomData,
    wallHeight: number
  ): SemanticObject {
    const xs = room.polygon.map(p => p.x);
    const zs = room.polygon.map(p => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    
    return {
      id: `ceiling_${room.id}`,
      type: 'ceiling',
      source_2d: room.id,
      position: [(minX + maxX) / 2, wallHeight, (minZ + maxZ) / 2],
      rotation: [0, 0, 0],
      dimensions: { 
        length: maxX - minX, 
        thickness: maxZ - minZ, 
        height: 0.01 
      },
      confidence: 0.9,
      editable: true,
      layer: LAYERS.CEILINGS,
      roomId: room.id,
      name: room.name,
    };
  }

  /**
   * Detect rooms by finding closed polygons from walls
   * Uses ray casting algorithm
   */
  static detectRooms(walls: SemanticObject[]): RoomData[] {
    const rooms: RoomData[] = [];
    
    if (walls.length === 0) return rooms;
    
    // Use grid sampling to find connected regions
    const bounds = DimensionalEngine.calculateBounds(walls);
    const cellSize = 0.5; // 50cm grid
    
    // Sample grid and label connected components
    const grid = new Map<string, number>();
    let regionId = 0;
    
    for (let z = bounds.minZ; z <= bounds.maxZ; z += cellSize) {
      for (let x = bounds.minX; x <= bounds.maxX; x += cellSize) {
        if (this.isInsideWalls(x, z, walls)) {
          const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
          grid.set(key, regionId);
          regionId++;
        }
      }
    }
    
    // Simple: create one room per detected region (or use first room)
    // For now, return a single room covering the whole area
    if (walls.length >= 4) {
      rooms.push({
        id: 'room_main',
        name: 'Ambiente Principal',
        type: 'living',
        walls: walls.map(w => w.id),
        polygon: [
          { x: bounds.minX, z: bounds.minZ },
          { x: bounds.maxX, z: bounds.minZ },
          { x: bounds.maxX, z: bounds.maxZ },
          { x: bounds.minX, z: bounds.maxZ },
        ],
        area: (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ),
        center: { 
          x: (bounds.minX + bounds.maxX) / 2, 
          z: (bounds.minZ + bounds.maxZ) / 2 
        },
      });
    }
    
    return rooms;
  }

  /**
   * Check if a point is inside the wall polygon (ray casting)
   */
  private static isInsideWalls(
    x: number, 
    z: number, 
    walls: SemanticObject[]
  ): boolean {
    // Check distance to each wall
    // If point is far from all walls, it might be outside
    // For now, simple check: if any wall contains the point in its expanded bbox
    
    for (const wall of walls) {
      if (wall.type !== 'wall') continue;
      
      // Get wall line endpoints
      const halfL = wall.dimensions.length / 2;
      const halfT = wall.dimensions.thickness / 2;
      
      // Skip if wall is far away
      const dx = Math.abs(x - wall.position[0]);
      const dz = Math.abs(z - wall.position[2]);
      
      // Check if point is within wall's bounding box (expanded)
      if (dx < halfL + 0.5 && dz < halfT + 0.5) {
        return false; // Inside a wall, not in a room
      }
    }
    
    return true;
  }
}

// ============================================
// 3D OBJECT RENDERER
// ============================================
function SemanticObjectMesh({ 
  obj, 
  selected, 
  onSelect,
  visible,
  showDimensions
}: { 
  obj: SemanticObject; 
  selected: boolean; 
  onSelect: (id: string) => void;
  visible: boolean;
  showDimensions: boolean;
}) {
  if (!visible) return null;
  
  const getColor = () => {
    if (selected) return '#3B82F6';
    if (obj.type === 'wall') return obj.isExterior ? '#6B7280' : '#94A3B8';
    if (obj.type === 'floor') return '#D1D5DB';
    if (obj.type === 'ceiling') return '#F3F4F6';
    if (obj.type === 'door') return '#92400E';
    if (obj.type === 'window') return '#7DD3FC';
    return '#94A3B8';
  };

  return (
    <group>
      <mesh
        position={obj.position}
        rotation={obj.rotation}
        castShadow={obj.type === 'wall'}
        receiveShadow={obj.type === 'floor'}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(obj.id);
        }}
      >
        <boxGeometry args={[obj.dimensions.length, obj.dimensions.height, obj.dimensions.thickness]} />
        <meshStandardMaterial 
          color={getColor()} 
          roughness={0.8}
          metalness={0.1}
          transparent={obj.type === 'ceiling'}
          opacity={obj.type === 'ceiling' ? 0.4 : 1}
        />
        <Edges 
          threshold={1} 
          color={selected ? '#1D4ED8' : '#1F2937'}
          linewidth={selected ? 2 : 1}
        />
      </mesh>
      
      {/* Show dimensions when selected */}
      {showDimensions && selected && obj.type === 'wall' && (
        <>
          {/* Length line indicator */}
          <mesh position={[obj.position[0], obj.position[1] + 0.01, obj.position[2]]}>
            <boxGeometry args={[obj.dimensions.length * 1.1, 0.02, 0.05]} />
            <meshBasicMaterial color="#3B82F6" />
          </mesh>
        </>
      )}
    </group>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
interface FloorPlanEditor3DProps {
  onClose?: () => void;
}

export function FloorPlanEditor3D({ onClose }: FloorPlanEditor3DProps) {
  const [view, setView] = useState<'upload' | 'editor'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  
  // 3D Objects
  const [objects, setObjects] = useState<SemanticObject[]>([]);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [dimensionalContext, setDimensionalContext] = useState<DimensionalContext | null>(null);
  
  // UI State
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wallHeight, setWallHeight] = useState(2.8);
  const [wallThickness] = useState(0.15);
  const [showLayers, setShowLayers] = useState({
    [LAYERS.WALLS]: true,
    [LAYERS.FLOORS]: true,
    [LAYERS.CEILINGS]: true,
    [LAYERS.DOORS]: true,
    [LAYERS.WINDOWS]: true,
  });
  const [visualizationMode, setVisualizationMode] = useState<'structure' | 'architectural' | 'wireframe'>('architectural');
  const [autoRotate, setAutoRotate] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================
  // PROCESS UPLOAD → EXTRUDE with dimensional accuracy
  // ============================================
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStatus('Carregando arquivo...');

    try {
      const { convertFileToImage } = await import('../lib/pdfConverter');
      const imageDataUrl = await convertFileToImage(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const imgEl = document.createElement('img');
        imgEl.onload = () => resolve(imgEl);
        imgEl.onerror = () => reject(new Error('Falha ao carregar imagem'));
        imgEl.src = imageDataUrl;
      });

      setProcessingStatus('Detectando paredes (OpenCV.js)...');

      // Usa o parser OpenCV (industry standard: HoughLinesP + Canny + findContours)
      const parseResult = await openCVArchitecturalParser.parse(img, {
        onProgress: (msg) => setProcessingStatus(msg),
      });

      if (parseResult.success && parseResult.walls.length >= 4) {
        setProcessingStatus(`Construindo 3D (${parseResult.walls.length} paredes, ${parseResult.rooms.length} cômodos)...`);

        // Constrói walls 2D no formato esperado pelo DimensionalEngine
        const lines: SourceLine2D[] = parseResult.walls.map((w, i) => ({
          id: `line_${i}`,
          start: w.sourceStart || { x: 0, y: 0 },
          end: w.sourceEnd || { x: 0, y: 0 },
          semanticClass: (w.type === 'exterior' ? 'WALL_EXTERNAL' : 'WALL_INTERNAL') as any,
        }));

        // Constrói contexto dimensional baseado no resultado do parser
        const context: DimensionalContext = {
          totalWidth: parseResult.plan!.totalWidth,
          totalDepth: parseResult.plan!.totalDepth,
          pixelsPerMeter: img.width / parseResult.plan!.totalWidth,
          originX: img.width / 2,
          originY: img.height / 2,
        };
        setDimensionalContext(context);

        setProcessingStatus('Extrudando paredes...');

        // Extrude cada parede detectada
        const newObjects: SemanticObject[] = lines.map(line =>
          ExtrusionEngine.extrudeWall(
            line,
            wallHeight,
            line.semanticClass === 'WALL_EXTERNAL' ? 0.25 : 0.15,
            line.semanticClass === 'WALL_EXTERNAL',
            context
          )
        );

        // Usa os cômodos detectados pelo parser (mais precisos)
        const detectedRooms: RoomData[] = parseResult.rooms.map((r) => ({
          id: r.id,
          name: r.name,
          type: 'unknown' as any,
          walls: r.walls,
          polygon: r.floor.map(p => ({ x: p.x, z: p.y })),
          area: r.area,
          center: { x: r.center.x, z: r.center.y },
        }));
        setRooms(detectedRooms);

        // Adiciona piso e teto por cômodo
        detectedRooms.forEach(room => {
          newObjects.push(ExtrusionEngine.createFloor(room));
          newObjects.push(ExtrusionEngine.createCeiling(room, wallHeight));
        });

        // Piso único embaixo (cobre a casa inteira)
        if (parseResult.plan) {
          newObjects.push({
            id: 'ground_floor',
            type: 'floor',
            source_2d: 'ground',
            position: [0, -0.01, 0],
            rotation: [0, 0, 0],
            dimensions: { length: parseResult.plan.totalWidth + 1, thickness: parseResult.plan.totalDepth + 1, height: 0.01 },
            confidence: 1,
            editable: true,
            layer: LAYERS.FLOORS,
            name: 'Piso Térreo',
          });
        }

        setObjects(newObjects);
        setProcessingStatus(`${newObjects.length} objetos 3D gerados`);
        setView('editor');
      } else {
        setError(
          `Não foi possível detectar paredes suficientes. ` +
          `Detectadas: ${parseResult.walls.length}, cômodos: ${parseResult.rooms.length}. ` +
          `Dica: use uma planta com paredes em cor forte (vermelho ou preto).`
        );
      }
    } catch (err) {
      setError('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setIsProcessing(false);
    }
  }, [wallHeight, wallThickness]);

  // ============================================
  // LOAD DEMO - Planta desenhada à mão (7.50m x 11.25m, 2 pavtos)
  // ============================================
  const loadDemo = useCallback(() => {
    setIsProcessing(true);
    setProcessingStatus('Carregando planta desenhada à mão...');
    
    setTimeout(() => {
      // Use the hand-drawn plan intelligence
      const plan = HAND_DRAWN_PLAN;
      
      // Build dimensional context for the plan
      // Plan is 7.50m x 11.25m, origin at bottom-left
      const context: DimensionalContext = {
        totalWidth: plan.totalWidth,
        totalDepth: plan.totalDepth,
        pixelsPerMeter: 1, // 1 unit = 1 meter in the structural intelligence
        originX: plan.totalWidth / 2, // Center at 3.75m
        originY: plan.totalDepth / 2, // Center at 5.625m
      };
      setDimensionalContext(context);
      
      // Build all structural elements
      const { objects: newObjects, rooms: newRooms } = buildStructuralPlan(plan, context);
      
      setObjects(newObjects);
      setRooms(newRooms);
      setView('editor');
      setIsProcessing(false);
    }, 500);
  }, []);

  // ============================================
  // OBJECT ACTIONS
  // ============================================
  const addWall = useCallback(() => {
    const newWall: SemanticObject = {
      id: `wall_new_${Date.now()}`,
      type: 'wall',
      source_2d: `line_manual_${Date.now()}`,
      position: [0, wallHeight / 2, 0],
      rotation: [0, 0, 0],
      dimensions: { length: 3, thickness: wallThickness, height: wallHeight },
      confidence: 1.0,
      editable: true,
      layer: LAYERS.WALLS,
      isExterior: false,
    };
    setObjects(prev => [...prev, newWall]);
    setSelectedId(newWall.id);
  }, [wallHeight, wallThickness]);

  const addRoom = useCallback(() => {
    const newRoomId = `room_new_${Date.now()}`;
    const newRoom: RoomData = {
      id: newRoomId,
      name: `Novo Ambiente`,
      type: 'unknown',
      walls: [],
      polygon: [
        { x: -2, z: -2 },
        { x: 2, z: -2 },
        { x: 2, z: 2 },
        { x: -2, z: 2 },
      ],
      area: 16,
      center: { x: 0, z: 0 },
    };
    
    setRooms(prev => [...prev, newRoom]);
    setObjects(prev => [
      ...prev,
      ExtrusionEngine.createFloor(newRoom),
      ExtrusionEngine.createCeiling(newRoom, wallHeight),
    ]);
  }, [wallHeight]);

  const deleteObject = useCallback((id: string) => {
    setObjects(prev => prev.filter(o => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const updateObject = useCallback((id: string, updates: Partial<SemanticObject>) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedId && e.key === 'Delete') {
        deleteObject(selectedId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, deleteObject]);

  // Recalculate ceiling height when wall height changes
  useEffect(() => {
    setObjects(prev => prev.map(o => {
      if (o.type === 'wall') {
        return { ...o, dimensions: { ...o.dimensions, height: wallHeight }, position: [o.position[0], wallHeight / 2, o.position[2]] };
      }
      if (o.type === 'ceiling') {
        return { ...o, position: [o.position[0], wallHeight, o.position[2]] };
      }
      return o;
    }));
  }, [wallHeight]);

  // Calculate camera distance based on bounds
  const bounds = DimensionalEngine.calculateBounds(objects);
  const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const cameraDistance = Math.max(8, maxDim * 1.5);

  // ============================================
  // UPLOAD VIEW
  // ============================================
  if (view === 'upload') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Grid3x3 className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h1 className="font-bold text-white">Blockout 3D</h1>
              <p className="text-slate-400 text-sm">2D → Paredes → Pisos → Tetos</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-20 h-20 rounded-3xl bg-purple-500/20 flex items-center justify-center mb-6">
            <Ruler className="w-10 h-10 text-purple-400" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Blockout 3D com Base Dimensional</h2>
          <p className="text-slate-400 text-center mb-8 max-w-md">
            Cada linha 2D é extrudada em METROS REAIS. Coordenadas normalizadas, planta centralizada na origem (0,0).
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="w-full max-w-sm space-y-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>{processingStatus || 'Processando...'}</span>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6" />
                  <span>Carregar Planta</span>
                </>
              )}
            </button>

            <button
              onClick={loadDemo}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
            >
              <Box className="w-6 h-6" />
              <span>Planta Desenhada à Mão (7.50m × 11.25m)</span>
            </button>
          </div>

          {error && (
            <div className="mt-6 bg-red-500/20 border border-red-500/50 rounded-xl p-4 max-w-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <div className="mt-8 text-center text-sm text-slate-500 max-w-md">
            <p className="font-medium text-slate-400 mb-2">Como funciona agora:</p>
            <p>1. <strong>Normalização</strong>: planta centralizada em (0,0)</p>
            <p>2. <strong>Escala real</strong>: convertida para metros</p>
            <p>3. <strong>Paredes alinhadas</strong>: seguem a base dimensional</p>
            <p>4. <strong>Coordenadas consistentes</strong>: X = largura, Z = profundidade</p>
            <p>5. <strong>Sem sobreposições</strong>: cada parede tem posição única</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // EDITOR VIEW
  // ============================================
  const selectedObject = objects.find(o => o.id === selectedId);
  const stats = {
    walls: objects.filter(o => o.type === 'wall').length,
    floors: objects.filter(o => o.type === 'floor').length,
    ceilings: objects.filter(o => o.type === 'ceiling').length,
    rooms: rooms.length,
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800/80 backdrop-blur border-b border-slate-700 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <Grid3x3 className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm">Blockout 3D</h1>
            <p className="text-slate-400 text-xs">
              {stats.walls} paredes • {stats.floors} pisos • {stats.ceilings} tetos • {stats.rooms} ambientes
              {dimensionalContext && ` • ${dimensionalContext.totalWidth.toFixed(1)}m × ${dimensionalContext.totalDepth.toFixed(1)}m`}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
              editMode ? 'bg-purple-600 text-white' : 'bg-slate-700 text-white'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            {editMode ? 'Sair' : 'Editar'}
          </button>
          <button
            onClick={() => setShowDimensions(!showDimensions)}
            className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
              showDimensions ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
            }`}
            title="Mostrar dimensões"
          >
            <Ruler className="w-3.5 h-3.5" />
            Dim
          </button>
          <button
            onClick={() => setShowLayersPanel(!showLayersPanel)}
            className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
              showLayersPanel ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Layers
          </button>
          <button
            onClick={() => setView('upload')}
            className="px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs"
          >
            Nova
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 3D Canvas */}
      <div className="flex-1 relative">
        <Canvas
          shadows
          camera={{ position: [cameraDistance, cameraDistance * 0.7, cameraDistance], fov: 60 }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight 
            position={[10, 15, 10]} 
            intensity={0.8} 
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />
          
          {/* Grid with real-world spacing */}
          <gridHelper args={[Math.max(20, maxDim * 2), Math.max(20, maxDim * 2), '#475569', '#334155']} position={[0, -0.01, 0]} />
          
          {/* Render all semantic objects */}
          {objects.map(obj => (
            <SemanticObjectMesh
              key={obj.id}
              obj={obj}
              selected={selectedId === obj.id}
              onSelect={setSelectedId}
              visible={showLayers[obj.layer] !== false}
              showDimensions={showDimensions}
            />
          ))}
          
          <OrbitControls
            enableZoom={true}
            enablePan={true}
            enableRotate={true}
            minDistance={2}
            maxDistance={100}
            maxPolarAngle={Math.PI / 2}
            autoRotate={autoRotate}
            autoRotateSpeed={2}
            target={[0, 0, 0]}
          />
        </Canvas>
      </div>

      {/* Layers Panel (right) */}
      {showLayersPanel && (
        <div className="absolute top-20 right-4 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-56">
          <h3 className="text-white text-sm font-bold mb-2">Camadas (Layers)</h3>
          {Object.entries(showLayers).map(([layer, visible]) => (
            <label key={layer} className="flex items-center gap-2 py-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setShowLayers({ ...showLayers, [layer]: e.target.checked })}
                className="rounded"
              />
              <span className="text-slate-300 flex-1">
                {layer.replace('LAYER_0', '').replace('LAYER_', '')}
              </span>
              <span className="text-slate-500">
                {objects.filter(o => o.layer === layer).length}
              </span>
            </label>
          ))}
          
          {/* Dimensional info */}
          {dimensionalContext && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <h4 className="text-white text-xs font-bold mb-1">Base Dimensional</h4>
              <p className="text-slate-400 text-xs">
                Largura: {dimensionalContext.totalWidth.toFixed(2)}m
              </p>
              <p className="text-slate-400 text-xs">
                Profundidade: {dimensionalContext.totalDepth.toFixed(2)}m
              </p>
              <p className="text-slate-400 text-xs">
                Escala: {dimensionalContext.pixelsPerMeter.toFixed(1)} px/m
              </p>
            </div>
          )}
        </div>
      )}

      {/* Selected Object Editor (Bottom) */}
      {selectedObject && editMode && (
        <div className="absolute bottom-32 left-0 right-0 bg-slate-800/95 backdrop-blur border-t border-slate-700 p-3 z-20">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-white font-bold text-sm">
                  {selectedObject.type === 'wall' ? '🧱 Parede' : 
                   selectedObject.type === 'floor' ? '⬜ Piso' :
                   selectedObject.type === 'ceiling' ? '🔼 Teto' : 'Objeto'}
                </h3>
                <p className="text-slate-400 text-xs">
                  Fonte 2D: {selectedObject.source_2d} • ID: {selectedObject.id}
                </p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {selectedObject.type === 'wall' && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                <div>
                  <label className="text-slate-400 text-xs">Comp. (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedObject.dimensions.length.toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 1;
                      updateObject(selectedObject.id, { 
                        dimensions: { ...selectedObject.dimensions, length: val }
                      });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs">Esp. (m)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={selectedObject.dimensions.thickness.toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0.1;
                      updateObject(selectedObject.id, { 
                        dimensions: { ...selectedObject.dimensions, thickness: val }
                      });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs">Pos X (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedObject.position[0].toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      updateObject(selectedObject.id, { 
                        position: [val, selectedObject.position[1], selectedObject.position[2]] 
                      });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs">Pos Z (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedObject.position[2].toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      updateObject(selectedObject.id, { 
                        position: [selectedObject.position[0], selectedObject.position[1], val] 
                      });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {selectedObject.type === 'wall' && (
                <button
                  onClick={() => updateObject(selectedObject.id, { 
                    isExterior: !selectedObject.isExterior 
                  })}
                  className={`flex-1 py-1.5 rounded text-xs font-medium ${
                    selectedObject.isExterior 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {selectedObject.isExterior ? '🔵 Externa' : '⚪ Interna'}
                </button>
              )}
              <button
                onClick={() => deleteObject(selectedObject.id)}
                className="px-3 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-slate-900 to-transparent z-10">
        <div className="flex justify-center gap-1 mb-2">
          {[
            { mode: 'wireframe' as const, icon: Layers, label: 'Wire' },
            { mode: 'structure' as const, icon: Box, label: 'Estrutura' },
            { mode: 'architectural' as const, icon: Eye, label: 'Realista' },
          ].map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setVisualizationMode(mode)}
              className={`px-2 py-1.5 rounded-lg flex items-center gap-1 ${
                visualizationMode === mode
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="text-xs">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-center gap-1 mb-2">
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`px-2 py-1.5 rounded-lg flex items-center gap-1 ${
              autoRotate ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="text-xs">360°</span>
          </button>
          {editMode && (
            <>
              <button
                onClick={addWall}
                className="px-2 py-1.5 rounded-lg flex items-center gap-1 bg-blue-600 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="text-xs">Parede</span>
              </button>
              <button
                onClick={addRoom}
                className="px-2 py-1.5 rounded-lg flex items-center gap-1 bg-cyan-600 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="text-xs">Ambiente</span>
              </button>
            </>
          )}
        </div>

        {/* Wall Height Slider */}
        <div className="max-w-xs mx-auto bg-slate-800/80 backdrop-blur rounded-xl p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-300 text-xs">Altura paredes</span>
            <span className="text-white text-xs font-bold">{wallHeight.toFixed(1)}m</span>
          </div>
          <input
            type="range"
            min="2"
            max="4"
            step="0.1"
            value={wallHeight}
            onChange={(e) => setWallHeight(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
