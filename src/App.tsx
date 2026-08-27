import { useState, useCallback } from 'react';
import { 
  Camera, 
  Upload, 
  Layers,
  Box,
  Eye,
  X,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Scan,
  Bug,
  Home,
  Edit3,
  Database,
  Sparkles,
  Move,
  Grid3x3,
  Cpu,
} from 'lucide-react';
import { FloorPlanEditor } from './components/FloorPlanEditor';
import { Viewer3D } from './components/Viewer3D';
import { ARPanel } from './components/ARPanel';
import { LiveARCapture } from './components/LiveARCapture';
import { PermissionHandler } from './components/PermissionHandler';
import { ViewModeSelector } from './components/ViewModeSelector';
import { VisualizationModes, VisualizationMode } from './components/VisualizationModes';
import { DebugPanel } from './components/DebugPanel';
import { DebugAnalyzer } from './components/DebugAnalyzer';
import { FloorPlan3DViewer } from './components/FloorPlan3DViewer';
import { FloorPlanEditor3D } from './components/FloorPlanEditor3D';
import { PipelineView } from './components/PipelineView';
import { PlantLibrary } from './components/PlantLibrary';
import { GaussianSplattingViewer } from './components/GaussianSplattingViewer';
import { BlenderStyleEditor } from './components/BlenderStyleEditor';
import { PreciseBlockoutEditor } from './components/PreciseBlockoutEditor';
import { SystemTester } from './components/SystemTester';
import { useStore } from './store';
import { parseFloorPlan, generateSamplePlan } from './lib/parser';
import { generate3DModel } from './lib/generator';
import { smartFloorPlanAnalysis } from './lib/gemini';
import './App.css'; // Import CSS for animations

