import { useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import { 
  Upload, 
  Eye, 
  Box, 
  Layers, 
  RotateCw, 
  Maximize2,
  Home,
  X,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { convertFileToImage } from '../lib/pdfConverter';
import { floorPlanDetector } from '../floorplan/detector';
import { reconstructionEngine } from '../geometry/reconstruction';

// ============================================
// 3D WALL COMPONENT
// ============================================
function Wall({ start, end, height, thickness, isExterior }: { 
  start: [number, number], 
  end: [number, number], 
  height: number, 
  thickness: number,
  isExterior: boolean
}) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);
  const midX = (start[0] + end[0]) / 2;
  const midZ = (start[1] + end[1]) / 2;
  
  return (
    <mesh 
      position={[midX, height / 2, midZ]} 
      rotation={[0, -angle, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[length, height, thickness]} />
      <meshStandardMaterial 
        color={isExterior ? '#6B7280' : '#94A3B8'} 
        roughness={0.8}
        metalness={0.1}
      />
      <Edges threshold={1} color="#1F2937" />
    </mesh>
  );
}

// ============================================
// ROOM FLOOR
// ============================================
function RoomFloor({ walls }: { walls: { start: [number, number], end: [number, number] }[] }) {
  if (walls.length === 0) return null;
  
  // Calculate bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  walls.forEach(w => {
    minX = Math.min(minX, w.start[0], w.end[0]);
    maxX = Math.max(maxX, w.start[0], w.end[0]);
    minZ = Math.min(minZ, w.start[1], w.end[1]);
    maxZ = Math.max(maxZ, w.start[1], w.end[1]);
  });
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  return (
    <mesh 
      position={[centerX, 0.01, centerZ]} 
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial 
        color="#E5E7EB" 
        roughness={0.9}
        metalness={0.0}
      />
    </mesh>
  );
}

