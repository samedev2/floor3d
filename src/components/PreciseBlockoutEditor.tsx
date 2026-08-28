import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges, TransformControls, Grid } from '@react-three/drei';
import {
  Box,
  X,
  Loader2,
  Trash2,
  Grid3x3,
  Move,
  RotateCw,
  Layers,
} from 'lucide-react';
import {
  HAND_DRAWN_PLAN,
  CASA_6X8_PLAN,
  StructuralPlan,
} from '../floorplan/structuralIntelligence';
import { useStore } from '../store';

// ============================================
// PRECISE BLOCKOUT SYSTEM
// Gera estrutura 3D com paredes alinhadas,
// tetos por ambiente, pisos contínuos
// ============================================

interface Wall {
  id: string;
  start: [number, number]; // [x, z] in meters
  end: [number, number];
  height: number;
  thickness: number;
  isExterior: boolean;
}

interface Room {
  id: string;
  name: string;
  polygon: [number, number][]; // [x, z] vertices
  wallIds: string[];
  center: [number, number];
}

interface FloorPlan {
  walls: Wall[];
  rooms: Room[];
  totalBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface PrimitiveItem {
  id: string;
  type: 'wall' | 'floor' | 'ceiling';
  position: [number, number, number];
  rotation: [number, number, number];
  dimensions: { length: number; thickness: number; height: number };
  color: string;
  isSelected: boolean;
}

// ============================================
// PRECISE BUILDER - Cria estrutura alinhada
// ============================================
class PreciseBuilder {
  // Snap to grid
  static snap(value: number, grid: number = 0.05): number {
    return Math.round(value / grid) * grid;
  }

  // Ensure walls are perfectly horizontal or vertical
  static normalizeWall(start: [number, number], end: [number, number]): { start: [number, number], end: [number, number] } {
    const [x1, z1] = start;
    const [x2, z2] = end;
    
    const dx = Math.abs(x2 - x1);
    const dz = Math.abs(z2 - z1);
    
    // If more horizontal, align to horizontal
    if (dx > dz) {
      return {
        start: [this.snap(x1), this.snap(z1)],
        end: [this.snap(x2), this.snap(z1)], // Same Z
      };
    } else {
      // More vertical, align to vertical
      return {
        start: [this.snap(x1), this.snap(z1)],
        end: [this.snap(x1), this.snap(z2)], // Same X
      };
    }
  }

  // Create perimeter walls (rectangular)
  static createPerimeter(
    width: number, 
    depth: number, 
    height: number = 2.8,
    thickness: number = 0.15
  ): Wall[] {
    const hw = width / 2;
    const hd = depth / 2;
    
    return [
      // Front wall (bottom)
      {
        id: 'wall_front',
        start: [-hw, -hd],
        end: [hw, -hd],
        height, thickness,
        isExterior: true,
      },
      // Right wall
      {
        id: 'wall_right',
        start: [hw, -hd],
        end: [hw, hd],
        height, thickness,
        isExterior: true,
      },
      // Back wall (top)
      {
        id: 'wall_back',
        start: [hw, hd],
        end: [-hw, hd],
        height, thickness,
        isExterior: true,
      },
      // Left wall
      {
        id: 'wall_left',
        start: [-hw, hd],
        end: [-hw, -hd],
        height, thickness,
        isExterior: true,
      },
    ];
  }

  // Create internal walls (dividing rooms)
  static createInternalWalls(
    divisions: Array<{
      start: [number, number],
      end: [number, number];
    }>,
    height: number = 2.8,
    thickness: number = 0.10
  ): Wall[] {
    return divisions.map((d, i) => ({
      id: `wall_internal_${i}`,
      start: this.snap(d.start[0]) !== undefined ? d.start : [0, 0],
      end: d.end,
      height, thickness,
      isExterior: false,
    }));
  }

