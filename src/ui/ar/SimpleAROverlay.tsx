import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { reconstructionEngine } from '../../geometry/reconstruction';
import { floorPlanDetector } from '../../floorplan/detector';
import { convertFileToImage } from '../../lib/pdfConverter';
import { 
  Camera, 
  RefreshCw, 
  X,
  Layers,
  Box,
  Eye,
  ZoomIn,
  RotateCw,
  Upload,
  Image,
  Loader2,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';

interface SimpleAROverlayProps {
  onClose: () => void;
}

export function SimpleAROverlay({ onClose }: SimpleAROverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelCreated, setModelCreated] = useState(false);
  const [visualizationMode, setVisualizationMode] = useState<'structure' | 'wireframe' | 'architectural'>('structure');
  const [wallHeight] = useState(2.7);
  const [controls, setControls] = useState({
    scale: 1,
    rotation: 0,
    positionY: 0
  });
  
  // Processing states
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [detectedWalls, setDetectedWalls] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentFloorPlan, setCurrentFloorPlan] = useState<any>(null);

  // Initialize camera
  useEffect(() => {
    initCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Create model when floor plan or settings change
  useEffect(() => {
    if (cameraReady && currentFloorPlan) {
      setModelCreated(true);
    }
  }, [cameraReady, currentFloorPlan, visualizationMode, wallHeight, controls]);

  const initCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;
        
        videoRef.current.onloadedmetadata = () => {
          setCameraReady(true);
        };
      }
    } catch (err) {
      console.error('Camera error:', err);
      setCameraError('Não foi possível acessar a câmera. Permita o acesso e tente novamente.');
    }
  }, []);

  // Process uploaded image or PDF
  const processImage = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setProcessingStatus('Processando arquivo...');

    try {
      // Convert file (PDF or image) to image data URL
      setProcessingStatus('Convertendo arquivo...');
      const imageDataUrl = await convertFileToImage(file);

      // Create image element
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const imgEl = document.createElement('img');
        imgEl.onload = () => resolve(imgEl);
        imgEl.onerror = () => reject(new Error('Falha ao carregar imagem'));
        imgEl.src = imageDataUrl;
      });

      setProcessingStatus('Detectando paredes...');
      
      // Detect floor plan
      const result = await floorPlanDetector.detect(img, 'ar-upload');
      
      if (result.success && result.floorPlan && result.floorPlan.walls && result.floorPlan.walls.length > 0) {
        setDetectedWalls(result.floorPlan.walls.length);
        setCurrentFloorPlan(result.floorPlan);
        setProcessingStatus('');
        setIsProcessing(false);
      } else {
        setError('Não foi possível detectar paredes. Use uma planta com linhas retas bem definidas.');
        setIsProcessing(false);
        setProcessingStatus('');
      }
    } catch (err) {
      console.error('Processing error:', err);
      setError('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
      setIsProcessing(false);
      setProcessingStatus('');
    }
  }, []);

  // Handle file selection
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
  }, [processImage]);

  const handleRestart = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setCameraReady(false);
    setModelCreated(false);
    setCurrentFloorPlan(null);
    setDetectedWalls(0);
    initCamera();
  }, [initCamera]);

  const loadDemo = useCallback(() => {
    // Create demo floor plan
    const demoFloorPlan = {
      id: 'demo-floorplan',
      scale: 100,
      origin: { x: 0, y: 0 },
      dimensions: { width: 5, height: 4 },
      bounds: { min: { x: 0, y: 0 }, max: { x: 5, y: 4 } },
      walls: [
        { id: 'w1', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, isExterior: true, openings: [] },
        { id: 'w2', start: { x: 5, y: 0 }, end: { x: 5, y: 4 }, thickness: 0.15, isExterior: true, openings: [] },
        { id: 'w3', start: { x: 5, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.15, isExterior: true, openings: [] },
        { id: 'w4', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.15, isExterior: true, openings: [] },
        { id: 'w5', start: { x: 2, y: 0 }, end: { x: 2, y: 2 }, thickness: 0.15, isExterior: false, openings: [] },
        { id: 'w6', start: { x: 2, y: 2 }, end: { x: 5, y: 2 }, thickness: 0.15, isExterior: false, openings: [] },
      ],
      doors: [
        { id: 'd1', type: 'door' as const, position: { x: 1, y: 0 }, width: 0.9, rotation: 0 }
      ],
      windows: [
        { id: 'wn1', type: 'window' as const, position: { x: 3.5, y: 4 }, width: 1.2, rotation: 0 }
      ],
      rooms: [
        { id: 'r1', name: 'Sala', type: 'living' as const, polygon: [], area: 10, walls: ['w1', 'w2', 'w6', 'w5'], center: { x: 2.5, y: 1 } },
        { id: 'r2', name: 'Quarto', type: 'bedroom' as const, polygon: [], area: 8, walls: ['w3', 'w4', 'w5', 'w6'], center: { x: 2.5, y: 3 } },
      ]
    };
    
    setCurrentFloorPlan(demoFloorPlan);
    setDetectedWalls(6);
    setModelCreated(true);
  }, []);

  // Create the 3D model from current floor plan
  const createModel = useCallback(() => {
    if (!currentFloorPlan) return null;

    const scaleConfig = { pixelsPerMeter: 100, isCalibrated: true };
    const coordSystem = { origin: { x: 0, y: 0 }, rotation: 0, flipX: false, flipY: false };
    
    reconstructionEngine.setWallHeight(wallHeight);
    const model3D = reconstructionEngine.reconstruct(currentFloorPlan, scaleConfig, coordSystem);

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
    
    // Apply controls
    mesh.scale.setScalar(controls.scale);
    mesh.rotation.y = controls.rotation * Math.PI / 180;
    mesh.position.y = controls.positionY;
    
    return mesh;
  }, [currentFloorPlan, visualizationMode, wallHeight, controls]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* CAMERA BACKGROUND */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        autoPlay
        muted
      />

      {/* 3D CANVAS OVERLAY */}
      <div className="absolute inset-0">
        <Canvas
          camera={{ position: [8, 8, 8], fov: 60 }}
          style={{ background: 'transparent' }}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 10, 5]} intensity={0.8} />
          
          {modelCreated && currentFloorPlan && (
            <primitive object={createModel()!} />
          )}
          
          <OrbitControls
            enableZoom={true}
            enablePan={true}
            enableRotate={true}
            minDistance={2}
            maxDistance={30}
          />
        </Canvas>
      </div>

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${cameraReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-white font-medium text-sm">
              {cameraReady ? '📷 Câmera + 3D' : '🟡 Iniciando...'}
            </span>
          </div>
          
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>

      {/* Processing Overlay */}
      {isProcessing && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-30">
          <Loader2 className="w-16 h-16 text-blue-400 animate-spin mb-4" />
          <p className="text-white text-lg">{processingStatus || 'Processando...'}</p>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-x-4 top-24 bg-red-500/90 rounded-xl p-4 z-30 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-white flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white font-medium">Erro</p>
            <p className="text-white/80 text-sm">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-white/60">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Detection Info */}
      {detectedWalls > 0 && !isProcessing && (
        <div className="absolute top-20 left-4 bg-black/60 rounded-xl p-3 z-10">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">{detectedWalls} paredes detectadas</span>
          </div>
        </div>
      )}

      {/* Instructions */}
      {cameraReady && !currentFloorPlan && !isProcessing && (
        <div className="absolute top-20 left-4 right-4 z-10">
          <div className="bg-black/60 rounded-xl p-4">
            <p className="text-white/80 text-sm text-center mb-4">
              👆 Arraste para rotacionar • Pinch para zoom
            </p>
            
            {/* Upload Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-4 bg-blue-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:bg-blue-500 transition-colors"
            >
              <Upload className="w-5 h-5" />
              <span>Carregar Planta</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <p className="text-slate-400 text-xs text-center mt-2">
              Formatos: PNG, JPG, PDF
            </p>
            
            {/* Demo Button */}
            <button
              onClick={loadDemo}
              className="w-full mt-3 py-3 px-4 bg-green-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:bg-green-500 transition-colors"
            >
              <CheckCircle className="w-5 h-5" />
              <span>Ver Demo</span>
            </button>
          </div>
        </div>
      )}

      {/* Camera Error */}
      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/90 p-6">
          <Camera className="w-16 h-16 text-red-400 mb-4" />
          <p className="text-red-400 text-center mb-4">{cameraError}</p>
          <button
            onClick={handleRestart}
            className="px-6 py-3 bg-blue-600 rounded-xl text-white font-bold"
          >
            Tentar Novamente
          </button>
        </div>
      )}

      {/* Visualization Mode Selector */}
      <div className="absolute bottom-32 left-4 right-4 z-10">
        <div className="flex justify-center gap-2">
          {[
            { mode: 'wireframe' as const, icon: Layers, label: 'Wire' },
            { mode: 'structure' as const, icon: Box, label: 'Estrutura' },
            { mode: 'architectural' as const, icon: Eye, label: 'Visual' },
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
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent z-10">
        {/* Quick Controls */}
        <div className="flex justify-center gap-2 mb-4">
          <button
            onClick={() => setControls(c => ({ ...c, scale: Math.min(c.scale + 0.2, 3) }))}
            className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white hover:bg-white/30"
            title="Aumentar"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={() => setControls(c => ({ ...c, scale: Math.max(c.scale - 0.2, 0.2) }))}
            className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white hover:bg-white/30"
            title="Diminuir"
          >
            <ZoomIn className="w-5 h-5 rotate-180" />
          </button>
          <button
            onClick={() => setControls(c => ({ ...c, rotation: c.rotation + 45 }))}
            className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white hover:bg-white/30"
            title="Rotacionar 45°"
          >
            <RotateCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white hover:bg-blue-500"
            title="Carregar planta"
          >
            <Image className="w-5 h-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleRestart}
            className="flex items-center gap-2 px-4 py-3 bg-white/20 rounded-xl text-white"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Reiniciar</span>
          </button>
          
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 rounded-xl text-white font-bold"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