// ============================================
// CEILING
// ============================================
function Ceiling({ walls, height }: { walls: { start: [number, number], end: [number, number] }[], height: number }) {
  if (walls.length === 0) return null;
  
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  walls.forEach(w => {
    minX = Math.min(minX, w.start[0], w.end[0]);
    maxX = Math.max(maxX, w.start[0], w.end[0]);
    minZ = Math.min(minZ, w.start[1], w.end[1]);
    maxZ = Math.max(maxZ, w.start[1], w.end[1]);
  });
  
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  return (
    <mesh 
      position={[centerX, height, centerZ]} 
      rotation={[Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial 
        color="#F3F4F6" 
        roughness={0.7}
        metalness={0.0}
        transparent
        opacity={0.4}
      />
    </mesh>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
interface FloorPlan3DViewerProps {
  onClose?: () => void;
}

export function FloorPlan3DViewer({ onClose }: FloorPlan3DViewerProps) {
  const [view, setView] = useState<'upload' | 'viewer'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  
  const [floorPlan, setFloorPlan] = useState<any>(null);
  const [wallHeight, setWallHeight] = useState(2.8);
  const [showCeiling, setShowCeiling] = useState(true);
  const [showFloor, setShowFloor] = useState(true);
  const [visualizationMode, setVisualizationMode] = useState<'structure' | 'architectural' | 'wireframe'>('architectural');
  const [autoRotate, setAutoRotate] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStatus('Carregando arquivo...');

    try {
      // Convert to image
      const imageDataUrl = await convertFileToImage(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const imgEl = document.createElement('img');
        imgEl.onload = () => resolve(imgEl);
        imgEl.onerror = () => reject(new Error('Falha ao carregar imagem'));
        imgEl.src = imageDataUrl;
      });

      setProcessingStatus('Detectando estrutura...');
      
      // Detect floor plan
      const result = await floorPlanDetector.detect(img, '3d-viewer');
      
      if (result.success && result.floorPlan && result.floorPlan.walls.length > 0) {
        setProcessingStatus('Gerando modelo 3D...');
        setFloorPlan(result.floorPlan);
        
        // Generate 3D model
        reconstructionEngine.setWallHeight(wallHeight);
        
        setProcessingStatus('');
        setView('viewer');
      } else {
        setError('Não foi possível detectar uma planta. Use uma imagem com linhas retas bem definidas.');
      }
    } catch (err) {
      setError('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setIsProcessing(false);
    }
  }, [wallHeight]);

  const loadDemo = useCallback(() => {
    setIsProcessing(true);
    setProcessingStatus('Carregando demo...');
    
    setTimeout(() => {
      const demoFloorPlan = {
        id: 'demo',
        scale: 100,
        origin: { x: 0, y: 0 },
        dimensions: { width: 8, height: 6 },
        bounds: { min: { x: 0, y: 0 }, max: { x: 8, y: 6 } },
        walls: [
          // External walls (perimeter)
          { id: 'w1', start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, thickness: 0.25, isExterior: true, openings: [] },
          { id: 'w2', start: { x: 8, y: 0 }, end: { x: 8, y: 6 }, thickness: 0.25, isExterior: true, openings: [] },
          { id: 'w3', start: { x: 8, y: 6 }, end: { x: 0, y: 6 }, thickness: 0.25, isExterior: true, openings: [] },
          { id: 'w4', start: { x: 0, y: 6 }, end: { x: 0, y: 0 }, thickness: 0.25, isExterior: true, openings: [] },
          // Internal walls (dividing rooms)
          { id: 'w5', start: { x: 4, y: 0 }, end: { x: 4, y: 3.5 }, thickness: 0.15, isExterior: false, openings: [] },
          { id: 'w6', start: { x: 4, y: 3.5 }, end: { x: 4, y: 6 }, thickness: 0.15, isExterior: false, openings: [] },
          { id: 'w7', start: { x: 4, y: 3.5 }, end: { x: 8, y: 3.5 }, thickness: 0.15, isExterior: false, openings: [] },
          { id: 'w8', start: { x: 0, y: 3.5 }, end: { x: 4, y: 3.5 }, thickness: 0.15, isExterior: false, openings: [] },
          { id: 'w9', start: { x: 4, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, isExterior: false, openings: [] },
        ],
        doors: [],
        windows: [],
        rooms: [
          { id: 'r1', name: 'Sala de Estar', type: 'living', polygon: [], area: 14, walls: [], center: { x: 2, y: 1.75 } },
          { id: 'r2', name: 'Cozinha', type: 'kitchen', polygon: [], area: 8, walls: [], center: { x: 6, y: 1.75 } },
          { id: 'r3', name: 'Banheiro', type: 'bathroom', polygon: [], area: 6, walls: [], center: { x: 2, y: 4.75 } },
          { id: 'r4', name: 'Quarto', type: 'bedroom', polygon: [], area: 12, walls: [], center: { x: 6, y: 4.75 } },
        ]
      };
      
      setFloorPlan(demoFloorPlan);
      setView('viewer');
      setIsProcessing(false);
    }, 500);
  }, [wallHeight]);

  // ============================================
  // UPLOAD VIEW
  // ============================================
  if (view === 'upload') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Box className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="font-bold text-white">Visualizador 3D</h1>
              <p className="text-slate-400 text-sm">Estrutura da Planta</p>
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
          <div className="w-20 h-20 rounded-3xl bg-blue-500/20 flex items-center justify-center mb-6">
            <Box className="w-10 h-10 text-blue-400" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Visualizar Planta em 3D</h2>
          <p className="text-slate-400 text-center mb-8 max-w-md">
            Carregue uma planta para gerar uma estrutura 3D com paredes e divisões. 
            Visualize em 360° para ver como ficará o ambiente.
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
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
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
              <Home className="w-6 h-6" />
              <span>Ver Demo (4 ambientes)</span>
            </button>
          </div>

          {error && (
            <div className="mt-6 bg-red-500/20 border border-red-500/50 rounded-xl p-4 max-w-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Info */}
          <div className="mt-8 text-center text-sm text-slate-500 max-w-md">
            <p className="font-medium text-slate-400 mb-2">O que será gerado:</p>
            <p>✓ Paredes externas e internas</p>
            <p>✓ Piso e teto</p>
            <p>✓ Divisões semânticas de ambientes</p>
            <p>✓ Visualização 360°</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // 3D VIEWER
  // ============================================
  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <Box className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm">Visualizador 3D</h1>
            <p className="text-slate-400 text-xs">
              {floorPlan ? `${floorPlan.walls.length} paredes, ${floorPlan.rooms?.length || 0} ambientes` : 'Carregando...'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('upload')}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm flex items-center gap-1"
          >
            <Upload className="w-4 h-4" />
            Nova
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
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
          camera={{ position: [10, 8, 10], fov: 60 }}
          gl={{ antialias: true }}
        >
          {/* Lighting */}
          <ambientLight intensity={0.5} />
          <directionalLight 
            position={[10, 15, 10]} 
            intensity={0.8} 
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />
          
          {/* Grid */}
          <gridHelper args={[20, 20, '#475569', '#334155']} position={[0, -0.01, 0]} />
          
          {/* Walls */}
          {floorPlan && floorPlan.walls && floorPlan.walls.map((wall: any) => (
            <Wall
              key={wall.id}
              start={[wall.start.x, wall.start.y]}
              end={[wall.end.x, wall.end.y]}
              height={wallHeight}
              thickness={wall.thickness}
              isExterior={wall.isExterior}
            />
          ))}
          
          {/* Floor */}
          {showFloor && floorPlan && (
            <RoomFloor 
              walls={floorPlan.walls.map((w: any) => ({ 
                start: [w.start.x, w.start.y] as [number, number], 
                end: [w.end.x, w.end.y] as [number, number] 
              }))} 
            />
          )}
          
          {/* Ceiling */}
          {showCeiling && floorPlan && (
            <Ceiling 
              walls={floorPlan.walls.map((w: any) => ({ 
                start: [w.start.x, w.start.y] as [number, number], 
                end: [w.end.x, w.end.y] as [number, number] 
              }))} 
              height={wallHeight} 
            />
          )}
          
          {/* Camera Controls */}
          <OrbitControls
            enableZoom={true}
            enablePan={true}
            enableRotate={true}
            minDistance={3}
            maxDistance={50}
            maxPolarAngle={Math.PI / 2}
            autoRotate={autoRotate}
            autoRotateSpeed={2}
            target={[4, 0, 3]}
          />
        </Canvas>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-900 to-transparent z-10">
        {/* Info Cards */}
        {floorPlan && (
          <div className="flex justify-center gap-2 mb-4 overflow-x-auto">
            <div className="bg-slate-800/80 backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2">
              <Box className="w-4 h-4 text-blue-400" />
              <span className="text-white text-sm font-medium">
                {floorPlan.walls.length} paredes
              </span>
            </div>
            <div className="bg-slate-800/80 backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2">
              <Home className="w-4 h-4 text-green-400" />
              <span className="text-white text-sm font-medium">
                {floorPlan.rooms?.length || 0} ambientes
              </span>
            </div>
          </div>
        )}

        {/* View Mode Selector */}
        <div className="flex justify-center gap-2 mb-3">
          {[
            { mode: 'wireframe' as const, icon: Layers, label: 'Wire' },
            { mode: 'structure' as const, icon: Box, label: 'Estrutura' },
            { mode: 'architectural' as const, icon: Eye, label: 'Realista' },
          ].map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setVisualizationMode(mode)}
              className={`px-3 py-2 rounded-xl flex items-center gap-2 ${
                visualizationMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm">{label}</span>
            </button>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="flex justify-center gap-2 mb-3">
          <button
            onClick={() => setShowCeiling(!showCeiling)}
            className={`px-3 py-2 rounded-xl flex items-center gap-1 ${
              showCeiling ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <Maximize2 className="w-4 h-4" />
            <span className="text-xs">Teto</span>
          </button>
          <button
            onClick={() => setShowFloor(!showFloor)}
            className={`px-3 py-2 rounded-xl flex items-center gap-1 ${
              showFloor ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span className="text-xs">Piso</span>
          </button>
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`px-3 py-2 rounded-xl flex items-center gap-1 ${
              autoRotate ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <RotateCw className="w-4 h-4" />
            <span className="text-xs">360° Auto</span>
          </button>
        </div>

        {/* Wall Height Slider */}
        <div className="max-w-xs mx-auto bg-slate-800/80 backdrop-blur rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-300 text-xs">Altura das paredes</span>
            <span className="text-white text-sm font-bold">{wallHeight.toFixed(1)}m</span>
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

      {/* Instructions overlay */}
      <div className="absolute top-20 left-4 z-10">
        <div className="bg-slate-800/80 backdrop-blur rounded-xl p-3 text-xs text-slate-300 max-w-[200px]">
          <p className="font-medium text-white mb-1">Controles 3D:</p>
          <p>• Arrastar: rotacionar</p>
          <p>• Pinça: zoom</p>
          <p>• 2 dedos: mover</p>
        </div>
      </div>
    </div>
  );
}
