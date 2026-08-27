import { useState, useCallback, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { createXRStore, XR } from '@react-three/xr';
import {
  ARState,
  ARSupportInfo,
  FloorPlan2D,
  Model3D,
  VisualizationMode,
  TrackingQuality,
} from '../../types';
import { floorPlanDetector } from '../../floorplan/detector';
import { reconstructionEngine } from '../../geometry/reconstruction';
import { useStore } from '../../store';
import {
  Camera,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Eye,
  Box,
  Layers,
  Maximize2,
  Smartphone,
} from 'lucide-react';

// ============================================
// XR STORE for WebXR AR
// ============================================
const xrStore = createXRStore();

// ============================================
// AR EXPERIENCE COMPONENT
// ============================================

interface ARExperienceProps {
  imageData: string;
  onClose: () => void;
}

export function ARExperience({ imageData, onClose }: ARExperienceProps) {
  const [arState, setArState] = useState<ARState>('initializing');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Inicializando...');
  const [floorPlan, setFloorPlan] = useState<FloorPlan2D | null>(null);
  const [model3D, setModel3D] = useState<Model3D | null>(null);
  const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>('structure');
  const [trackingQuality, setTrackingQuality] = useState<TrackingQuality>('normal');
  const [showCalibration, setShowCalibration] = useState(false);
  const [scale, setScale] = useState(100); // pixels per meter
  const [wallHeight, setWallHeight] = useState(2.7);
  const [xrSupported, setXrSupported] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { setModel3d: setStoreModel3D } = useStore();

  // Verificar suporte AR
  useEffect(() => {
    checkARSupport();
  }, []);

  // Verificar suporte do dispositivo
  const checkARSupport = useCallback(async () => {
    setArState('initializing');
    setMessage('Verificando recursos...');
    setProgress(10);

    const info: ARSupportInfo = {
      level: 'basic',
      hasWebXR: false,
      hasARCore: false,
      hasARKit: false,
      hasImageTracking: false,
      message: '',
    };

    // Verificar WebXR + ARCore
    if (navigator.xr) {
      try {
        // Verificar AR imersivo
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        info.hasWebXR = supported;
        setXrSupported(supported);
        
        if (supported) {
          info.level = 'full';
          info.hasARCore = true;
          info.message = 'ARCore + WebXR disponível!';
        }
      } catch (e) {
        console.log('WebXR AR not supported:', e);
        info.message = 'WebXR não disponível';
      }
    }

    // Verificar câmera
    try {
      const devices = await navigator.mediaDevices.getUserMedia({ video: true });
      info.hasImageTracking = true;
      devices.getTracks().forEach(track => track.stop());
    } catch (e) {
      console.log('Camera not available');
    }

    // Definir nível baseado no suporte
    if (info.hasWebXR) {
      info.level = 'full';
    } else if (info.hasImageTracking) {
      info.level = 'surface';
      info.message = 'Superfície detectada';
    } else {
      info.level = 'basic';
      info.message = 'Visualização 3D';
    }

    setProgress(20);

    // Iniciar fluxo (câmera ou WebXR)
    await startCameraOrXR();
  }, []);

  // Iniciar câmera ou XR
  const startCameraOrXR = useCallback(async () => {
    setArState('requesting_permission');
    setMessage(xrSupported ? 'Iniciando ARCore...' : 'Acessando câmera...');
    setProgress(25);

    try {
      // Tentar iniciar stream de câmera para preview
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      // Criar elemento de vídeo
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      videoRef.current = video;

      setProgress(30);

      // Iniciar detecção
      await detectFloorPlan();
    } catch (error) {
      console.error('Camera/XR error:', error);
      setArState('error');
      setMessage('Não foi possível acessar a câmera');
    }
  }, [xrSupported]);

  // Iniciar sessão AR (WebXR)
  const enterAR = useCallback(async () => {
    try {
      await xrStore.enterAR();
      setIsPresenting(true);
      setMessage('RA Ativa! Toque para posicionar');
    } catch (e) {
      console.error('Failed to enter AR:', e);
      setMessage('AR não disponível neste dispositivo');
    }
  }, []);

  // Detectar planta
  const detectFloorPlan = useCallback(async () => {
    setArState('detecting_floorplan');
    setMessage('Detectando planta...');
    setProgress(40);

    // Criar imagem para detecção
    const img = new Image();
    img.src = imageData;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
    });

    // Detectar usando o detector
    const result = await floorPlanDetector.detect(img, 'ar-experience');

    if (result.success && result.floorPlan) {
      setFloorPlan(result.floorPlan);
      setProgress(60);
      setMessage('Planta detectada!');
      
      // Calibrar escala
      await calibrateScale(result.floorPlan);
    } else {
      setArState('error');
      setMessage('Não foi possível detectar a planta');
    }
  }, [imageData]);

  // Calibrar escala
  const calibrateScale = useCallback(async (fp: FloorPlan2D) => {
    setArState('calibrating');
    setMessage('Calibrando escala...');
    setProgress(70);

    // Calcular escala baseada nas dimensões da imagem
    const imgWidth = fp.bounds.max.x - fp.bounds.min.x;
    const assumedRealWidth = 10; // metros
    const calculatedScale = imgWidth / assumedRealWidth;
    
    setScale(calculatedScale);
    setProgress(80);

    // Reconstruir modelo 3D
    await reconstruct3DModel(fp, calculatedScale);
  }, []);

  // Reconstruir modelo 3D
  const reconstruct3DModel = useCallback(async (fp: FloorPlan2D, calculatedScale: number) => {
    setArState('model_loading');
    setMessage('Gerando modelo 3D...');
    setProgress(90);

    // Configuração de escala
    const scaleConfig = {
      pixelsPerMeter: calculatedScale,
      isCalibrated: true,
    };

    // Sistema de coordenadas
    const coordSystem = {
      origin: fp.bounds.min,
      rotation: 0,
      flipX: false,
      flipY: false,
    };

    // Reconstruir
    reconstructionEngine.setWallHeight(wallHeight);
    const model = reconstructionEngine.reconstruct(fp, scaleConfig, coordSystem);

    setModel3D(model);
    setStoreModel3D(model as any);
    setProgress(100);
    setArState('ar_active');
    setMessage('Modelo 3D pronto!');
    setTrackingQuality('good');
  }, [wallHeight, setStoreModel3D]);

  // Reiniciar
  const handleRestart = useCallback(() => {
    // Parar câmera atual
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Resetar estado
    setFloorPlan(null);
    setModel3D(null);
    setProgress(0);
    setIsPresenting(false);
    
    // Reiniciar
    checkARSupport();
  }, [checkARSupport]);

  // Renderizar visualização 3D
  const renderVisualization = useCallback(() => {
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
        doors: {
          color: '#8B4513',
          style: 'simple' as const,
        },
        windows: {
          color: '#87CEEB',
          style: 'framed' as const,
          showGlass: visualizationMode === 'architectural',
        },
      },
    };

    const mesh = reconstructionEngine.createThreeJSMeshes(model3D, config);
    return <primitive object={mesh} />;
  }, [model3D, visualizationMode, wallHeight]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Provider XR Store */}
      <XR store={xrStore}>
        {/* Background da câmera */}
        {videoRef.current && (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
        )}

        {/* Canvas 3D sobreposto */}
        {model3D && arState === 'ar_active' && (
          <div className="absolute inset-0">
            <Canvas
              camera={{ position: [10, 10, 10], fov: 60 }}
              style={{ background: 'transparent' }}
            >
              <ambientLight intensity={0.6} />
              <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
              
              {renderVisualization()}
              
              <OrbitControls
                enableZoom={true}
                enablePan={true}
                enableRotate={true}
                minDistance={2}
                maxDistance={50}
              />
            </Canvas>
          </div>
        )}
      </XR>

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              xrSupported ? 'bg-green-500' :
              trackingQuality === 'normal' ? 'bg-yellow-500' : 'bg-red-500'
            } animate-pulse`} />
            <span className="text-white font-medium text-sm">
              {xrSupported ? '🟢 ARCore + WebXR' : '📷 Câmera + 3D'}
            </span>
          </div>
          
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
          >
            <AlertCircle className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>

      {/* Status/Loading */}
      {arState !== 'ar_active' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="w-24 h-24 rounded-full bg-blue-500/20 flex items-center justify-center mb-6">
            {arState === 'error' ? (
              <AlertCircle className="w-12 h-12 text-red-500" />
            ) : (
              <Smartphone className="w-12 h-12 text-blue-400 animate-pulse" />
            )}
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">
            {arState === 'error' ? 'Ops!' : 'Processando...'}
          </h2>
          
          <p className="text-white/70 mb-6">{message}</p>
          
          {/* Progress bar */}
          <div className="w-64 mb-4">
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          
          {arState === 'error' && (
            <button
              onClick={handleRestart}
              className="px-6 py-3 bg-blue-600 rounded-xl text-white font-bold"
            >
              Tentar Novamente
            </button>
          )}
        </div>
      )}

      {/* Detected info overlay */}
      {floorPlan && arState === 'ar_active' && (
        <div className="absolute top-20 left-4 bg-black/60 rounded-xl p-3 z-10">
          <p className="text-white text-sm font-medium">
            {floorPlan.walls.length} paredes
          </p>
          <p className="text-white/70 text-xs">
            {floorPlan.rooms.length} cômodos
          </p>
          <p className="text-blue-400 text-xs mt-1">
            {xrSupported ? '🎯 ARCore ativo' : '📷 Modo câmera'}
          </p>
        </div>
      )}

      {/* AR Button */}
      {arState === 'ar_active' && xrSupported && !isPresenting && (
        <button
          onClick={enterAR}
          className="absolute bottom-32 left-1/2 -translate-x-1/2 px-6 py-4 bg-green-600 rounded-2xl text-white font-bold z-20 flex items-center gap-2 shadow-lg"
        >
          <Camera className="w-6 h-6" />
          <span>Entrar em Realidade Aumentada</span>
        </button>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent z-10">
        {/* Mode selector */}
        <div className="flex justify-center gap-2 mb-4">
          {[
            { mode: 'wireframe' as VisualizationMode, icon: Layers, label: 'Wire' },
            { mode: 'structure' as VisualizationMode, icon: Box, label: 'Estrutura' },
            { mode: 'architectural' as VisualizationMode, icon: Eye, label: 'Visual' },
          ].map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setVisualizationMode(mode)}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 ${
                visualizationMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/20 text-white/70'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm">{label}</span>
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setShowCalibration(true)}
            className="flex items-center gap-2 px-4 py-3 bg-white/20 rounded-xl text-white"
          >
            <Maximize2 className="w-5 h-5" />
            <span>Calibrar</span>
          </button>
          
          <button
            onClick={handleRestart}
            className="flex items-center gap-2 px-4 py-3 bg-white/20 rounded-xl text-white"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Nova Planta</span>
          </button>
          
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-3 bg-blue-600 rounded-xl text-white font-bold"
          >
            <CheckCircle className="w-5 h-5" />
            <span>Concluir</span>
          </button>
        </div>
      </div>

      {/* Calibration Modal */}
      {showCalibration && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30">
          <div className="bg-slate-800 rounded-2xl p-6 w-80">
            <h3 className="text-white font-bold text-lg mb-4">Calibrar</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-slate-400 text-sm">Altura das paredes (m)</label>
                <input
                  type="range"
                  min="2"
                  max="4"
                  step="0.1"
                  value={wallHeight}
                  onChange={(e) => setWallHeight(parseFloat(e.target.value))}
                  className="w-full"
                />
                <p className="text-white text-center">{wallHeight.toFixed(1)} m</p>
              </div>
              
              <div>
                <label className="text-slate-400 text-sm">Escala</label>
                <p className="text-white text-center">{Math.round(scale)} px/m</p>
              </div>
            </div>
            
            <button
              onClick={() => {
                setShowCalibration(false);
                if (model3D) {
                  reconstructionEngine.setWallHeight(wallHeight);
                }
              }}
              className="w-full mt-4 py-3 bg-blue-600 rounded-xl text-white font-bold"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
