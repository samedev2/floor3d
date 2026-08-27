import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { 
  Pin, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut,
  Check,
  Camera,
  CameraOff,
  Image,
  Smartphone,
  Layers,
  Grid3x3,
  Move
} from 'lucide-react';
import type { Wall, Room, Point, Opening } from '../lib/shared';

interface ARState {
  isScanning: boolean;
  targetFound: boolean;
  tracking: 'none' | 'limited' | 'normal';
}

export function ARPanel() {
  const { 
    processedPlan, 
    capturedImage,
    arScale, 
    setArScale,
    arPinned,
    setArPinned,
    arPosition,
    setArPosition,
  } = useStore();

  const [viewMode, setViewMode] = useState<'perspective' | 'top' | 'front'>('perspective');
  const [cameraActive, setCameraActive] = useState(false);
  const [arState, setArState] = useState<ARState>({
    isScanning: false,
    targetFound: false,
    tracking: 'none'
  });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Calculate center of floor plan
  const { centerX, centerZ } = useMemo(() => {
    let cx = 0, cz = 0;
    if (processedPlan?.walls && processedPlan.walls.length > 0) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      processedPlan.walls.forEach((wall: Wall) => {
        minX = Math.min(minX, wall.startPoint.x, wall.endPoint.x);
        maxX = Math.max(maxX, wall.startPoint.x, wall.endPoint.x);
        minZ = Math.min(minZ, wall.startPoint.y, wall.endPoint.y);
        maxZ = Math.max(maxZ, wall.startPoint.y, wall.endPoint.y);
      });
      cx = (minX + maxX) / 2;
      cz = (minZ + maxZ) / 2;
    }
    return { centerX: cx, centerZ: cz };
  }, [processedPlan]);

  // Start AR with camera
  const startAR = useCallback(async () => {
    if (!capturedImage && !processedPlan) {
      console.error('No image or plan available');
      return;
    }

    try {
      setArState(prev => ({ ...prev, isScanning: true }));
      
      // Start camera stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment', 
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
      setArState(prev => ({ 
        ...prev, 
        isScanning: false, 
        targetFound: true,
        tracking: 'normal'
      }));
      
    } catch (err) {
      console.error('AR start error:', err);
      setArState(prev => ({ ...prev, isScanning: false }));
    }
  }, [capturedImage, processedPlan]);

  // Stop AR
  const stopAR = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    
    setCameraActive(false);
    setArState({ isScanning: false, targetFound: false, tracking: 'none' });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAR();
    };
  }, [stopAR]);

  // Pin/Unpin
  const handlePin = useCallback(() => {
    setArPinned(true);
  }, [setArPinned]);

  const handleUnpin = useCallback(() => {
    setArPinned(false);
  }, [setArPinned]);

  // Reset
  const handleReset = useCallback(() => {
    setArScale(1);
    setArPosition({ x: 0, y: 0 });
  }, [setArScale, setArPosition]);

  if (!processedPlan) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-5xl mb-4">📱</div>
          <h3 className="text-lg font-semibold mb-2">Nenhuma planta carregada</h3>
          <p className="text-slate-400">
            Carregue uma planta primeiro para visualizar em AR
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden">
      {/* AR Video Background */}
      {cameraActive ? (
        <div className="absolute inset-0 z-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/20" />
        </div>
      ) : capturedImage ? (
        <div className="absolute inset-0 z-0">
          <img 
            src={capturedImage} 
            alt="Captured floor plan"
            className="w-full h-full object-contain opacity-50"
          />
        </div>
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center">
          <div className="text-center">
            <Image className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Toque em "Iniciar AR" para começar</p>
          </div>
        </div>
      )}

      {/* AR Indicator */}
      {arState.isScanning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white">Procurando planta...</p>
          </div>
        </div>
      )}

      {/* 3D Canvas Overlay */}
      <div className="absolute inset-0 z-10">
        <Canvas
          shadows
          gl={{ antialias: true, alpha: true }}
          style={{ width: '100%', height: '100%' }}
        >
          <PerspectiveCamera
            makeDefault
            position={viewMode === 'top' 
              ? [centerX, 150, centerZ] 
              : viewMode === 'front'
              ? [centerX, 60, centerZ + 150]
              : [centerX, 80, centerZ + 120]
            }
            fov={viewMode === 'top' ? 60 : 100}
            near={0.1}
            far={2000}
          />
          
          {/* Lighting */}
          <ambientLight intensity={0.7} />
          <directionalLight 
            position={[50, 100, 50]} 
            intensity={1.2} 
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          
          {/* 3D Floor Plan Model */}
          <FloorPlan3D 
            plan={processedPlan} 
            scale={arScale}
            centerX={centerX}
            centerZ={centerZ}
            offsetX={arPosition.x}
            offsetY={arPosition.y}
            isPinned={arPinned}
            arActive={cameraActive}
          />
          
          {/* AR Anchor Point Indicator */}
          {cameraActive && arState.targetFound && (
            <ARAnchorIndicator 
              centerX={centerX} 
              centerZ={centerZ}
              scale={arScale}
            />
          )}
        </Canvas>
      </div>

      {/* AR Start/Stop Button */}
      <button
        onClick={cameraActive ? stopAR : startAR}
        className={`absolute z-30 p-4 rounded-full transition-all shadow-lg ${
          cameraActive 
            ? 'bg-red-500 hover:bg-red-600' 
            : 'bg-primary hover:bg-primary/80'
        }`}
        style={{ 
          left: '50%', 
          transform: 'translateX(-50%)',
          bottom: '140px'
        }}
      >
        {cameraActive ? (
          <div className="flex items-center gap-2 text-white">
            <CameraOff className="w-5 h-5" />
            <span>Parar AR</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-white">
            <Camera className="w-5 h-5" />
            <span>Iniciar AR</span>
          </div>
        )}
      </button>

      {/* View Mode Selector */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        <button
          onClick={() => setViewMode('perspective')}
          className={`p-3 rounded-xl transition-all ${
            viewMode === 'perspective' 
              ? 'bg-primary text-white' 
              : 'bg-surface/80 text-slate-400 hover:text-white'
          }`}
          title="Perspectiva 3D"
        >
          <Grid3x3 className="w-5 h-5" />
        </button>
        <button
          onClick={() => setViewMode('top')}
          className={`p-3 rounded-xl transition-all ${
            viewMode === 'top' 
              ? 'bg-primary text-white' 
              : 'bg-surface/80 text-slate-400 hover:text-white'
          }`}
          title="Vista de Cima"
        >
          <Layers className="w-5 h-5" />
        </button>
        <button
          onClick={() => setViewMode('front')}
          className={`p-3 rounded-xl transition-all ${
            viewMode === 'front' 
              ? 'bg-primary text-white' 
              : 'bg-surface/80 text-slate-400 hover:text-white'
          }`}
          title="Vista Frontal"
        >
          <Smartphone className="w-5 h-5" />
        </button>
      </div>

      {/* Scale Controls */}
      <div className="absolute top-4 right-4 glass rounded-xl p-3 min-w-[180px] z-20">
        <div className="flex items-center gap-2">
          <ZoomOut className="w-4 h-4 text-slate-400" />
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.05"
            value={arScale}
            onChange={(e) => !arPinned && setArScale(parseFloat(e.target.value))}
            disabled={arPinned}
            className="flex-1 accent-primary"
          />
          <ZoomIn className="w-4 h-4 text-slate-400" />
        </div>
        <div className="text-center text-sm text-white mt-1">
          {Math.round(arScale * 100)}%
        </div>
      </div>

      {/* Position Controls (when pinned) */}
      {arPinned && (
        <div className="absolute right-4 top-36 glass rounded-xl p-3 z-20">
          <div className="grid grid-cols-3 gap-1 mb-2">
            <div />
            <button
              onClick={() => setArPosition({ x: arPosition.x, y: arPosition.y - 1 })}
              className="p-2 bg-slate-700/50 rounded hover:bg-slate-600/50 text-white"
            >
              ↑
            </button>
            <div />
            <button
              onClick={() => setArPosition({ x: arPosition.x - 1, y: arPosition.y })}
              className="p-2 bg-slate-700/50 rounded hover:bg-slate-600/50 text-white"
            >
              ←
            </button>
            <div className="p-2 bg-slate-800/50 rounded flex items-center justify-center">
              <Move className="w-4 h-4 text-slate-400" />
            </div>
            <button
              onClick={() => setArPosition({ x: arPosition.x + 1, y: arPosition.y })}
              className="p-2 bg-slate-700/50 rounded hover:bg-slate-600/50 text-white"
            >
              →
            </button>
            <div />
            <button
              onClick={() => setArPosition({ x: arPosition.x, y: arPosition.y + 1 })}
              className="p-2 bg-slate-700/50 rounded hover:bg-slate-600/50 text-white"
            >
              ↓
            </button>
            <div />
          </div>
          <p className="text-xs text-slate-400 text-center">Ajustar posição</p>
        </div>
      )}

      {/* Pinned Indicator */}
      {arPinned && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-accent/90 rounded-full px-4 py-2 z-20">
          <Check className="w-4 h-4 text-white" />
          <span className="text-white font-medium text-sm">Modelo Fixado</span>
        </div>
      )}

      {/* Tracking Status */}
      {cameraActive && (
        <div className="absolute top-20 right-4 glass rounded-lg px-3 py-1 z-20">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              arState.tracking === 'normal' ? 'bg-green-500' :
              arState.tracking === 'limited' ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
            <span className="text-xs text-white">
              {arState.tracking === 'normal' ? 'Rastreando' :
               arState.tracking === 'limited' ? 'Rastreamento limitado' : 'Sem rastreamento'}
            </span>
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="absolute bottom-6 left-4 right-4 z-20">
        <div className="flex justify-center items-center gap-4 mb-4">
          <button
            onClick={handleReset}
            className="p-4 rounded-full bg-surface/80 text-slate-400 hover:text-white transition-all"
            title="Resetar"
          >
            <RotateCcw className="w-6 h-6" />
          </button>

          {arPinned ? (
            <button
              onClick={handleUnpin}
              className="flex items-center gap-2 bg-accent hover:bg-accent/80 text-white px-6 py-4 rounded-full transition-all shadow-lg"
            >
              <span className="text-xl">📌</span>
              <span className="font-medium">Desafixar</span>
            </button>
          ) : (
            <button
              onClick={handlePin}
              className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-white px-6 py-4 rounded-full transition-all shadow-lg"
            >
              <Pin className="w-5 h-5" />
              <span className="font-medium">PIN para Fixar</span>
            </button>
          )}
        </div>

        <div className="glass rounded-xl p-3 text-center">
          <p className="text-sm text-slate-300">
            {cameraActive 
              ? '📷 AR ativo - Modelo sobreposto à planta'
              : 'Toque "Iniciar AR" para sobrepor o modelo 3D'}
          </p>
        </div>
      </div>
    </div>
  );
}

