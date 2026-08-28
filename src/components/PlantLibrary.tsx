import { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import { 
  Upload, 
  Box, 
  Layers, 
  X, 
  Loader2,
  AlertTriangle,
  Trash2,
  Edit3,
  Clock,
  Database,
  Sparkles,
  ChevronRight,
  Brain
} from 'lucide-react';
import {
  SemanticObject,
  RoomData,
  LAYERS,
  DimensionalContext
} from '../floorplan/typesExtensions';
import {
  HAND_DRAWN_PLAN,
  buildStructuralPlan
} from '../floorplan/structuralIntelligence';
import {
  savePlant as savePlantCloud,
  getCurrentUser,
} from '../lib/supabase';

// ============================================
// PLANT LIBRARY STORAGE
// ============================================
interface SavedPlant {
  id: string;
  name: string;
  type: 'hand-drawn' | 'auto-detected' | 'demo';
  imageData?: string; // base64 image
  objects: SemanticObject[];
  rooms: RoomData[];
  context?: DimensionalContext;
  createdAt: Date;
  lastModified: Date;
  totalArea: number;
  totalWalls: number;
  totalRooms: number;
}

const STORAGE_KEY = 'floorvision_plants';

function loadLibrary(): SavedPlant[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data).map((p: any) => ({
      ...p,
      createdAt: new Date(p.createdAt),
      lastModified: new Date(p.lastModified),
    }));
  } catch {
    return [];
  }
}

function saveLibrary(plants: SavedPlant[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plants));
  } catch (e) {
    console.error('Erro ao salvar biblioteca:', e);
  }
}

