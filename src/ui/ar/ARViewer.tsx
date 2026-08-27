import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import ARjs from 'ar.js';
import { reconstructionEngine } from '../../geometry/reconstruction';
import { 
  RefreshCw, 
  ZoomIn, 
  RotateCw,
  X,
  Layers,
  Box,
  Eye,
  Settings
} from 'lucide-react';

interface ARViewerProps {
  imageData?: string; // Optional: if provided, use this floor plan
  onClose: () => void;
}

export function ARViewer({ imageData, onClose }: ARViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const arSessionRef = useRef<any>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<'initializing' | 'tracking' | 'lost'>('initializing');
  const [visualizationMode, setVisualizationMode] = useState<'structure' | 'wireframe' | 'architectural'>('structure');
  const [controls, setControls] = useState({
    position: { x: 0, y: 0, z: 0 },
    scale: 1,
    rotation: 0
  });
  const [showCalibration, setShowCalibration] = useState(false);
  const [wallHeight, setWallHeight] = useState(2.7);

  // Initialize AR scene
  useEffect(() => {
    if (!containerRef.current) return;

    initAR();

    return () => {
      cleanup();
    };
  }, []);

  // Create 3D model when image changes
  useEffect(() => {
    if (sceneRef.current && imageData) {
      createModelFromFloorPlan();
    }
  }, [imageData, visualizationMode, wallHeight]);

  const initAR = useCallback(() => {
    setIsLoading(true);
    setError(null);

    try {
      // Create scene
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      // Create camera
      const camera = new THREE.Camera();
      cameraRef.current = camera;
      scene.add(camera);

      // Create renderer with transparent background
      const renderer = new THREE.WebGLRenderer({ 
        alpha: true,
        antialias: true
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setClearColor(0x000000, 0);
      containerRef.current?.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(10, 10, 5);
      scene.add(directionalLight);

      // Initialize AR.js with camera
      const arSession = ARjs({
        sourceType: 'webcam',
        debug: true,
        engine: 'aframe',
        cameraParametersStr: 'camera_para.dat',
        detectionMode: 'mono',
        matrixCodeType: '3x3',
        maxThreeT: 0.8,
        smoothing: true,
        imagePersistence: 'yes',
        enableTransition: true,
        transitionType: 'ease',
        uiScanning: 'yes',
        uiError: 'yes',
      });

      arSessionRef.current = arSession;

      // Set up marker-based OR markerless mode
      // For floor plan AR, we'll use image tracking if available
      // Otherwise use ground plane detection
      
      // Create marker (Hiro marker for testing)
      const markerGroup = new THREE.Group();
      markerGroup.name = 'marker';
      
      // Add ground plane grid for reference
      const gridHelper = new THREE.GridHelper(10, 10, 0xff0000, 0x333333);
      markerGroup.add(gridHelper);
      
      // Add floor plane
      const floorGeometry = new THREE.PlaneGeometry(10, 10);
      const floorMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x00ff00, 
        opacity: 0.2, 
        transparent: true,
        side: THREE.DoubleSide
      });
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.01;
      markerGroup.add(floor);

      scene.add(markerGroup);

      // Store marker reference
      (scene as any).marker = markerGroup;

      // Animation loop
      const animate = () => {
        requestAnimationFrame(animate);
        
        // Update AR
        if (arSession.scene !== undefined) {
          renderer.clear();
          renderer.render(scene, camera);
        }
      };
      animate();

      setIsLoading(false);
      setTrackingStatus('tracking');

      // Handle resize
      const handleResize = () => {
        if (containerRef.current) {
          renderer.setSize(window.innerWidth, window.innerHeight);
        }
      };
      window.addEventListener('resize', handleResize);

    } catch (err) {
      console.error('AR init error:', err);
      setError('Erro ao inicializar AR. Verifique se a câmera está permitida.');
      setIsLoading(false);
    }
  }, []);

  const createModelFromFloorPlan = useCallback(async () => {
    if (!sceneRef.current) return;

    try {
      // Remove existing model
      if (modelRef.current) {
        sceneRef.current.remove(modelRef.current);
        modelRef.current = null;
      }

      // Create demo floor plan if no image
      const floorPlan = {
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

      // Create 3D model
      const scaleConfig = { pixelsPerMeter: 100, isCalibrated: true };
      const coordSystem = { origin: { x: 0, y: 0 }, rotation: 0, flipX: false, flipY: false };
      
      reconstructionEngine.setWallHeight(wallHeight);
      const model3D = reconstructionEngine.reconstruct(floorPlan, scaleConfig, coordSystem);

      // Create Three.js meshes
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
      
      // Position model above ground plane
      mesh.position.y = 0;
      mesh.scale.set(controls.scale, controls.scale, controls.scale);
      mesh.rotation.y = controls.rotation * Math.PI / 180;
      
      modelRef.current = mesh;
      
      if (sceneRef.current) {
        // Find marker group or create one
        let markerGroup = (sceneRef.current as any).marker;
        if (!markerGroup) {
          markerGroup = new THREE.Group();
          markerGroup.name = 'marker';
          sceneRef.current.add(markerGroup);
          (sceneRef.current as any).marker = markerGroup;
        }
        markerGroup.add(mesh);
      }

    } catch (err) {
      console.error('Model creation error:', err);
    }
  }, [visualizationMode, wallHeight, controls]);

  const cleanup = useCallback(() => {
    if (arSessionRef.current) {
      try {
        arSessionRef.current.stop();
      } catch (e) {}
    }
    if (rendererRef.current && containerRef.current) {
      containerRef.current.removeChild(rendererRef.current.domElement);
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
    }
  }, []);

  const handleRestart = useCallback(() => {
    cleanup();
    initAR();
  }, [cleanup, initAR]);

  // Update model transforms
  const updateModelTransform = useCallback(() => {
    if (modelRef.current) {
      modelRef.current.position.set(controls.position.x, controls.position.y, controls.position.z);
      modelRef.current.scale.setScalar(controls.scale);
      modelRef.current.rotation.y = controls.rotation * Math.PI / 180;
    }
  }, [controls]);

  useEffect(() => {
    updateModelTransform();
  }, [controls, updateModelTransform]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* AR Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20">
          <div className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-white text-lg">Inicializando AR...</p>
          <p className="text-slate-400 text-sm mt-2">Permita o acesso à câmera</p>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20 p-6">
          <p className="text-red-400 text-lg mb-4">{error}</p>
          <button
            onClick={handleRestart}
            className="px-6 py-3 bg-blue-600 rounded-xl text-white font-bold"
          >
            Tentar Novamente
          </button>
        </div>
      )}

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              trackingStatus === 'tracking' ? 'bg-green-500 animate-pulse' :
              trackingStatus === 'lost' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
            }`} />
            <span className="text-white font-medium text-sm">
              {trackingStatus === 'tracking' ? '🟢 RA Ativo' :
               trackingStatus === 'lost' ? '🔴Tracking Perdido' : '🟡 Iniciando...'}
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

      {/* Instructions */}
      <div className="absolute top-20 left-4 right-4 z-10">
        <div className="bg-black/60 rounded-xl p-3 text-center">
          <p className="text-white/80 text-sm">
            {trackingStatus === 'tracking' 
              ? '👆 Toque e segure para posicionar o modelo'
              : '📷 Aponte a câmera para uma superfície plana'}
          </p>
        </div>
      </div>

      {/* Controls Panel */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-2xl p-3 space-y-2">
          <button
            onClick={() => setControls(c => ({ ...c, scale: Math.min(c.scale + 0.1, 3) }))}
            className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20"
            title="Aumentar"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={() => setControls(c => ({ ...c, scale: Math.max(c.scale - 0.1, 0.2) }))}
            className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20"
            title="Diminuir"
          >
            <ZoomIn className="w-5 h-5 rotate-180" />
          </button>
          <button
            onClick={() => setControls(c => ({ ...c, rotation: c.rotation + 15 }))}
            className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20"
            title="Rotacionar"
          >
            <RotateCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowCalibration(true)}
            className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20"
            title="Calibrar"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

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

      {/* Bottom Actions */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent z-10">
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
                <p className="text-white text-center">{(controls.scale * 100).toFixed(0)}%</p>
              </div>
            </div>
            
            <button
              onClick={() => setShowCalibration(false)}
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