// AR Anchor Indicator
function ARAnchorIndicator({ centerX, centerZ, scale }: { centerX: number; centerZ: number; scale: number }) {
  const ref = useRef<THREE.Group>(null);
  
  useFrame(({ clock }) => {
    if (ref.current) {
      // Subtle pulsing animation
      const t = clock.getElapsedTime();
      ref.current.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
    }
  });

  return (
    <group ref={ref} position={[centerX, 0.01, centerZ]}>
      {/* Anchor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5 * scale, 0.6 * scale, 32]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Center dot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.1 * scale, 16]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
    </group>
  );
}

// Full 3D Floor Plan Model with Extrusion
function FloorPlan3D({ 
  plan, 
  scale,
  centerX,
  centerZ,
  offsetX = 0,
  offsetY = 0,
  isPinned = false,
  arActive = false
}: { 
  plan: any; 
  scale: number;
  centerX: number;
  centerZ: number;
  offsetX?: number;
  offsetY?: number;
  isPinned?: boolean;
  arActive?: boolean;
}) {
  const WALL_HEIGHT = 2.8;
  const WALL_THICKNESS = 0.15;
  
  // Colors
  const wallColors: Record<string, string> = {
    exterior: '#4A5568',
    interior: '#718096',
    partition: '#A0AEC0',
  };

  const roomColors: Record<string, string> = {
    living: '#3B82F6',
    bedroom: '#8B5CF6',
    kitchen: '#F59E0B',
    bathroom: '#06B6D4',
    dining: '#10B981',
    office: '#6366F1',
    garage: '#78716C',
    utility: '#71717A',
    unknown: '#64748B',
  };

  // Create room shape from polygon
  const createRoomShape = (polygon: Point[]): THREE.Shape => {
    const shape = new THREE.Shape();
    if (!polygon || polygon.length < 3) return shape;
    
    shape.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x, polygon[i].y);
    }
    shape.closePath();
    return shape;
  };

  // Calculate wall rotation
  const getWallRotation = (wall: Wall) => {
    const start = new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y);
    const end = new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y);
    const direction = new THREE.Vector3().subVectors(end, start);
    if (direction.length() < 0.01) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      direction.normalize()
    );
  };

  // Apply offset for pinned mode
  const modelOffset = isPinned ? { x: offsetX, z: offsetY } : { x: 0, z: 0 };

  return (
    <group 
      position={[modelOffset.x, 0, modelOffset.z]}
      scale={[scale, scale, scale]}
    >
      {/* Floor base */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[centerX, 0, centerZ]} 
        receiveShadow
      >
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial 
          color="#1E293B" 
          opacity={arActive ? 0.1 : 0.4} 
          transparent 
        />
      </mesh>

      {/* Room floors with proper shapes */}
      {plan.rooms && plan.rooms.map((room: Room, index: number) => {
        if (!room.polygon || room.polygon.length < 3) return null;

        let cx = 0, cz = 0;
        room.polygon.forEach((p: Point) => { cx += p.x; cz += p.y; });
        cx /= room.polygon.length;
        cz /= room.polygon.length;

        const shape = createRoomShape(room.polygon);
        const roomColor = roomColors[room.type] || roomColors.unknown;

        return (
          <group key={`room-${index}`}>
            {/* Room floor */}
            <mesh
              position={[0, 0.005, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
            >
              <shapeGeometry args={[shape]} />
              <meshStandardMaterial
                color={roomColor}
                opacity={arActive ? 0.3 : 0.5}
                transparent
                side={THREE.DoubleSide}
              />
            </mesh>
            
            {/* Room label */}
            <Html
              position={[cx, 0.5, cz]}
              center
              style={{
                color: '#fff',
                fontSize: '11px',
                fontWeight: 'bold',
                textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              {room.name || room.type.toUpperCase()}
            </Html>
          </group>
        );
      })}

      {/* Walls with 3D height */}
      {plan.walls && plan.walls.map((wall: Wall, index: number) => {
        const start = new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y);
        const end = new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y);
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        const wallHeight = wall.height || WALL_HEIGHT;
        const wallThickness = Math.max(wall.thickness, WALL_THICKNESS) / 10;
        
        const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        center.y = wallHeight / 2;

        const quaternion = getWallRotation(wall);

        return (
          <mesh
            key={`wall-${index}`}
            position={center}
            quaternion={quaternion}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[length, wallHeight, wallThickness]} />
            <meshStandardMaterial
              color={wallColors[wall.type] || wallColors.interior}
              roughness={0.8}
              metalness={0.1}
              transparent={arActive}
              opacity={arActive ? 0.85 : 1}
            />
          </mesh>
        );
      })}

      {/* Doors */}
      {plan.openings && plan.openings.filter((o: Opening) => o.type === 'door').map((opening: Opening, index: number) => {
        const wall = plan.walls.find((w: Wall) => w.id === opening.wallId);
        if (!wall) return null;
        
        const doorWidth = opening.width || 0.9;
        const doorHeight = opening.height || 2.1;
        
        const dir = new THREE.Vector3().subVectors(
          new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y),
          new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y)
        ).normalize();
        
        const doorPos = new THREE.Vector3(
          opening.position.x,
          doorHeight / 2,
          opening.position.y
        );
        
        const rotation = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          dir
        );

        return (
          <group key={`door-${index}`} position={doorPos} quaternion={rotation}>
            <mesh castShadow>
              <boxGeometry args={[doorWidth + 0.1, 0.1, 0.2]} />
              <meshStandardMaterial color="#8B4513" roughness={0.9} />
            </mesh>
            <mesh position={[doorWidth/2 - 0.05, doorHeight/2 - 0.1, 0]} castShadow>
              <boxGeometry args={[doorWidth - 0.1, doorHeight - 0.2, 0.05]} />
              <meshStandardMaterial color="#A0522D" roughness={0.7} />
            </mesh>
          </group>
        );
      })}

      {/* Windows */}
      {plan.openings && plan.openings.filter((o: Opening) => o.type === 'window').map((opening: Opening, index: number) => {
        const wall = plan.walls.find((w: Wall) => w.id === opening.wallId);
        if (!wall) return null;
        
        const windowWidth = opening.width || 1.2;
        const windowHeight = opening.height || 1.2;
        
        const dir = new THREE.Vector3().subVectors(
          new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y),
          new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y)
        ).normalize();
        
        const windowPos = new THREE.Vector3(
          opening.position.x,
          windowHeight,
          opening.position.y
        );
        
        const rotation = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          dir
        );

        return (
          <group key={`window-${index}`} position={windowPos} quaternion={rotation}>
            <mesh castShadow>
              <boxGeometry args={[windowWidth + 0.1, 0.1, 0.2]} />
              <meshStandardMaterial color="#4A5568" roughness={0.5} metalness={0.3} />
            </mesh>
            <mesh>
              <boxGeometry args={[windowWidth, windowHeight, 0.02]} />
              <meshStandardMaterial 
                color="#87CEEB" 
                opacity={arActive ? 0.3 : 0.4} 
                transparent 
                roughness={0.1}
                metalness={0.9}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