// ============================================
// DIMENSIONAL ENGINE
// ============================================
class DimensionalEngine {
  static buildContext(
    imageWidth: number,
    imageHeight: number
  ): DimensionalContext {
    return {
      totalWidth: 10,
      totalDepth: 8,
      pixelsPerMeter: Math.max(imageWidth, imageHeight) / 10,
      originX: imageWidth / 2,
      originY: imageHeight / 2,
    };
  }

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
// 3D OBJECT RENDERER
// ============================================
function SemanticObjectMesh({ 
  obj, 
  selected, 
  onSelect,
  visible,
}: { 
  obj: SemanticObject; 
  selected: boolean; 
  onSelect: (id: string) => void;
  visible: boolean;
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
  );
}

// ============================================
// MAIN LIBRARY COMPONENT
// ============================================
interface PlantLibraryProps {
  onClose?: () => void;
}

export function PlantLibrary({ onClose }: PlantLibraryProps) {
  const [view, setView] = useState<'library' | 'upload' | 'editor'>('library');
  const [library, setLibrary] = useState<SavedPlant[]>(loadLibrary());
  const [currentPlant, setCurrentPlant] = useState<SavedPlant | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  const [uploadMode, setUploadMode] = useState<'file' | 'hand-drawn'>('file');
  
  // Editor state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showLayers, setShowLayers] = useState({
    [LAYERS.WALLS]: true,
    [LAYERS.FLOORS]: true,
    [LAYERS.CEILINGS]: true,
    [LAYERS.DOORS]: true,
    [LAYERS.WINDOWS]: true,
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist library changes
  useEffect(() => {
    saveLibrary(library);
  }, [library]);

  // Supabase sync (background, se logado)
  const [cloudUser, setCloudUser] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const syncTimeoutRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    getCurrentUser().then(u => { if (mounted) setCloudUser(u); });
    return () => { mounted = false; };
  }, []);

  // Auto-sync para Supabase quando library muda (debounced)
  useEffect(() => {
    if (!cloudUser) return;
    if (library.length === 0) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setSyncStatus('syncing');
    syncTimeoutRef.current = setTimeout(async () => {
      // Sincroniza a planta mais recente (ou todas se for pequeno)
      const recent = library[0];
      if (!recent) return;
      try {
        const result = await savePlantCloud({
          name: recent.name,
          image_data: recent.imageData,
          width_meters: recent.context?.totalWidth || 0,
          depth_meters: recent.context?.totalDepth || 0,
          total_area: recent.totalArea,
          total_walls: recent.totalWalls,
          total_rooms: recent.totalRooms,
          walls: recent.objects?.filter((o: any) => o.type === 'wall').map((o: any) => ({
            start: { x: o.position[0] - Math.cos(o.rotation[1]) * o.dimensions.length / 2, y: o.position[2] - Math.sin(o.rotation[1]) * o.dimensions.length / 2 },
            end: { x: o.position[0] + Math.cos(o.rotation[1]) * o.dimensions.length / 2, y: o.position[2] + Math.sin(o.rotation[1]) * o.dimensions.length / 2 },
            thickness: o.dimensions.thickness,
            type: o.isExterior ? 'exterior' : 'interior',
          })) || [],
          rooms: recent.rooms || [],
        });
        if (result) setSyncStatus('ok');
        else setSyncStatus('error');
      } catch (e) {
        setSyncStatus('error');
      }
    }, 2000);
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [library, cloudUser]);

  // ============================================
  // UPLOAD - FILE
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

      setProcessingStatus('Detectando estrutura...');
      
      const { floorPlanDetector } = await import('../floorplan/detector');
      const result = await floorPlanDetector.detect(img, 'library-upload');
      
      if (result.success && result.floorPlan && result.floorPlan.walls.length > 0) {
        setProcessingStatus('Gerando modelo 3D...');
        
        // Create plant from detection
        const context = DimensionalEngine.buildContext(img.width, img.height);
        const { objects, rooms } = await generateFromDetection(result.floorPlan, context);
        
        const newPlant: SavedPlant = {
          id: `plant_${Date.now()}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          type: 'auto-detected',
          imageData: imageDataUrl,
          objects,
          rooms,
          context,
          createdAt: new Date(),
          lastModified: new Date(),
          totalArea: result.floorPlan.dimensions.width * result.floorPlan.dimensions.height / 10000,
          totalWalls: result.floorPlan.walls.length,
          totalRooms: result.floorPlan.rooms?.length || 0,
        };
        
        setLibrary(prev => [newPlant, ...prev]);
        setCurrentPlant(newPlant);
        setView('editor');
      } else {
        setError('Não foi possível detectar paredes. Tente outra imagem.');
      }
    } catch (err) {
      setError('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // ============================================
  // UPLOAD - HAND DRAWN
  // ============================================
  const loadHandDrawn = useCallback(() => {
    setIsProcessing(true);
    setProcessingStatus('Carregando planta desenhada à mão...');
    
    setTimeout(() => {
      const plan = HAND_DRAWN_PLAN;
      const context: DimensionalContext = {
        totalWidth: plan.totalWidth,
        totalDepth: plan.totalDepth,
        pixelsPerMeter: 1,
        originX: plan.totalWidth / 2,
        originY: plan.totalDepth / 2,
      };
      const { objects, rooms } = buildStructuralPlan(plan, context);
      
      const newPlant: SavedPlant = {
        id: `plant_${Date.now()}`,
        name: plan.projectName,
        type: 'hand-drawn',
        objects,
        rooms,
        context,
        createdAt: new Date(),
        lastModified: new Date(),
        totalArea: plan.totalArea,
        totalWalls: plan.walls.length,
        totalRooms: plan.rooms.length,
      };
      
      setLibrary(prev => [newPlant, ...prev]);
      setCurrentPlant(newPlant);
      setView('editor');
      setIsProcessing(false);
    }, 500);
  }, []);

  // ============================================
  // DELETE PLANT
  // ============================================
  const deletePlant = useCallback((id: string) => {
    setLibrary(prev => prev.filter(p => p.id !== id));
    if (currentPlant?.id === id) {
      setCurrentPlant(null);
      setView('library');
    }
  }, [currentPlant]);

  // ============================================
  // EDITOR ACTIONS
  // ============================================
  const updateObject = useCallback((id: string, updates: Partial<SemanticObject>) => {
    if (!currentPlant) return;
    
    const updated = {
      ...currentPlant,
      objects: currentPlant.objects.map(o => o.id === id ? { ...o, ...updates } : o),
      lastModified: new Date(),
    };
    
    setCurrentPlant(updated);
    setLibrary(prev => prev.map(p => p.id === updated.id ? updated : p));
  }, [currentPlant]);

  const deleteObject = useCallback((id: string) => {
    if (!currentPlant) return;
    
    const updated = {
      ...currentPlant,
      objects: currentPlant.objects.filter(o => o.id !== id),
      lastModified: new Date(),
    };
    
    setCurrentPlant(updated);
    setLibrary(prev => prev.map(p => p.id === updated.id ? updated : p));
    if (selectedId === id) setSelectedId(null);
  }, [currentPlant, selectedId]);

  // ============================================
  // LIBRARY VIEW
  // ============================================
  if (view === 'library') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
              <Database className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="font-bold text-white">Biblioteca de Plantas</h1>
              <p className="text-slate-400 text-sm">
                {library.length} plantas salvas
                {cloudUser && (
                  <span className="ml-2 text-emerald-400">
                    · ☁ {syncStatus === 'syncing' ? 'sincronizando...' : syncStatus === 'ok' ? 'sincronizado' : syncStatus === 'error' ? 'erro sync' : 'sincronizado'}
                  </span>
                )}
              </p>
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

        {/* Action buttons */}
        <div className="p-4 grid grid-cols-2 gap-3 max-w-2xl mx-auto w-full">
          <button
            onClick={() => { setUploadMode('file'); setView('upload'); }}
            className="p-4 bg-cyan-600 hover:bg-cyan-500 rounded-2xl text-white font-bold flex flex-col items-center gap-2 transition-colors"
          >
            <Upload className="w-8 h-8" />
            <span>Enviar Arquivo</span>
            <span className="text-xs opacity-75">Auto-detectar</span>
          </button>
          
          <button
            onClick={() => { setUploadMode('hand-drawn'); setView('upload'); }}
            className="p-4 bg-green-600 hover:bg-green-500 rounded-2xl text-white font-bold flex flex-col items-center gap-2 transition-colors"
          >
            <Brain className="w-8 h-8" />
            <span>Planta Desenhada à Mão</span>
            <span className="text-xs opacity-75">Inteligência estrutural</span>
          </button>
        </div>

        {/* Saved plants */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto">
            {library.length === 0 ? (
              <div className="text-center py-12">
                <Database className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">Nenhuma planta salva ainda</p>
                <p className="text-slate-500 text-sm mt-2">
                  Envie uma imagem ou carregue a planta desenhada à mão
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-white font-bold text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Plantas Salvas
                </h2>
                {library.map(plant => (
                  <div
                    key={plant.id}
                    className="bg-slate-800/70 border border-slate-700 rounded-2xl p-4 hover:border-cyan-500 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
                      <div className="w-16 h-16 rounded-xl bg-slate-900 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {plant.imageData ? (
                          <img src={plant.imageData} alt={plant.name} className="w-full h-full object-cover" />
                        ) : (
                          <Box className="w-8 h-8 text-cyan-400" />
                        )}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-white font-bold text-sm truncate">{plant.name}</h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            plant.type === 'hand-drawn' ? 'bg-green-500/20 text-green-400' :
                            plant.type === 'auto-detected' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-purple-500/20 text-purple-400'
                          }`}>
                            {plant.type === 'hand-drawn' ? '✋ Manual' : 
                             plant.type === 'auto-detected' ? '🤖 Auto' : 'Demo'}
                          </span>
                        </div>
                        <p className="text-slate-400 text-xs">
                          {plant.totalWalls} paredes • {plant.totalRooms} ambientes
                        </p>
                        <p className="text-slate-500 text-xs">
                          {plant.totalArea.toFixed(1)}m² • {new Date(plant.lastModified).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => { setCurrentPlant(plant); setView('editor'); }}
                          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white text-xs flex items-center gap-1"
                        >
                          <Edit3 className="w-3 h-3" />
                          Abrir
                        </button>
                        <button
                          onClick={() => deletePlant(plant.id)}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-red-600 rounded-lg text-white text-xs flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // UPLOAD VIEW
  // ============================================
  if (view === 'upload') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView('library')}
              className="w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
            <div>
              <h1 className="font-bold text-white">
                {uploadMode === 'file' ? 'Enviar Planta' : 'Planta Desenhada à Mão'}
              </h1>
              <p className="text-slate-400 text-sm">
                {uploadMode === 'file' ? 'Auto-detecção' : 'Inteligência estrutural aplicada'}
              </p>
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
          {uploadMode === 'file' ? (
            <>
              <div className="w-20 h-20 rounded-3xl bg-cyan-500/20 flex items-center justify-center mb-6">
                <Upload className="w-10 h-10 text-cyan-400" />
              </div>
              
              <h2 className="text-2xl font-bold text-white mb-2 text-center">Upload de Planta</h2>
              <p className="text-slate-400 text-center mb-8 max-w-md">
                O sistema vai detectar automaticamente a estrutura 2D e gerar o modelo 3D
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileUpload}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="w-full max-w-sm py-4 px-6 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{processingStatus}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6" />
                    <span>Selecionar Arquivo</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-3xl bg-green-500/20 flex items-center justify-center mb-6">
                <Brain className="w-10 h-10 text-green-400" />
              </div>
              
              <h2 className="text-2xl font-bold text-white mb-2 text-center">Planta Desenhada à Mão</h2>
              <p className="text-slate-400 text-center mb-8 max-w-md">
                Inteligência estrutural com 17 vértices, 16 paredes e 6 ambientes identificados da sua planta
              </p>

              <button
                onClick={loadHandDrawn}
                disabled={isProcessing}
                className="w-full max-w-sm py-4 px-6 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{processingStatus}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-6 h-6" />
                    <span>Gerar Modelo Pronto</span>
                  </>
                )}
              </button>

              <div className="mt-8 max-w-md grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <div className="text-cyan-400 text-2xl font-bold">17</div>
                  <div className="text-slate-400 text-xs">Vértices</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <div className="text-green-400 text-2xl font-bold">16</div>
                  <div className="text-slate-400 text-xs">Paredes</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-3">
                  <div className="text-purple-400 text-2xl font-bold">6</div>
                  <div className="text-slate-400 text-xs">Ambientes</div>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="mt-6 bg-red-500/20 border border-red-500/50 rounded-xl p-4 max-w-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================
  // EDITOR VIEW
  // ============================================
  if (!currentPlant) return null;

  const bounds = DimensionalEngine.calculateBounds(currentPlant.objects);
  const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const cameraDistance = Math.max(8, maxDim * 1.5);
  const selectedObject = currentPlant.objects.find(o => o.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800/80 backdrop-blur border-b border-slate-700 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setView('library'); setCurrentPlant(null); }}
            className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Box className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm">{currentPlant.name}</h1>
            <p className="text-slate-400 text-xs">
              {currentPlant.totalWalls} paredes • {currentPlant.rooms.length} ambientes • {currentPlant.totalArea.toFixed(1)}m²
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
              showAnalysis ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            Análise
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
          />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />
          
          <gridHelper args={[Math.max(20, maxDim * 2), Math.max(20, maxDim * 2), '#475569', '#334155']} position={[0, -0.01, 0]} />
          
          {currentPlant.objects.map(obj => (
            <SemanticObjectMesh
              key={obj.id}
              obj={obj}
              selected={selectedId === obj.id}
              onSelect={setSelectedId}
              visible={showLayers[obj.layer] !== false}
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

      {/* Analysis Panel (left) */}
      {showAnalysis && (
        <div className="absolute top-20 left-4 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-4 z-20 w-64">
          <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-400" />
            Análise Estrutural
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Vértices:</span>
              <span className="text-cyan-400 font-bold">17</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Paredes Externas:</span>
              <span className="text-blue-400 font-bold">{currentPlant.objects.filter(o => o.type === 'wall' && o.isExterior).length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Paredes Internas:</span>
              <span className="text-slate-300 font-bold">{currentPlant.objects.filter(o => o.type === 'wall' && !o.isExterior).length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pisos:</span>
              <span className="text-green-400 font-bold">{currentPlant.objects.filter(o => o.type === 'floor').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Tetos:</span>
              <span className="text-yellow-400 font-bold">{currentPlant.objects.filter(o => o.type === 'ceiling').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Portas:</span>
              <span className="text-orange-400 font-bold">{currentPlant.objects.filter(o => o.type === 'door').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Janelas:</span>
              <span className="text-cyan-300 font-bold">{currentPlant.objects.filter(o => o.type === 'window').length}</span>
            </div>
            <div className="border-t border-slate-700 pt-2 mt-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Dimensões:</span>
                <span className="text-white font-bold">
                  {currentPlant.context ? `${currentPlant.context.totalWidth.toFixed(1)}×${currentPlant.context.totalDepth.toFixed(1)}m` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-400">Área total:</span>
                <span className="text-white font-bold">{currentPlant.totalArea.toFixed(1)}m²</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Layers Panel (right) */}
      {showLayersPanel && (
        <div className="absolute top-20 right-4 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-56">
          <h3 className="text-white text-sm font-bold mb-2">Layers</h3>
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
                {currentPlant.objects.filter(o => o.layer === layer).length}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Selected object editor */}
      {selectedObject && (
        <div className="absolute bottom-24 left-0 right-0 mx-4 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-white font-bold text-sm">
                {selectedObject.type === 'wall' ? '🧱 Parede' : 
                 selectedObject.type === 'floor' ? '⬜ Piso' :
                 selectedObject.type === 'ceiling' ? '🔼 Teto' :
                 selectedObject.type === 'door' ? '🚪 Porta' : '🪟 Janela'}
              </h3>
              <p className="text-slate-400 text-xs">ID: {selectedObject.id}</p>
            </div>
            <button
              onClick={() => setSelectedId(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-slate-400 text-xs">Comp (m)</label>
              <input
                type="number"
                step="0.1"
                value={selectedObject.dimensions.length.toFixed(2)}
                onChange={(e) => updateObject(selectedObject.id, { 
                  dimensions: { ...selectedObject.dimensions, length: parseFloat(e.target.value) || 0.1 }
                })}
                className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Pos X (m)</label>
              <input
                type="number"
                step="0.1"
                value={selectedObject.position[0].toFixed(2)}
                onChange={(e) => updateObject(selectedObject.id, { 
                  position: [parseFloat(e.target.value) || 0, selectedObject.position[1], selectedObject.position[2]] 
                })}
                className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs">Pos Z (m)</label>
              <input
                type="number"
                step="0.1"
                value={selectedObject.position[2].toFixed(2)}
                onChange={(e) => updateObject(selectedObject.id, { 
                  position: [selectedObject.position[0], selectedObject.position[1], parseFloat(e.target.value) || 0] 
                })}
                className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
              />
            </div>
          </div>
          
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => deleteObject(selectedObject.id)}
              className="flex-1 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white flex items-center justify-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Apagar
            </button>
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-slate-900 to-transparent z-10">
        <div className="flex justify-center gap-1">
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`px-2 py-1.5 rounded-lg flex items-center gap-1 ${
              autoRotate ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span className="text-xs">360°</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// HELPER: Generate objects from detection
// ============================================
async function generateFromDetection(
  floorPlan: any,
  context: DimensionalContext
): Promise<{ objects: SemanticObject[]; rooms: RoomData[] }> {
  const objects: SemanticObject[] = [];
  const rooms: RoomData[] = [];

  const wallHeight = 2.8;

  // Convert walls
  floorPlan.walls.forEach((wall: any, index: number) => {
    const startWorld = {
      x: (wall.start.x - context.originX) / context.pixelsPerMeter,
      z: (wall.start.y - context.originY) / context.pixelsPerMeter,
    };
    const endWorld = {
      x: (wall.end.x - context.originX) / context.pixelsPerMeter,
      z: (wall.end.y - context.originY) / context.pixelsPerMeter,
    };

    const dx = endWorld.x - startWorld.x;
    const dz = endWorld.z - startWorld.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    objects.push({
      id: `wall_${wall.id || index}`,
      type: 'wall',
      source_2d: wall.id || `line_${index}`,
      position: [
        (startWorld.x + endWorld.x) / 2,
        wallHeight / 2,
        (startWorld.z + endWorld.z) / 2,
      ],
      rotation: [0, -angle, 0],
      dimensions: { length, thickness: 0.15, height: wallHeight },
      confidence: 0.9,
      editable: true,
      layer: LAYERS.WALLS,
      isExterior: wall.isExterior,
    });
  });

  // Convert rooms
  if (floorPlan.rooms && floorPlan.rooms.length > 0) {
    floorPlan.rooms.forEach((room: any) => {
      const polygonWorld = (room.polygon || []).map((p: any) => ({
        x: (p.x - context.originX) / context.pixelsPerMeter,
        z: (p.y - context.originY) / context.pixelsPerMeter,
      }));
      
      rooms.push({
        id: room.id,
        name: room.name || 'Ambiente',
        type: room.type || 'unknown',
        walls: room.walls || [],
        polygon: polygonWorld,
        area: room.area || 0,
        center: { x: 0, z: 0 },
      });
      
      // Add floor and ceiling
      if (polygonWorld.length > 0) {
        const xs = polygonWorld.map((p: any) => p.x);
        const zs = polygonWorld.map((p: any) => p.z);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minZ = Math.min(...zs);
        const maxZ = Math.max(...zs);

        objects.push({
          id: `floor_${room.id}`,
          type: 'floor',
          source_2d: room.id,
          position: [(minX + maxX) / 2, 0.01, (minZ + maxZ) / 2],
          rotation: [0, 0, 0],
          dimensions: { length: maxX - minX, thickness: maxZ - minZ, height: 0.01 },
          confidence: 0.9,
          editable: true,
          layer: LAYERS.FLOORS,
          roomId: room.id,
          name: room.name,
        });

        objects.push({
          id: `ceiling_${room.id}`,
          type: 'ceiling',
          source_2d: room.id,
          position: [(minX + maxX) / 2, wallHeight, (minZ + maxZ) / 2],
          rotation: [0, 0, 0],
          dimensions: { length: maxX - minX, thickness: maxZ - minZ, height: 0.01 },
          confidence: 0.9,
          editable: true,
          layer: LAYERS.CEILINGS,
          roomId: room.id,
          name: room.name,
        });
      }
    });
  }

  return { objects, rooms };
}