  // Build rooms from walls using polygon detection
  static buildRooms(walls: Wall[]): Room[] {
    // Simple rectangular room detection
    const rooms: Room[] = [];
    
    // Create rooms based on division lines
    const xs = walls.filter(w => !w.isExterior).map(w => w.start[0]);
    
    if (xs.length === 0) {
      // No internal walls, just one big room
      return [{
        id: 'room_main',
        name: 'Ambiente Principal',
        polygon: [[-5, -3.5], [5, -3.5], [5, 3.5], [-5, 3.5]],
        wallIds: walls.map(w => w.id),
        center: [0, 0],
      }];
    }
    
    return rooms;
  }

  // Build complete structure (floor, walls, ceilings)
  static buildStructure(plan: FloorPlan, wallHeight: number = 2.8): PrimitiveItem[] {
    const items: PrimitiveItem[] = [];
    
    // Calculate bounds
    const bounds = plan.totalBounds;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    
    // 1. Floor - single piece covering entire building
    items.push({
      id: 'floor_main',
      type: 'floor',
      position: [(bounds.minX + bounds.maxX) / 2, 0.01, (bounds.minZ + bounds.maxZ) / 2],
      rotation: [0, 0, 0],
      dimensions: {
        length: width,
        thickness: depth,
        height: 0.02,
      },
      color: '#D1D5DB',
      isSelected: false,
    });
    
    // 2. Walls
    plan.walls.forEach(wall => {
      const dx = wall.end[0] - wall.start[0];
      const dz = wall.end[1] - wall.start[1];
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);
      
      const cx = (wall.start[0] + wall.end[0]) / 2;
      const cz = (wall.start[1] + wall.end[1]) / 2;
      
      items.push({
        id: wall.id,
        type: 'wall',
        position: [cx, wallHeight / 2, cz],
        rotation: [0, -angle, 0],
        dimensions: {
          length: Math.max(0.1, length),
          thickness: wall.thickness,
          height: wallHeight,
        },
        color: wall.isExterior ? '#6B7280' : '#94A3B8',
        isSelected: false,
      });
    });
    
    // 3. Ceilings - one per room
    plan.rooms.forEach(room => {
      if (room.polygon.length < 3) return;
      
      // Calculate room bounds
      const xs = room.polygon.map(p => p[0]);
      const zs = room.polygon.map(p => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);

      const roomWidth = maxX - minX;
      const roomDepth = maxZ - minZ;
      
      if (roomWidth > 0.1 && roomDepth > 0.1) {
        items.push({
          id: `ceiling_${room.id}`,
          type: 'ceiling',
          position: [(minX + maxX) / 2, wallHeight + 0.01, (minZ + maxZ) / 2],
          rotation: [0, 0, 0],
          dimensions: {
            length: roomWidth,
            thickness: roomDepth,
            height: 0.02,
          },
          color: '#F3F4F6',
          isSelected: false,
        });
      }
    });
    
    return items;
  }
}

// ============================================
// MAIN COMPONENT
// ============================================
interface PreciseBlockoutEditorProps {
  onClose?: () => void;
}

