import React, { useState, useCallback, useRef } from 'react';
import { floorPlanDetector } from '../floorplan/detector';
import { reconstructionEngine } from '../geometry/reconstruction';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { 
  Upload, 
  Camera, 
  Play, 
  Trash2, 
  Download,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Eye,
  Box,
  Layers
} from 'lucide-react';

interface DebugLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  data?: any;
}

export function DebugAnalyzer() {
  const [image, setImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [floorPlan, setFloorPlan] = useState<any>(null);
  const [model3D, setModel3D] = useState<any>(null);
  const [visualizationMode, setVisualizationMode] = useState<'structure' | 'wireframe' | 'architectural'>('structure');
  const [wallHeight, setWallHeight] = useState(2.7);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Logging helper
  const addLog = useCallback((type: DebugLog['type'], message: string, data?: any) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    setLogs(prev => [...prev, { timestamp, type, message, data }]);
    console.log(`[${type.toUpperCase()}] ${message}`, data || '');
  }, []);

  // Handle image upload
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addLog('info', `Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImage(dataUrl);
      addLog('success', 'Imagem carregada com sucesso');
    };
    reader.readAsDataURL(file);
  }, [addLog]);

  // Process image
  const processImage = useCallback(async () => {
    if (!image) {
      addLog('error', 'Nenhuma imagem selecionada');
      return;
    }

    setIsProcessing(true);
    addLog('info', '=== INICIANDO PROCESSAMENTO ===');

    try {
      // Step 1: Create Image element
      addLog('info', '1. Carregando imagem...');
      const img = new Image();
      img.src = image;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Falha ao carregar imagem'));
      });
      addLog('success', `Imagem carregada: ${img.width}x${img.height}`);

      // Step 2: Check online status
      const isOnline = navigator.onLine;
      addLog(isOnline ? 'info' : 'warning', `Status de rede: ${isOnline ? 'Online' : 'Offline'}`);

      // Step 3: Detect floor plan
      addLog('info', '2. Detectando planta baixa...');
      const startTime = Date.now();
      const result = await floorPlanDetector.detect(img, 'debug-analyzer');
      const detectionTime = Date.now() - startTime;
      
      addLog('info', `Detecção concluída em ${detectionTime}ms`);
      addLog('info', `Método usado: ${result.method}`);
      addLog('success', `Sucesso: ${result.success}`);

      if (result.success && result.floorPlan) {
        setFloorPlan(result.floorPlan);
        addLog('success', 'Planta detectada!', {
          walls: result.floorPlan.walls?.length || 0,
          rooms: result.floorPlan.rooms?.length || 0,
          doors: result.floorPlan.doors?.length || 0,
          windows: result.floorPlan.windows?.length || 0,
        });

        // Step 4: Reconstruct 3D
        addLog('info', '3. Reconstruindo modelo 3D...');
        
        const scaleConfig = {
          pixelsPerMeter: 100,
          isCalibrated: false,
        };
        
        const coordSystem = {
          origin: result.floorPlan.bounds?.min || { x: 0, y: 0 },
          rotation: 0,
          flipX: false,
          flipY: false,
        };

        reconstructionEngine.setWallHeight(wallHeight);
        const model = reconstructionEngine.reconstruct(result.floorPlan, scaleConfig, coordSystem);
        
        setModel3D(model);
        addLog('success', 'Modelo 3D gerado!', {
          modelType: model ? 'Model3D' : 'null',
        });

        // Step 5: Render preview
        addLog('info', '4. Renderizando preview...');
        
      } else {
        addLog('error', 'Falha ao detectar planta', result.errors);
      }

      addLog('success', '=== PROCESSAMENTO CONCLUÍDO ===');
    } catch (error: any) {
      addLog('error', 'Erro no processamento', error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [image, wallHeight, addLog]);

  // Clear all
  const handleClear = useCallback(() => {
    setImage(null);
    setFloorPlan(null);
    setModel3D(null);
    setLogs([]);
    addLog('info', 'Tudo limpo');
  }, [addLog]);

  // Download logs
  const handleDownloadLogs = useCallback(() => {
    const logText = logs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}${l.data ? '\n' + JSON.stringify(l.data, null, 2) : ''}`).join('\n\n');
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  // Render 3D model
  const render3D = useCallback(() => {
    if (!model3D) return null;

    const config = {
      mode: visualizationMode,
      showWalls: true,
      showDoors: true,
      showWindows: true,
      showRooms: true,
      showFloor: visualizationMode !== 'wireframe',
      showCeiling: visualizationMode === 'architectural',
      showDimensions: visualizationMode === 'wireframe',
      wallHeight,
      wallThickness: 0.15,
      materials: {
        walls: {
          color: visualizationMode === 'wireframe' ? '#ffffff' : '#4A5568',
          opacity: visualizationMode === 'wireframe' ? 0.5 : 1,
          wireframe: visualizationMode === 'wireframe',
        },
        floor: {
          color: visualizationMode === 'architectural' ? '#8B4513' : '#4A5568',
          opacity: 1,
          wireframe: visualizationMode === 'wireframe',
        },
        ceiling: {
          visible: visualizationMode === 'architectural',
          color: '#ffffff',
          opacity: 0.5,
        },
        doors: { color: '#8B4513', style: 'simple' as const },
        windows: { color: '#87CEEB', style: 'framed' as const, showGlass: visualizationMode === 'architectural' },
      },
    };

    const mesh = reconstructionEngine.createThreeJSMeshes(model3D, config);
    return <primitive object={mesh} />;
  }, [model3D, visualizationMode, wallHeight]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Eye className="w-6 h-6 text-blue-400" />
              Debug Analyzer - FloorVision
            </h1>
            <p className="text-slate-400 text-sm">Teste e diagnóstico do sistema</p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              navigator.onLine ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {navigator.onLine ? '🟢 Online' : '🔴 Offline'}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
              WebXR: {navigator.xr ? 'Disponível' : 'Indisponível'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: Controls & Image */}
          <div className="space-y-4">
            {/* Upload */}
            <div className="bg-slate-800 rounded-xl p-4">
              <h2 className="font-bold mb-3 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload de Imagem
              </h2>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-slate-600 rounded-xl hover:border-blue-500 transition-colors flex flex-col items-center gap-2"
              >
                <Camera className="w-12 h-12 text-slate-400" />
                <span className="text-slate-400">Clique para selecionar imagem</span>
              </button>

              {image && (
                <div className="mt-4">
                  <img 
                    src={image} 
                    alt="Preview" 
                    className="w-full rounded-lg max-h-64 object-contain bg-slate-900"
                  />
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="bg-slate-800 rounded-xl p-4">
              <h2 className="font-bold mb-3">Controles</h2>
              
              <div className="space-y-4">
                {/* Wall Height */}
                <div>
                  <label className="text-sm text-slate-400">Altura das paredes: {wallHeight}m</label>
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

                {/* Visualization Mode */}
                <div>
                  <label className="text-sm text-slate-400 block mb-2">Modo de Visualização</label>
                  <div className="flex gap-2">
                    {[
                      { mode: 'wireframe' as const, icon: Layers, label: 'Wire' },
                      { mode: 'structure' as const, icon: Box, label: 'Estrutura' },
                      { mode: 'architectural' as const, icon: Eye, label: 'Visual' },
                    ].map(({ mode, icon: Icon, label }) => (
                      <button
                        key={mode}
                        onClick={() => setVisualizationMode(mode)}
                        className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${
                          visualizationMode === mode
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-sm">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={processImage}
                    disabled={!image || isProcessing}
                    className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${
                      !image || isProcessing
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-500 text-white'
                    }`}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Processando...
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5" />
                        Processar
                      </>
                    )}
                  </button>
                  
                  <button
                    onClick={handleClear}
                    className="px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Floor Plan Info */}
            {floorPlan && (
              <div className="bg-slate-800 rounded-xl p-4">
                <h2 className="font-bold mb-3 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Planta Detectada
                </h2>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className="text-2xl font-bold text-blue-400">{floorPlan.walls?.length || 0}</div>
                    <div className="text-sm text-slate-400">Paredes</div>
                  </div>
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className="text-2xl font-bold text-green-400">{floorPlan.rooms?.length || 0}</div>
                    <div className="text-sm text-slate-400">Cômodos</div>
                  </div>
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className="text-2xl font-bold text-yellow-400">{floorPlan.doors?.length || 0}</div>
                    <div className="text-sm text-slate-400">Portas</div>
                  </div>
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className="text-2xl font-bold text-cyan-400">{floorPlan.windows?.length || 0}</div>
                    <div className="text-sm text-slate-400">Janelas</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: 3D Preview & Logs */}
          <div className="space-y-4">
            {/* 3D Preview */}
            <div className="bg-slate-800 rounded-xl overflow-hidden" style={{ height: '400px' }}>
              <div className="p-3 border-b border-slate-700 flex items-center justify-between">
                <h2 className="font-bold flex items-center gap-2">
                  <Box className="w-4 h-4" />
                  Preview 3D
                </h2>
                {model3D && (
                  <span className="text-xs text-green-400">✓ Modelo carregado</span>
                )}
              </div>
              
              {model3D ? (
                <Canvas camera={{ position: [10, 10, 10], fov: 60 }} style={{ height: '350px', background: '#1a1a2e' }}>
                  <ambientLight intensity={0.6} />
                  <directionalLight position={[10, 10, 5]} intensity={0.8} />
                  {render3D()}
                  <OrbitControls />
                </Canvas>
              ) : (
                <div className="h-[350px] flex items-center justify-center text-slate-500">
                  Nenhum modelo gerado
                </div>
              )}
            </div>

            {/* Logs */}
            <div className="bg-slate-800 rounded-xl overflow-hidden" style={{ maxHeight: '400px' }}>
              <div className="p-3 border-b border-slate-700 flex items-center justify-between">
                <h2 className="font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Logs de Debug
                  <span className="ml-2 px-2 py-0.5 bg-slate-700 rounded-full text-xs">{logs.length}</span>
                </h2>
                
                {logs.length > 0 && (
                  <button
                    onClick={handleDownloadLogs}
                    className="p-2 hover:bg-slate-700 rounded-lg"
                    title="Baixar logs"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              <div className="p-3 overflow-y-auto" style={{ maxHeight: '340px' }}>
                {logs.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">
                    Nenhum log ainda. Clique em "Processar" para iniciar.
                  </p>
                ) : (
                  <div className="space-y-2 text-sm font-mono">
                    {logs.map((log, i) => (
                      <div 
                        key={i} 
                        className={`p-2 rounded ${
                          log.type === 'error' ? 'bg-red-500/20 text-red-300' :
                          log.type === 'success' ? 'bg-green-500/20 text-green-300' :
                          log.type === 'warning' ? 'bg-yellow-500/20 text-yellow-300' :
                          'bg-slate-700/50 text-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-slate-500 shrink-0">{log.timestamp}</span>
                          <span className="flex-1">{log.message}</span>
                        </div>
                        {log.data && (
                          <pre className="mt-1 text-xs text-slate-400 overflow-x-auto">
                            {typeof log.data === 'object' ? JSON.stringify(log.data, null, 2) : log.data}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
