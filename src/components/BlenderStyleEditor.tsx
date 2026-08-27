import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges, TransformControls, Grid, Html } from '@react-three/drei';
import { 
  Box, 
  Layers, 
  RotateCw, 
  X, 
  Loader2,
  Plus,
  Trash2,
  Grid3x3,
  Move,
  Crosshair,
  Lock,
  Unlock,
  Square,
  Circle,
  Triangle,
  EyeOff,
  Eye as EyeOn,
  Copy,
} from 'lucide-react';

// ============================================
// TYPES
// ============================================
import { 
  DimensionalContext 
} from '../floorplan/typesExtensions';
import { 
  HAND_DRAWN_PLAN, 
  buildStructuralPlan 
} from '../floorplan/structuralIntelligence';

type TransformMode = 'translate' | 'rotate' | 'scale';

interface PrimitiveItem {
  id: string;
  type: 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'room' | 'furniture' | 'cube' | 'sphere' | 'cylinder';
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  dimensions: { width: number; height: number; depth: number };
  color: string;
  name: string;
  layer: string;
  isVisible: boolean;
  isLocked: boolean;
}

// ============================================
// PRIMITIVE LIBRARY
// ============================================
const PRIMITIVE_TEMPLATES = {
  cube: { name: 'Cubo', icon: Square, dimensions: { width: 1, height: 1, depth: 1 }, color: '#3B82F6' },
  sphere: { name: 'Esfera', icon: Circle, dimensions: { width: 1, height: 1, depth: 1 }, color: '#10B981' },
  cylinder: { name: 'Cilindro', icon: Circle, dimensions: { width: 0.5, height: 2, depth: 0.5 }, color: '#F59E0B' },
  pyramid: { name: 'Pirâmide', icon: Triangle, dimensions: { width: 1, height: 1.5, depth: 1 }, color: '#8B5CF6' },
  wall: { name: 'Parede', icon: Box, dimensions: { width: 3, height: 2.8, depth: 0.15 }, color: '#6B7280' },
  door: { name: 'Porta', icon: Box, dimensions: { width: 0.9, height: 2.1, depth: 0.05 }, color: '#92400E' },
  window: { name: 'Janela', icon: Square, dimensions: { width: 1.2, height: 1.2, depth: 0.05 }, color: '#7DD3FC' },
  chair: { name: 'Cadeira', icon: Box, dimensions: { width: 0.5, height: 0.9, depth: 0.5 }, color: '#A78BFA' },
  table: { name: 'Mesa', icon: Box, dimensions: { width: 1.2, height: 0.75, depth: 0.8 }, color: '#92400E' },
};

// ============================================
// MAIN EDITOR
// ============================================
interface BlenderStyleEditorProps {
  onClose?: () => void;
}