export function PreciseBlockoutEditor({ onClose }: PreciseBlockoutEditorProps) {
  const { model3d } = useStore();
  const [view, setView] = useState<'upload' | 'editor'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  // Structure
  const [items, setItems] = useState<PrimitiveItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Transform
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [snapValue, setSnapValue] = useState(0.1);

  // UI
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showProps, setShowProps] = useState(true);

  const transformRef = useRef<any>(null);

  // Se o store já tem dados, monta estrutura direto
  useEffect(() => {
    if (model3d && model3d.objects && model3d.objects.length > 0 && items.length === 0) {
      const newItems: PrimitiveItem[] = model3d.objects.map((o: any) => {
        let color = '#3B82F6';
        if (o.type === 'wall') color = o.isExterior ? '#6B7280' : '#94A3B8';
        else if (o.type === 'floor') color = '#1F2937';
        else if (o.type === 'ceiling') color = '#1E293B';

        return {
          id: o.id,
          type: o.type,
          position: o.position,
          rotation: o.rotation,
          dimensions: o.dimensions,
          color,
          isSelected: false,
        };
      });
      setItems(newItems);
      setView('editor');
    }
  }, [model3d]);

  // ============================================
  // LOAD STRUCTURAL PLAN (genérico)
  // Recebe um StructuralPlan e gera a estrutura 3D
  // ============================================
  const loadStructuralPlan = useCallback((plan: StructuralPlan, label: string) => {
    setIsProcessing(true);
    setProcessingStatus(`Construindo ${label}...`);
    
    setTimeout(() => {
      // Convert vertices to world space (centered at origin)
      const cx = plan.totalWidth / 2;
      const cz = plan.totalDepth / 2;
      
      // Build walls
      const walls: Wall[] = plan.walls.map((w) => {
        const startV = plan.vertices.find(v => v.id === w.startVertexId)!;
        const endV = plan.vertices.find(v => v.id === w.endVertexId)!;
        
        // Convert to centered coordinates
        const start: [number, number] = [startV.x - cx, startV.y - cz];
        const end: [number, number] = [endV.x - cx, endV.y - cz];
        
        return {
          id: w.id,
          start,
          end,
          height: plan.wallHeight,
          thickness: w.thickness,
          isExterior: w.type === 'exterior',
        };
      });
      
      // Build rooms from plan
      const rooms: Room[] = plan.rooms.map((r) => {
        // Convert polygon to centered coordinates
        const polygon: [number, number][] = r.floor.map(p => [p.x - cx, p.y - cz]);
        
        // Find walls that belong to this room
        const wallIds: string[] = r.walls;
        
        // Calculate center
        const centerX = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
        const centerZ = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
        
        return {
          id: r.id,
          name: r.name,
          polygon,
          wallIds,
          center: [centerX, centerZ],
        };
      });
      
      const floorPlan: FloorPlan = {
        walls,
        rooms,
        totalBounds: {
          minX: -plan.totalWidth / 2,
          maxX: plan.totalWidth / 2,
          minZ: -plan.totalDepth / 2,
          maxZ: plan.totalDepth / 2,
        },
      };
      
      // Build structure
      const newItems = PreciseBuilder.buildStructure(floorPlan, plan.wallHeight);
      setItems(newItems);
      setView('editor');
      setIsProcessing(false);
    }, 800);
  }, []);

  const loadHandDrawn = useCallback(() => {
    loadStructuralPlan(HAND_DRAWN_PLAN, 'Casa 2 Pavimentos 7.5×11.25m');
  }, [loadStructuralPlan]);

  const loadCasa6x8 = useCallback(() => {
    loadStructuralPlan(CASA_6X8_PLAN, 'Projeto de Casa 6×8 (5 cômodos)');
  }, [loadStructuralPlan]);

  // ============================================
  // LOAD CUSTOM PLAN
  // ============================================
  const loadCustomPlan = useCallback((
    width: number, 
    depth: number, 
    height: number, 
    rooms: { name: string; x: number; z: number; w: number; d: number }[]
  ) => {
    setIsProcessing(true);
    setProcessingStatus('Gerando estrutura...');
    
    setTimeout(() => {
      const hw = width / 2;
      const hd = depth / 2;
      
      // Build perimeter
      const walls: Wall[] = [
        { id: 'wall_front', start: [-hw, -hd], end: [hw, -hd], height, thickness: 0.15, isExterior: true },
        { id: 'wall_right', start: [hw, -hd], end: [hw, hd], height, thickness: 0.15, isExterior: true },
        { id: 'wall_back', start: [hw, hd], end: [-hw, hd], height, thickness: 0.15, isExterior: true },
        { id: 'wall_left', start: [-hw, hd], end: [-hw, -hd], height, thickness: 0.15, isExterior: true },
      ];
      
      // Build internal walls (one horizontal + one vertical to create rooms)
      if (rooms.length >= 2) {
        // Horizontal divider
        const hDivY = -hd + (rooms[0].z + rooms[0].d/2) + depth * 0.5;
        walls.push({
          id: 'wall_h_div',
          start: [-hw, hDivY],
          end: [hw, hDivY],
          height, thickness: 0.10, isExterior: false,
        });
        
        // Vertical divider
        if (rooms.length >= 3) {
          const vDivX = -hw + (rooms[0].x + rooms[0].w/2) + width * 0.5;
          walls.push({
            id: 'wall_v_div',
            start: [vDivX, -hd],
            end: [vDivX, hd],
            height, thickness: 0.10, isExterior: false,
          });
        }
      }
      
      // Build rooms
      const roomObjs: Room[] = rooms.map((r, i) => {
        const minX = r.x - r.w/2;
        const maxX = r.x + r.w/2;
        const minZ = r.z - r.d/2;
        const maxZ = r.z + r.d/2;
        
        return {
          id: `room_${i}`,
          name: r.name,
          polygon: [
            [minX, minZ],
            [maxX, minZ],
            [maxX, maxZ],
            [minX, maxZ],
          ],
          wallIds: [`room_${i}_walls`],
          center: [r.x, r.z],
        };
      });
      
      const floorPlan: FloorPlan = {
        walls,
        rooms: roomObjs,
        totalBounds: {
          minX: -hw,
          maxX: hw,
          minZ: -hd,
          maxZ: hd,
        },
      };
      
      const newItems = PreciseBuilder.buildStructure(floorPlan, height);
      setItems(newItems);
      setView('editor');
      setIsProcessing(false);
    }, 500);
  }, []);

  // ============================================
  // UPDATE ITEM
  // ============================================
  const updateItem = useCallback((id: string, updates: Partial<PrimitiveItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  }, []);

  // ============================================
  // DELETE
  // ============================================
  const deleteItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  // ============================================
  // KEYBOARD
  // ============================================
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      
      if (e.key === 'g') setTransformMode('translate');
      else if (e.key === 'r') setTransformMode('rotate');
      else if (e.key === 's') setTransformMode('scale');
      else if (e.key === 'Delete') {
        if (selectedId) deleteItem(selectedId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedId, deleteItem]);

  // ============================================
  // UPLOAD VIEW
  // ============================================
  if (view === 'upload') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
              <Box className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h1 className="font-bold text-white">Blockout 3D Preciso</h1>
              <p className="text-slate-400 text-sm">Paredes alinhadas, tetos por ambiente</p>
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

        <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
          <div className="w-20 h-20 rounded-3xl bg-green-500/20 flex items-center justify-center mb-6">
            <Grid3x3 className="w-10 h-10 text-green-400" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Blockout Estrutural Preciso</h2>
          <p className="text-slate-400 text-center mb-6 max-w-md">
            Paredes alinhadas com ângulos retos, tetos individuais por ambiente, pisos contínuos
          </p>

          <div className="w-full max-w-sm space-y-3">
            <button
              onClick={loadHandDrawn}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>{processingStatus}</span>
                </>
              ) : (
                <>
                  <Box className="w-6 h-6" />
                  <span>Planta Desenhada à Mão (7.5×11.25m)</span>
                </>
              )}
            </button>

            <button
              onClick={loadCasa6x8}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
            >
              <Box className="w-6 h-6" />
              <span>Projeto de Casa 6×8 (5 cômodos)</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => loadCustomPlan(6, 4, 2.8, [
                  { name: 'Sala', x: 0, z: 0, w: 6, d: 4 }
                ])}
                className="py-3 px-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white text-sm"
              >
                Simples (1 ambiente)
              </button>
              <button
                onClick={() => loadCustomPlan(8, 5, 2.8, [
                  { name: 'Sala', x: -2, z: 0, w: 4, d: 5 },
                  { name: 'Quarto', x: 2, z: 0, w: 4, d: 5 },
                ])}
                className="py-3 px-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white text-sm"
              >
                2 Cômodos
              </button>
              <button
                onClick={() => loadCustomPlan(8, 6, 2.8, [
                  { name: 'Sala', x: -2, z: -1, w: 4, d: 4 },
                  { name: 'Cozinha', x: 2, z: -1, w: 4, d: 4 },
                  { name: 'Quarto', x: 0, z: 2, w: 8, d: 2 },
                ])}
                className="py-3 px-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white text-sm"
              >
                3 Cômodos
              </button>
              <button
                onClick={() => loadCustomPlan(10, 7, 2.8, [
                  { name: 'Sala', x: -2.5, z: -1.5, w: 5, d: 4 },
                  { name: 'Cozinha', x: 2.5, z: -1.5, w: 5, d: 4 },
                  { name: 'Quarto 1', x: -3, z: 2, w: 4, d: 3 },
                  { name: 'Quarto 2', x: 3, z: 2, w: 4, d: 3 },
                ])}
                className="py-3 px-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white text-sm"
              >
                4 Cômodos
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // EDITOR VIEW
  // ============================================
  const selectedItem = items.find(i => i.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between p-2 bg-slate-800 border-b border-slate-700 z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('upload')}
            className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
          >
            <X className="w-4 h-4" />
          </button>
          
          <div className="w-px h-6 bg-slate-700"></div>
          
          {/* Transform */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTransformMode('translate')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                transformMode === 'translate' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title="Mover (G)"
            >
              <Move className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTransformMode('rotate')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                transformMode === 'rotate' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title="Rotacionar (R)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTransformMode('scale')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                transformMode === 'scale' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title="Escalar (S)"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d="M9 3v6H3v2h6v6h2v-6h6V9h-6V3H9z"/>
              </svg>
            </button>
          </div>

          <div className="w-px h-6 bg-slate-700"></div>

          <select
            value={snapValue}
            onChange={(e) => setSnapValue(parseFloat(e.target.value))}
            className="bg-slate-700 text-white text-xs px-2 py-1 rounded"
          >
            <option value="0.05">0.05m</option>
            <option value="0.1">0.1m</option>
            <option value="0.25">0.25m</option>
            <option value="0.5">0.5m</option>
            <option value="1">1m</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              showGrid ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
            title="Grid"
          >
            <Grid3x3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              autoRotate ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
            title="Auto-rotate"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowProps(!showProps)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              showProps ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
            title="Propriedades"
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3D Canvas */}
      <div className="flex-1 relative">
        <Canvas
          shadows
          camera={{ position: [10, 10, 10], fov: 60 }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />
          
          {showGrid && (
            <Grid
              args={[20, 20]}
              cellSize={snapValue}
              cellThickness={0.5}
              cellColor="#475569"
              sectionSize={1}
              sectionThickness={1}
              sectionColor="#10B981"
              fadeDistance={30}
              fadeStrength={1}
              followCamera={false}
              infiniteGrid={true}
            />
          )}
          
          {/* Render items */}
          {items.map(item => (
            <ItemMesh
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
          
          {/* Transform Controls */}
          {selectedItem && selectedItem.type === 'wall' && (
            <TransformControls
              ref={transformRef}
              object={transformRef.current?.object}
              mode={transformMode}
              size={0.8}
              translationSnap={snapValue}
              rotationSnap={Math.PI / 12}
              scaleSnap={0.1}
              onObjectChange={() => {
                if (transformRef.current) {
                  const obj = transformRef.current.object;
                  if (obj) {
                    updateItem(selectedItem.id, {
                      position: [obj.position.x, obj.position.y, obj.position.z],
                      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
                      dimensions: {
                        length: selectedItem.dimensions.length * obj.scale.x,
                        thickness: selectedItem.dimensions.thickness * obj.scale.z,
                        height: selectedItem.dimensions.height * obj.scale.y,
                      },
                    });
                  }
                }
              }}
            />
          )}
          
          <OrbitControls
            enableZoom={true}
            enablePan={true}
            enableRotate={true}
            minDistance={2}
            maxDistance={100}
            autoRotate={autoRotate}
            autoRotateSpeed={2}
            target={[0, 1, 0]}
            makeDefault
          />
        </Canvas>
      </div>

      {/* Properties Panel */}
      {showProps && selectedItem && (
        <div className="absolute top-16 right-2 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-72">
          <h3 className="text-white font-bold text-sm mb-2">
            {selectedItem.type === 'wall' ? '🧱 Parede' : 
             selectedItem.type === 'floor' ? '⬜ Piso' : '🔼 Teto'}
          </h3>
          <p className="text-slate-400 text-xs mb-2">ID: {selectedItem.id}</p>
          
          <div className="space-y-2 text-xs">
            <div>
              <label className="text-slate-400">Comprimento (m)</label>
              <input
                type="number"
                step="0.1"
                value={selectedItem.dimensions.length.toFixed(2)}
                onChange={(e) => updateItem(selectedItem.id, {
                  dimensions: { ...selectedItem.dimensions, length: parseFloat(e.target.value) || 0.1 }
                })}
                className="w-full bg-slate-700 text-white px-2 py-1 rounded"
              />
            </div>
            <div>
              <label className="text-slate-400">Espessura (m)</label>
              <input
                type="number"
                step="0.05"
                value={selectedItem.dimensions.thickness.toFixed(2)}
                onChange={(e) => updateItem(selectedItem.id, {
                  dimensions: { ...selectedItem.dimensions, thickness: parseFloat(e.target.value) || 0.05 }
                })}
                className="w-full bg-slate-700 text-white px-2 py-1 rounded"
              />
            </div>
            <div>
              <label className="text-slate-400">Altura (m)</label>
              <input
                type="number"
                step="0.1"
                value={selectedItem.dimensions.height.toFixed(2)}
                onChange={(e) => updateItem(selectedItem.id, {
                  dimensions: { ...selectedItem.dimensions, height: parseFloat(e.target.value) || 0.1 }
                })}
                className="w-full bg-slate-700 text-white px-2 py-1 rounded"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-1 pt-1">
              <div>
                <label className="text-slate-400">Pos X (m)</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedItem.position[0].toFixed(2)}
                  onChange={(e) => updateItem(selectedItem.id, {
                    position: [parseFloat(e.target.value) || 0, selectedItem.position[1], selectedItem.position[2]]
                  })}
                  className="w-full bg-slate-700 text-white px-2 py-1 rounded"
                />
              </div>
              <div>
                <label className="text-slate-400">Pos Z (m)</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedItem.position[2].toFixed(2)}
                  onChange={(e) => updateItem(selectedItem.id, {
                    position: [selectedItem.position[0], selectedItem.position[1], parseFloat(e.target.value) || 0]
                  })}
                  className="w-full bg-slate-700 text-white px-2 py-1 rounded"
                />
              </div>
            </div>
            
            <button
              onClick={() => deleteItem(selectedItem.id)}
              className="w-full mt-2 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white flex items-center justify-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Apagar
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-slate-800/95 backdrop-blur border-t border-slate-700 z-10">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            🧱 {items.filter(i => i.type === 'wall').length} paredes • 
            ⬜ {items.filter(i => i.type === 'floor').length} pisos • 
            🔼 {items.filter(i => i.type === 'ceiling').length} tetos
          </span>
          <span>Snap: {snapValue}m • Modo: {transformMode === 'translate' ? 'Mover' : transformMode === 'rotate' ? 'Rotacionar' : 'Escalar'}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// ITEM MESH
// ============================================
function ItemMesh({ item, selected, onClick }: {
  item: PrimitiveItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <mesh
      position={item.position}
      rotation={item.rotation}
      castShadow={item.type !== 'ceiling' && item.type !== 'floor'}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <boxGeometry args={[item.dimensions.length, item.dimensions.height, item.dimensions.thickness]} />
      <meshStandardMaterial
        color={selected ? '#3B82F6' : item.color}
        roughness={0.7}
        metalness={0.1}
        transparent={item.type === 'ceiling'}
        opacity={item.type === 'ceiling' ? 0.4 : 1}
      />
      <Edges
        threshold={1}
        color={selected ? '#1D4ED8' : '#1F2937'}
        linewidth={selected ? 2 : 1}
      />
    </mesh>
  );
}