type ViewMode = '2d' | '3d' | 'ar';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [vizMode, setVizMode] = useState<VisualizationMode>('structure');
  const [showSheet, setShowSheet] = useState(false);
  const [showLiveAR, setShowLiveAR] = useState(false);
  const [showPermissions, setShowPermissions] = useState(true); // Show permissions on first launch
  const [showDebug, setShowDebug] = useState(false); // Debug analyzer mode
  const [show3DViewer, setShow3DViewer] = useState(false); // 3D viewer mode
  const [showEditor3D, setShowEditor3D] = useState(false); // 3D editor mode
  const [showPipeline, setShowPipeline] = useState(false); // Pipeline visualization mode
  const [showLibrary, setShowLibrary] = useState(false); // Plant library mode
  const [showGaussianSplatting, setShowGaussianSplatting] = useState(false); // Gaussian splatting
  const [showBlenderEditor, setShowBlenderEditor] = useState(false); // Blender style editor
  const [showPreciseBlockout, setShowPreciseBlockout] = useState(false); // Precise blockout
  const [showSystemTester, setShowSystemTester] = useState(false); // System tester
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const {
    processedPlan,
    setProcessedPlan,
    setModel3d,
    isProcessing,
    setIsProcessing,
    error,
    setError,
    setCapturedImage,
  } = useStore();

  // Handle permissions granted
  const handlePermissionsGranted = useCallback(() => {
    setShowPermissions(false);
  }, []);

  // Take photo using native camera
  const handleTakePhoto = useCallback(async () => {
    setShowSheet(false);
    setIsProcessing(true);
    setProcessingStatus('Abrindo câmera...');
    
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      
      setProcessingStatus('Capturando imagem...');
      
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        width: 1920,
        height: 1080,
      });
      
      if (!image.dataUrl) {
        throw new Error('Falha ao capturar foto');
      }
      
      setCapturedImage(image.dataUrl);
      setProcessingStatus('Processando planta...');
      
      const img = new Image();
      img.src = image.dataUrl;
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Falha ao carregar imagem'));
      });
      
      // Check online status first - skip AI if offline for faster response
      const isOnline = navigator.onLine;
      let aiPlan = null;
      
      if (isOnline) {
        // Try Gemini AI first (only if online)
        setProcessingStatus('Analisando com IA...');
        
        const maxDim = 600;
        const ratio = Math.min(maxDim / img.width, maxDim / img.height);
        const smallW = Math.round(img.width * ratio);
        const smallH = Math.round(img.height * ratio);
        
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = smallW;
        smallCanvas.height = smallH;
        const smallCtx = smallCanvas.getContext('2d');
        smallCtx?.drawImage(img, 0, 0, smallW, smallH);
        const smallImageData = smallCanvas.toDataURL('image/jpeg', 0.6);
        
        try {
          aiPlan = await Promise.race([
            smartFloorPlanAnalysis(
              smallImageData,
              smallW,
              smallH,
              'camera-capture',
              'camera'
            ),
            new Promise<null>((_, reject) => 
              setTimeout(() => reject(new Error('AI_TIMEOUT')), 5000) // Reduced from 8s for faster fallback
            )
          ]);
        } catch (e) {
          console.log('AI failed, using CV fallback (offline or timeout)');
        }
      } else {
        console.log('Offline detected - skipping AI, using CV directly');
      }
      
      if (aiPlan && aiPlan.walls && aiPlan.walls.length > 0) {
        setProcessingStatus('Gerando modelo 3D...');
        const model = generate3DModel(aiPlan);
        setProcessedPlan(aiPlan);
        setModel3d(model as any);
        setProcessingStatus('');
        return;
      }
      
      // Fallback to traditional CV (works 100% offline)
      setProcessingStatus('Detectando paredes e cômodos...');
      const result = await parseFloorPlan(img, 'camera-capture');
      
      if (result.success && result.plan) {
        const model = generate3DModel(result.plan);
        setProcessedPlan(result.plan);
        setModel3d(model as any);
        setProcessingStatus('');
      } else if (result.plan && result.plan.walls.length > 0) {
        const model = generate3DModel(result.plan);
        setProcessedPlan(result.plan);
        setModel3d(model as any);
        setProcessingStatus('');
      } else {
        setError('Não foi possível detectar uma planta na imagem.');
        setProcessingStatus('');
      }
    } catch (err) {
      console.error('Camera error:', err);
      setError('Não foi possível acessar a câmera. Tente novamente.');
      setProcessingStatus('');
    } finally {
      setIsProcessing(false);
    }
  }, [setProcessedPlan, setModel3d, setIsProcessing, setError, setCapturedImage]);

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProcessingStatus('Processando imagem...');
    setError(null);

    try {
      const img = new Image();
      const imgUrl = URL.createObjectURL(file);
      img.src = imgUrl;
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Falha ao carregar imagem'));
      });
      
      setCapturedImage(imgUrl);
      
      // Check online status - skip AI if offline
      const isOnline = navigator.onLine;
      let aiPlan = null;
      
      if (isOnline) {
        setProcessingStatus('Analisando com IA...');
        
        const maxDim = 600;
        const ratio = Math.min(maxDim / img.width, maxDim / img.height);
        const smallW = Math.round(img.width * ratio);
        const smallH = Math.round(img.height * ratio);
        
        const canvas = document.createElement('canvas');
        canvas.width = smallW;
        canvas.height = smallH;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, smallW, smallH);
        const imageData = canvas.toDataURL('image/jpeg', 0.6);
        
        try {
          aiPlan = await Promise.race([
            smartFloorPlanAnalysis(
              imageData,
              smallW,
              smallH,
              file.name.replace(/\.[^/.]+$/, ''),
              'upload'
            ),
            new Promise<null>((_, reject) => 
              setTimeout(() => reject(new Error('AI_TIMEOUT')), 5000) // Reduced from 8s
            )
          ]);
        } catch (e) {
          console.log('AI failed, using CV fallback');
        }
      } else {
        console.log('Offline - using CV directly');
      }
      
      if (aiPlan && aiPlan.walls && aiPlan.walls.length > 0) {
        setProcessingStatus('Gerando modelo 3D...');
        const model = generate3DModel(aiPlan);
        setProcessedPlan(aiPlan);
        setModel3d(model as any);
        setProcessingStatus('');
        return;
      }
      
      setProcessingStatus('Detectando paredes...');
      const result = await parseFloorPlan(img, file.name.replace(/\.[^/.]+$/, ''));
      
      if (result.success && result.plan && result.plan.walls.length > 0) {
        const model = generate3DModel(result.plan);
        setProcessedPlan(result.plan);
        setModel3d(model as any);
        setProcessingStatus('');
      } else {
        setError('Não foi possível detectar uma planta na imagem.');
        setProcessingStatus('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setProcessingStatus('');
    } finally {
      setIsProcessing(false);
      setShowSheet(false);
    }
  }, [setProcessedPlan, setModel3d, setIsProcessing, setError, setCapturedImage]);

  // Load demo
  const handleLoadDemo = useCallback(() => {
    setIsProcessing(true);
    setProcessingStatus('Carregando demo...');
    
    setTimeout(() => {
      const sample = generateSamplePlan();
      const model = generate3DModel(sample);
      setProcessedPlan(sample);
      setModel3d(model as any);
      setIsProcessing(false);
      setProcessingStatus('');
      setShowSheet(false);
    }, 300);
  }, [setProcessedPlan, setModel3d, setIsProcessing]);

  // Skip permissions
  const handleSkipPermissions = useCallback(() => {
    setShowPermissions(false);
  }, []);

  // Show permissions screen first
  if (showPermissions) {
    return (
      <PermissionHandler 
        onPermissionsGranted={handlePermissionsGranted}
        onSkip={handleSkipPermissions}
      />
    );
  }

  // Debug Analyzer Mode - full screen diagnostic tool
  if (showDebug) {
    return (
      <div className="h-full">
        <button
          onClick={() => setShowDebug(false)}
          className="fixed top-4 right-4 z-50 px-4 py-2 bg-slate-800 text-white rounded-lg shadow-lg flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Voltar
        </button>
        <DebugAnalyzer />
      </div>
    );
  }

  // 3D Viewer Mode - pure 3D visualization (no AR)
  if (show3DViewer) {
    return <FloorPlan3DViewer onClose={() => setShow3DViewer(false)} />;
  }

  // 3D Editor Mode - editable structure
  if (showEditor3D) {
    return <FloorPlanEditor3D onClose={() => setShowEditor3D(false)} />;
  }

  // Plant Library Mode - storage and management
  if (showLibrary) {
    return <PlantLibrary onClose={() => setShowLibrary(false)} />;
  }

  // Gaussian Splatting Viewer
  if (showGaussianSplatting) {
    return <GaussianSplattingViewer onClose={() => setShowGaussianSplatting(false)} />;
  }

  // Blender Style Editor
  if (showBlenderEditor) {
    return <BlenderStyleEditor onClose={() => setShowBlenderEditor(false)} />;
  }

  // Precise Blockout Editor
  if (showPreciseBlockout) {
    return <PreciseBlockoutEditor onClose={() => setShowPreciseBlockout(false)} />;
  }

  // System Tester
  if (showSystemTester) {
    return <SystemTester onClose={() => setShowSystemTester(false)} />;
  }

  // Pipeline View - shows full system pipeline
  if (showPipeline) {
    return (
      <PipelineView
        onClose={() => setShowPipeline(false)}
        onNavigate={(stage) => {
          setShowPipeline(false);
          if (stage === 'ar') setShowLiveAR(true);
          else if (stage === 'editor') setShowEditor3D(true);
        }}
      />
    );
  }

  return (
    <div className="app-container h-full flex flex-col bg-secondary">
      {/* Header */}
      <header className="header flex items-center justify-between px-4 py-3 bg-surface/80 backdrop-blur-lg safe-area-top z-20">
        <div className="flex items-center gap-3">
          <div className="logo w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <svg viewBox="0 0 32 32" className="w-6 h-6 text-primary">
              <path d="M8 24V8h4v6h8v-6h4v16h-4v-6H12v6H8z" fill="currentColor"/>
            </svg>
          </div>
          <div>
            <h1 className="font-display font-bold text-lg">FloorVision AR</h1>
            <p className="text-xs text-slate-500">Planta → 3D + AR</p>
          </div>
        </div>

        {processedPlan && (
          <button
            onClick={() => setProcessedPlan(null)}
            className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            title="Nova planta"
          >
            <RefreshCw className="w-5 h-5 text-slate-400" />
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="main flex-1 overflow-hidden relative">
        {!processedPlan ? (
          <div className="home-screen h-full flex flex-col items-center justify-center p-6">
            <div className="icon-container w-24 h-24 rounded-3xl bg-primary/20 flex items-center justify-center mb-6 animate-pulse-slow">
              <Scan className="w-12 h-12 text-primary" />
            </div>

            <h2 className="text-2xl font-display font-bold text-center mb-2">
              Bem-vindo ao FloorVision
            </h2>
            <p className="text-slate-400 text-center mb-8 max-w-xs">
              Capture ou envie uma planta para visualizar em 3D e Realidade Aumentada
            </p>

            <div className="actions w-full max-w-sm space-y-3">
              {/* AR ao Vivo - Main feature */}
              <button
                onClick={() => setShowLiveAR(true)}
                className="action-btn primary w-full btn btn-primary py-5 text-xl flex items-center justify-center gap-3 relative overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-primary/30 to-transparent animate-shimmer" />
                <Scan className="w-7 h-7 relative z-10" />
                <span className="relative z-10 font-bold">AR ao Vivo</span>
                <span className="relative z-10 badge text-xs bg-white/20 px-2 py-1 rounded-full">NOVO</span>
              </button>

              <button
                onClick={() => setShowSheet(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3"
              >
                <Camera className="w-6 h-6" />
                <span>Capturar Planta</span>
              </button>

              <label className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 cursor-pointer">
                <Upload className="w-6 h-6" />
                <span>Enviar Arquivo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={handleLoadDemo}
                className="action-btn w-full btn btn-accent py-4 text-lg flex items-center justify-center gap-3"
              >
                <Box className="w-6 h-6" />
                <span>Ver Demo 3D</span>
              </button>

              <button
                onClick={() => setShow3DViewer(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 border-2 border-blue-500/40"
              >
                <Home className="w-6 h-6 text-blue-400" />
                <span>Visualizar Estrutura 3D (360°)</span>
              </button>

              <button
                onClick={() => setShowEditor3D(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 border-2 border-purple-500/40"
              >
                <Edit3 className="w-6 h-6 text-purple-400" />
                <span>Editor 3D (Planta → Caixas Editáveis)</span>
              </button>

              <button
                onClick={() => setShowLibrary(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 border-2 border-cyan-500/40"
              >
                <Database className="w-6 h-6 text-cyan-400" />
                <span>Biblioteca de Plantas</span>
              </button>

              <button
                onClick={() => setShowGaussianSplatting(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 border-2 border-pink-500/40"
              >
                <Sparkles className="w-6 h-6 text-pink-400" />
                <span>Gaussian Splatting 3D + Pin Tracker</span>
              </button>

              <button
                onClick={() => setShowBlenderEditor(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 border-2 border-blue-500/40"
              >
                <Move className="w-6 h-6 text-blue-400" />
                <span>Editor 3D Estilo Blender (Mover/Rotacionar/Escalar)</span>
                <span className="ml-2 badge text-xs bg-blue-500/20 px-2 py-0.5 rounded-full text-blue-300">NOVO</span>
              </button>

              <button
                onClick={() => setShowPreciseBlockout(true)}
                className="action-btn w-full btn btn-secondary py-4 text-lg flex items-center justify-center gap-3 border-2 border-green-500/40"
              >
                <Grid3x3 className="w-6 h-6 text-green-400" />
                <span>Blockout 3D Preciso (Paredes Alinhadas + Tetos)</span>
                <span className="ml-2 badge text-xs bg-green-500/20 px-2 py-0.5 rounded-full text-green-300">CORRIGIDO</span>
              </button>

              <button
                onClick={() => setShowSystemTester(true)}
                className="action-btn w-full btn btn-secondary py-3 text-sm flex items-center justify-center gap-3 border border-cyan-500/30"
              >
                <Cpu className="w-5 h-5 text-cyan-400" />
                <span className="text-cyan-400">Teste Automático do Sistema (18 verificações)</span>
              </button>

              <button
                onClick={() => setShowPipeline(true)}
                className="action-btn w-full btn btn-secondary py-3 text-sm flex items-center justify-center gap-3 border border-cyan-500/30"
              >
                <Layers className="w-5 h-5 text-cyan-400" />
                <span className="text-cyan-400">Ver Pipeline Completo (2D → 3D → AR)</span>
              </button>

              <button
                onClick={() => setShowDebug(true)}
                className="action-btn w-full btn btn-secondary py-3 text-base flex items-center justify-center gap-3 border border-yellow-500/30"
              >
                <Bug className="w-5 h-5 text-yellow-400" />
                <span className="text-yellow-400">Modo Debug / Analisador</span>
              </button>
            </div>

            {/* Tips */}
            <div className="tips mt-8 text-center text-sm text-slate-500 max-w-sm">
              <p className="font-medium text-slate-400 mb-2">Dicas:</p>
              <p>• Use plantas com linhas retas bem definidas</p>
              <p>• Boa iluminação sem sombras</p>
              <p>• Papel branco ou fundo claro</p>
            </div>
          </div>
        ) : (
          <>
            {/* View mode tabs */}
            <div className="tabs flex border-b border-slate-700/50 bg-surface/50">
              {[
                { id: '2d' as ViewMode, icon: Layers, label: '2D' },
                { id: '3d' as ViewMode, icon: Box, label: '3D' },
                { id: 'ar' as ViewMode, icon: Eye, label: 'AR' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setViewMode(tab.id)}
                  className={`tab flex-1 flex flex-col items-center gap-1 py-3 transition-all ${
                    viewMode === tab.id 
                      ? 'text-primary border-b-2 border-primary' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <tab.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* View content */}
            <div className="view-content flex-1 overflow-hidden relative">
              {viewMode === '2d' && <FloorPlanEditor />}
              {viewMode === '3d' && processedPlan && (
                <>
                  {/* Visualization mode selector */}
                  <div className="absolute top-4 left-4 right-4 z-10 flex justify-center">
                    <ViewModeSelector currentMode={vizMode} onModeChange={setVizMode} />
                  </div>
                  {/* 3D Visualization with selected mode */}
                  <VisualizationModes plan={processedPlan} mode={vizMode} />
                </>
              )}
              {viewMode === '3d' && !processedPlan && <Viewer3D />}
              {viewMode === 'ar' && <ARPanel />}
            </div>
          </>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="processing-overlay absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 backdrop-blur-sm">
            <div className="spinner w-16 h-16 mb-4" />
            <p className="text-white text-lg mb-2">{processingStatus || 'Processando...'}</p>
            <p className="text-slate-400 text-sm">Aguarde...</p>
          </div>
        )}

        {/* Error display */}
        {error && !isProcessing && (
          <div className="error-toast absolute bottom-20 left-4 right-4 bg-red-500/95 rounded-xl p-4 z-50 animate-slide-up">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-white flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-white font-medium">Erro</p>
                <p className="text-white/80 text-sm">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)}
                className="text-white/60 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Live AR Capture Modal */}
      {showLiveAR && (
        <LiveARCapture onClose={() => setShowLiveAR(false)} />
      )}

      {/* Bottom Sheet */}
      {showSheet && (
        <>
          <div 
            className="sheet-backdrop fixed inset-0 bg-black/50 z-40 animate-fade-in"
            onClick={() => setShowSheet(false)}
          />
          <div className="bottom-sheet fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl z-50 safe-area-bottom animate-slide-up">
            <div className="handle w-12 h-1 bg-slate-600 rounded-full mx-auto mt-3 mb-4" />
            
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-semibold">Capturar Planta</h3>
              
              <button
                onClick={handleTakePhoto}
                className="sheet-item w-full flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl active:bg-slate-600/50 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium">Tirar Foto</p>
                  <p className="text-sm text-slate-400">Use a câmera traseira</p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
              </button>

              <label className="sheet-item w-full flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl cursor-pointer active:bg-slate-600/50 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-accent" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium">Escolher da Galeria</p>
                  <p className="text-sm text-slate-400">Selecione uma imagem</p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </>
      )}

      {/* Debug Panel - shows processing logs */}
      <DebugPanel />
    </div>
  );
}