export function BlenderStyleEditor({ onClose }: BlenderStyleEditorProps) {
  const [view, setView] = useState<'upload' | 'editor'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  
  // 3D Items (Editor)
  const [items, setItems] = useState<PrimitiveItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Transform controls
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapValue, setSnapValue] = useState(0.5);
  const [spaceMode, setSpaceMode] = useState<'world' | 'local'>('world');
  
  // View options
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  
  // Layers
  const [activeLayer, setActiveLayer] = useState('default');
  const [layers, setLayers] = useState<Record<string, { visible: boolean; locked: boolean; name: string }>>({
    'default': { visible: true, locked: false, name: 'Principal' },
    'furniture': { visible: true, locked: false, name: 'Móveis' },
    'structure': { visible: true, locked: false, name: 'Estrutura' },
    'reference': { visible: true, locked: false, name: 'Referências' },
  });
  
  // Camera
  const [cameraView, setCameraView] = useState<'perspective' | 'top' | 'front' | 'side'>('perspective');
  
  // Undo/Redo
  const [history, setHistory] = useState<PrimitiveItem[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const transformRef = useRef<any>(null);

  // ============================================
  // LOAD HAND-DRAWN PLANT
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
      const { objects } = buildStructuralPlan(plan, context);
      
      // Convert to editor items
      const newItems: PrimitiveItem[] = objects.map((obj) => ({
        id: obj.id,
        type: obj.type as any,
        position: obj.position,
        rotation: obj.rotation,
        scale: [1, 1, 1],
        dimensions: {
          width: obj.dimensions.length,
          height: obj.dimensions.height,
          depth: obj.dimensions.thickness,
        },
        color: obj.type === 'wall' 
          ? (obj.isExterior ? '#6B7280' : '#94A3B8')
          : obj.type === 'floor' ? '#D1D5DB'
          : obj.type === 'ceiling' ? '#F3F4F6'
          : obj.type === 'door' ? '#92400E'
          : obj.type === 'window' ? '#7DD3FC'
          : '#94A3B8',
        name: obj.name || obj.type,
        layer: obj.layer,
        isVisible: true,
        isLocked: false,
      }));
      
      setItems(newItems);
      setView('editor');
      setIsProcessing(false);
      
      // Save initial state to history
      setHistory([newItems]);
      setHistoryIndex(0);
    }, 500);
  }, []);

  // ============================================
  // ADD PRIMITIVE
  // ============================================
  const addPrimitive = useCallback((type: keyof typeof PRIMITIVE_TEMPLATES) => {
    const template = PRIMITIVE_TEMPLATES[type];
    const newItem: PrimitiveItem = {
      id: `item_${Date.now()}`,
      type: type as any,
      position: [0, template.dimensions.height / 2, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dimensions: template.dimensions,
      color: template.color,
      name: template.name,
      layer: activeLayer,
      isVisible: true,
      isLocked: false,
    };
    
    setItems(prev => {
      const updated = [...prev, newItem];
      saveHistory(updated);
      return updated;
    });
    setSelectedId(newItem.id);
    setShowAddPanel(false);
  }, [activeLayer]);

  // ============================================
  // DELETE ITEM
  // ============================================
  const deleteItem = useCallback((id: string) => {
    setItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      saveHistory(updated);
      return updated;
    });
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  // ============================================
  // DUPLICATE ITEM
  // ============================================
  const duplicateItem = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    
    const newItem: PrimitiveItem = {
      ...item,
      id: `item_${Date.now()}`,
      position: [item.position[0] + 1, item.position[1], item.position[2] + 1],
      name: item.name + ' (cópia)',
    };
    
    setItems(prev => {
      const updated = [...prev, newItem];
      saveHistory(updated);
      return updated;
    });
    setSelectedId(newItem.id);
  }, [items]);

  // ============================================
  // UPDATE ITEM
  // ============================================
  const updateItem = useCallback((id: string, updates: Partial<PrimitiveItem>) => {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, ...updates } : i);
      return updated;
    });
  }, []);

  // ============================================
  // HISTORY (Undo/Redo)
  // ============================================
  const saveHistory = useCallback((newItems: PrimitiveItem[]) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const updated = [...trimmed, newItems];
      setHistoryIndex(updated.length - 1);
      return updated;
    });
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setItems(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setItems(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  // ============================================
  // VIEW PRESETS
  // ============================================
  const setViewPreset = (preset: 'perspective' | 'top' | 'front' | 'side') => {
    setCameraView(preset);
  };

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      
      if (e.key === 'g') setTransformMode('translate');
      else if (e.key === 'r') setTransformMode('rotate');
      else if (e.key === 's') setTransformMode('scale');
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) deleteItem(selectedId);
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedId) duplicateItem(selectedId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedId, deleteItem, duplicateItem, undo, redo]);

  // ============================================
  // UPLOAD VIEW
  // ============================================
  if (view === 'upload') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Box className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="font-bold text-white">Editor 3D Estilo Blender</h1>
              <p className="text-slate-400 text-sm">Mover, Rotacionar, Escalar</p>
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
          
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Editor 3D Profissional</h2>
          <p className="text-slate-400 text-center mb-8 max-w-md">
            Mova, rotacione, escale e adicione itens estruturais com gizmos 3D. 
            Snap to grid, undo/redo, múltiplas camadas.
          </p>

          <div className="w-full max-w-sm space-y-3">
            <button
              onClick={loadHandDrawn}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>{processingStatus}</span>
                </>
              ) : (
                <>
                  <Box className="w-6 h-6" />
                  <span>Planta Desenhada à Mão</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-8 max-w-md text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-400 mb-2">Atalhos do teclado:</p>
            <p><kbd className="bg-slate-800 px-2 py-0.5 rounded">G</kbd> - Mover | <kbd className="bg-slate-800 px-2 py-0.5 rounded">R</kbd> - Rotacionar | <kbd className="bg-slate-800 px-2 py-0.5 rounded">S</kbd> - Escalar</p>
            <p><kbd className="bg-slate-800 px-2 py-0.5 rounded">Ctrl+Z</kbd> - Desfazer | <kbd className="bg-slate-800 px-2 py-0.5 rounded">DEL</kbd> - Apagar</p>
            <p><kbd className="bg-slate-800 px-2 py-0.5 rounded">Ctrl+D</kbd> - Duplicar</p>
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
            title="Voltar"
          >
            <X className="w-4 h-4" />
          </button>
          
          <div className="w-px h-6 bg-slate-700"></div>
          
          {/* Transform Mode */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTransformMode('translate')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                transformMode === 'translate' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title="Mover (G)"
            >
              <Move className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTransformMode('rotate')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                transformMode === 'rotate' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title="Rotacionar (R)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTransformMode('scale')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                transformMode === 'scale' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title="Escalar (S)"
            >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M9 3v6H3v2h6v6h2v-6h6V9h-6V3H9z"/>
            </svg>
            </button>
          </div>

          <div className="w-px h-6 bg-slate-700"></div>

          {/* Space */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSpaceMode('world')}
              className={`px-2 py-1 rounded text-xs ${
                spaceMode === 'world' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              World
            </button>
            <button
              onClick={() => setSpaceMode('local')}
              className={`px-2 py-1 rounded text-xs ${
                spaceMode === 'local' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              Local
            </button>
          </div>

          <div className="w-px h-6 bg-slate-700"></div>

          {/* Snap */}
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
              snapEnabled ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
            title="Snap to grid"
          >
            <Crosshair className="w-3 h-3" />
            Snap
          </button>

          <select
            value={snapValue}
            onChange={(e) => setSnapValue(parseFloat(e.target.value))}
            className="bg-slate-700 text-white text-xs px-2 py-1 rounded"
          >
            <option value="0.1">0.1m</option>
            <option value="0.25">0.25m</option>
            <option value="0.5">0.5m</option>
            <option value="1">1m</option>
            <option value="2">2m</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          {/* Undo/Redo */}
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center text-white"
            title="Desfazer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center text-white"
            title="Refazer (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          
          <div className="w-px h-6 bg-slate-700"></div>
          
          {/* View Presets */}
          <button
            onClick={() => setViewPreset('top')}
            className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300"
            title="Vista Superior"
          >
            Top
          </button>
          <button
            onClick={() => setViewPreset('front')}
            className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300"
            title="Vista Frontal"
          >
            Front
          </button>
          <button
            onClick={() => setViewPreset('side')}
            className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300"
            title="Vista Lateral"
          >
            Side
          </button>
          
          <div className="w-px h-6 bg-slate-700"></div>
          
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              showGrid ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
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
            title="Rotação automática"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3D Canvas */}
      <div className="flex-1 relative">
        <Canvas
          shadows
          camera={{ 
            position: cameraView === 'top' ? [0, 10, 0.1] : 
                     cameraView === 'front' ? [0, 0, 10] :
                     cameraView === 'side' ? [10, 0, 0] :
                     [8, 8, 8], 
            fov: 60 
          }}
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
              sectionColor="#3B82F6"
              fadeDistance={30}
              fadeStrength={1}
              followCamera={false}
              infiniteGrid={true}
            />
          )}
          
          {/* Render all items */}
          {items.filter(item => layers[item.layer]?.visible !== false && item.isVisible).map(item => (
            <PrimitiveMesh
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
          
          {/* Transform Controls */}
          {selectedItem && (
            <TransformControls
              ref={transformRef}
              object={transformRef.current?.object}
              mode={transformMode}
              space={spaceMode}
              size={0.8}
              showX
              showY
              showZ
              onObjectChange={() => {
                if (transformRef.current) {
                  const obj = transformRef.current.object;
                  if (obj) {
                    updateItem(selectedItem.id, {
                      position: [obj.position.x, obj.position.y, obj.position.z],
                      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
                      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
                    });
                  }
                }
              }}
            />
          )}
          
          <OrbitControls
            enableZoom={true}
            enablePan={true}
            enableRotate={cameraView === 'perspective'}
            minDistance={1}
            maxDistance={100}
            autoRotate={autoRotate}
            autoRotateSpeed={2}
            target={[0, 1, 0]}
            makeDefault
          />
        </Canvas>
      </div>

      {/* Left Sidebar - Tools */}
      <div className="absolute left-2 top-16 flex flex-col gap-1 z-20">
        <button
          onClick={() => setShowAddPanel(!showAddPanel)}
          className="w-12 h-12 rounded-lg bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white shadow-lg"
          title="Adicionar item"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowLayersPanel(!showLayersPanel)}
          className="w-12 h-12 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white shadow-lg"
          title="Layers"
        >
          <Layers className="w-5 h-5" />
        </button>
        <button
          onClick={() => selectedId && duplicateItem(selectedId)}
          disabled={!selectedId}
          className="w-12 h-12 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 flex items-center justify-center text-white shadow-lg"
          title="Duplicar"
        >
          <Copy className="w-5 h-5" />
        </button>
        <button
          onClick={() => selectedId && deleteItem(selectedId)}
          disabled={!selectedId}
          className="w-12 h-12 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-30 flex items-center justify-center text-white shadow-lg"
          title="Apagar"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {/* Add Panel */}
      {showAddPanel && (
        <div className="absolute left-16 top-16 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-56">
          <h3 className="text-white font-bold text-sm mb-2">Adicionar Item</h3>
          <div className="grid grid-cols-3 gap-1">
            {Object.entries(PRIMITIVE_TEMPLATES).map(([key, template]) => {
              const Icon = template.icon;
              return (
                <button
                  key={key}
                  onClick={() => addPrimitive(key as any)}
                  className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex flex-col items-center gap-1 transition-colors"
                >
                  <Icon className="w-4 h-4 text-white" />
                  <span className="text-[10px] text-slate-300">{template.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Layers Panel */}
      {showLayersPanel && (
        <div className="absolute left-16 top-16 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-64">
          <h3 className="text-white font-bold text-sm mb-2">Camadas (Layers)</h3>
          <div className="space-y-1">
            {Object.entries(layers).map(([key, layer]) => (
              <div key={key} className="flex items-center gap-2 p-1.5 hover:bg-slate-700 rounded">
                <button
                  onClick={() => setLayers({ ...layers, [key]: { ...layer, visible: !layer.visible } })}
                  className="text-slate-300"
                >
                  {layer.visible ? <EyeOn className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setLayers({ ...layers, [key]: { ...layer, locked: !layer.locked } })}
                  className="text-slate-300"
                >
                  {layer.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
                <span className="text-white text-xs flex-1">{layer.name}</span>
                <span className="text-slate-500 text-[10px]">
                  {items.filter(i => i.layer === key).length}
                </span>
                <button
                  onClick={() => setActiveLayer(key)}
                  className={`w-2 h-2 rounded-full ${
                    activeLayer === key ? 'bg-blue-500' : 'bg-slate-600'
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Right Panel - Properties */}
      {selectedItem && (
        <div className="absolute right-2 top-16 bottom-20 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-64 overflow-y-auto">
          <h3 className="text-white font-bold text-sm mb-3">Propriedades</h3>
          
          {/* Transform */}
          <div className="space-y-2 mb-3">
            <h4 className="text-slate-400 text-xs uppercase">Posição</h4>
            <div className="grid grid-cols-3 gap-1">
              {['x', 'y', 'z'].map((axis, i) => (
                <div key={axis}>
                  <label className="text-slate-500 text-[10px] uppercase">{axis}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedItem.position[i].toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      const newPos = [...selectedItem.position] as [number, number, number];
                      newPos[i] = val;
                      updateItem(selectedItem.id, { position: newPos });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 mb-3">
            <h4 className="text-slate-400 text-xs uppercase">Rotação</h4>
            <div className="grid grid-cols-3 gap-1">
              {['x', 'y', 'z'].map((axis, i) => (
                <div key={axis}>
                  <label className="text-slate-500 text-[10px] uppercase">{axis}</label>
                  <input
                    type="number"
                    step="15"
                    value={(selectedItem.rotation[i] * 180 / Math.PI).toFixed(0)}
                    onChange={(e) => {
                      const val = (parseFloat(e.target.value) || 0) * Math.PI / 180;
                      const newRot = [...selectedItem.rotation] as [number, number, number];
                      newRot[i] = val;
                      updateItem(selectedItem.id, { rotation: newRot });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 mb-3">
            <h4 className="text-slate-400 text-xs uppercase">Escala</h4>
            <div className="grid grid-cols-3 gap-1">
              {['x', 'y', 'z'].map((axis, i) => (
                <div key={axis}>
                  <label className="text-slate-500 text-[10px] uppercase">{axis}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedItem.scale[i].toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 1;
                      const newScale = [...selectedItem.scale] as [number, number, number];
                      newScale[i] = val;
                      updateItem(selectedItem.id, { scale: newScale });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 mb-3">
            <h4 className="text-slate-400 text-xs uppercase">Dimensões (m)</h4>
            <div className="grid grid-cols-3 gap-1">
              {['L', 'H', 'P'].map((dim, i) => (
                <div key={dim}>
                  <label className="text-slate-500 text-[10px] uppercase">{dim}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={[selectedItem.dimensions.width, selectedItem.dimensions.height, selectedItem.dimensions.depth][i].toFixed(2)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0.1;
                      const dims = { ...selectedItem.dimensions };
                      if (i === 0) dims.width = val;
                      else if (i === 1) dims.height = val;
                      else dims.depth = val;
                      updateItem(selectedItem.id, { dimensions: dims });
                    }}
                    className="w-full bg-slate-700 text-white px-2 py-1 rounded text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Visibility/Lock */}
          <div className="flex gap-1 mt-3">
            <button
              onClick={() => updateItem(selectedItem.id, { isVisible: !selectedItem.isVisible })}
              className={`flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1 ${
                selectedItem.isVisible ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {selectedItem.isVisible ? <EyeOn className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {selectedItem.isVisible ? 'Visível' : 'Oculto'}
            </button>
            <button
              onClick={() => updateItem(selectedItem.id, { isLocked: !selectedItem.isLocked })}
              className={`flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1 ${
                selectedItem.isLocked ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {selectedItem.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {selectedItem.isLocked ? 'Bloq.' : 'Livre'}
            </button>
          </div>

          {/* Color */}
          <div className="mt-3">
            <h4 className="text-slate-400 text-xs uppercase mb-1">Cor</h4>
            <input
              type="color"
              value={selectedItem.color}
              onChange={(e) => updateItem(selectedItem.id, { color: e.target.value })}
              className="w-full h-8 rounded cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-slate-800/95 backdrop-blur border-t border-slate-700 z-10">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4 text-slate-400">
            <span>📦 {items.length} objetos</span>
            <span>👁 {items.filter(i => i.isVisible).length} visíveis</span>
            <span>🔒 {items.filter(i => i.isLocked).length} bloqueados</span>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <span>Modo: <strong className="text-white">{transformMode === 'translate' ? 'Mover' : transformMode === 'rotate' ? 'Rotacionar' : 'Escalar'}</strong></span>
            <span>• Snap: <strong className="text-white">{snapValue}m</strong></span>
            <span>• Space: <strong className="text-white">{spaceMode}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// PRIMITIVE MESH
// ============================================
function PrimitiveMesh({ item, selected, onClick }: {
  item: PrimitiveItem;
  selected: boolean;
  onClick: () => void;
}) {
  // Get geometry based on type
  const getGeometry = () => {
    if (item.type === 'sphere' || item.type === 'cylinder') {
      return <sphereGeometry args={[item.dimensions.width / 2, 16, 16]} />;
    }
    if ((item.type as any) === 'pyramid') {
      return <coneGeometry args={[item.dimensions.width / 2, item.dimensions.height, 4]} />;
    }
    return <boxGeometry args={[item.dimensions.width, item.dimensions.height, item.dimensions.depth]} />;
  };

  return (
    <group>
      <mesh
        position={item.position}
        rotation={item.rotation}
        scale={item.scale}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          if (!item.isLocked) onClick();
        }}
      >
        {getGeometry()}
        <meshStandardMaterial
          color={selected ? '#3B82F6' : item.color}
          roughness={0.7}
          metalness={0.1}
          transparent={item.type === 'ceiling' || item.type === 'window'}
          opacity={item.type === 'ceiling' ? 0.4 : 1}
        />
        <Edges
          threshold={1}
          color={selected ? '#1D4ED8' : '#1F2937'}
          linewidth={selected ? 2 : 1}
        />
      </mesh>
      
      {/* Label */}
      {selected && (
        <Html position={[item.position[0], item.position[1] + item.dimensions.height / 2 + 0.3, item.position[2]]} center>
          <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-bold whitespace-nowrap">
            {item.name}
          </div>
        </Html>
      )}
    </group>
  );
}
