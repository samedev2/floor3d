import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { ProcessedFloorPlan, Wall, Room, Opening } from '../lib/shared';

const WALL_HEIGHT = 2.8;

export type VisualizationMode = 'structure' | 'wireframe' | 'blueprint' | 'architectural' | 'bim';

interface VisualizationModesProps {
  plan: ProcessedFloorPlan;
  mode: VisualizationMode;
  onModeChange?: (mode: VisualizationMode) => void;
}

export function VisualizationModes({ plan, mode }: VisualizationModesProps) {
  // Calculate center
  const { centerX, centerZ } = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (plan.walls && plan.walls.length > 0) {
      plan.walls.forEach((wall: Wall) => {
        minX = Math.min(minX, wall.startPoint.x, wall.endPoint.x);
        maxX = Math.max(maxX, wall.startPoint.x, wall.endPoint.x);
        minZ = Math.min(minZ, wall.startPoint.y, wall.endPoint.y);
        maxZ = Math.max(maxZ, wall.startPoint.y, wall.endPoint.y);
      });
    }
    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
    };
  }, [plan]);

  return (
    <div className="flex-1 relative">
      <Canvas
        shadows
        gl={{ antialias: true, alpha: mode === 'blueprint' }}
        style={{ width: '100%', height: '100%' }}
      >
        <PerspectiveCamera
          makeDefault
          position={[centerX, 80, centerZ + 120]}
          fov={100}
          near={0.1}
          far={2000}
        />
        
        {/* Lighting based on mode */}
        {mode === 'blueprint' ? (
          <>
            <ambientLight intensity={1.2} />
            <directionalLight position={[50, 100, 50]} intensity={0.3} />
          </>
        ) : (
          <>
            <ambientLight intensity={0.5} />
            <directionalLight 
              position={[50, 100, 50]} 
              intensity={1} 
              castShadow
              shadow-mapSize={[2048, 2048]}
            />
            <directionalLight 
              position={[-30, 60, -30]} 
              intensity={0.4} 
            />
          </>
        )}
        
        {/* Scene content */}
        <FloorPlanScene plan={plan} mode={mode} centerX={centerX} centerZ={centerZ} />
        
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.05}
          target={[centerX, 0, centerZ]}
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 1.8}
          minDistance={10}
          maxDistance={300}
          enablePan
          panSpeed={0.8}
        />
        
        <CameraFit plan={plan} />
      </Canvas>
      
      {/* Mode indicator */}
      <div className="absolute top-4 left-4 glass rounded-lg px-3 py-2">
        <p className="text-white text-sm font-medium">
          {getModeLabel(mode)}
        </p>
      </div>
      
      <div className="absolute bottom-4 left-4 glass rounded-lg px-3 py-2 text-xs">
        <p className="text-slate-400">Arraste para rotacionar • Pinça para zoom</p>
      </div>
    </div>
  );
}

function getModeLabel(mode: VisualizationMode): string {
  switch (mode) {
    case 'structure': return '🎨 Estrutura';
    case 'wireframe': return '📐 Wireframe';
    case 'blueprint': return '🗺️ Blueprint';
    case 'architectural': return '🏛️ Arquitetônico';
    case 'bim': return '📊 BIM';
    default: return mode;
  }
}

// Floor Plan Scene with multiple visualization modes
function FloorPlanScene({ plan, mode, centerX, centerZ }: { 
  plan: ProcessedFloorPlan; 
  mode: VisualizationMode;
  centerX: number;
  centerZ: number;
}) {
  // Mode-specific colors
  const colors = useMemo(() => {
    switch (mode) {
      case 'blueprint':
        return {
          wall: '#0066FF',
          floor: '#E6F0FF',
          ceiling: '#FFFFFF',
          door: '#FF6600',
          window: '#00AAFF',
          background: '#1a2a4a',
          text: '#FFFFFF',
          accent: '#00FF88',
        };
      case 'wireframe':
        return {
          wall: '#FFFFFF',
          floor: '#333333',
          ceiling: '#444444',
          door: '#FFFFFF',
          window: '#FFFFFF',
          background: '#000000',
          text: '#FFFFFF',
          accent: '#00FF00',
        };
      case 'architectural':
        return {
          wall: '#2D3748',
          floor: '#8B7355',
          ceiling: '#FFFFFF',
          door: '#8B4513',
          window: '#87CEEB',
          background: '#1a1a1a',
          text: '#FFFFFF',
          accent: '#FFD700',
        };
      case 'bim':
        return {
          wall: '#4A5568',
          floor: '#48BB78',
          ceiling: '#E2E8F0',
          door: '#F6AD55',
          window: '#63B3ED',
          background: '#0D1117',
          text: '#58A6FF',
          accent: '#7EE787',
        };
      default: // structure
        return {
          wall: '#4A5568',
          floor: '#8B7355',
          ceiling: '#FFFFFF',
          door: '#8B4513',
          window: '#87CEEB',
          background: '#1E293B',
          text: '#FFFFFF',
          accent: '#3B82F6',
        };
    }
  }, [mode]);

  const wallColors = {
    exterior: colors.wall,
    interior: mode === 'blueprint' ? '#0044AA' : '#718096',
    partition: mode === 'blueprint' ? '#002266' : '#A0AEC0',
  };

  const roomColors = useMemo(() => {
    const base: Record<string, string> = {
      living: mode === 'blueprint' ? '#0066FF' : '#3B82F6',
      bedroom: mode === 'blueprint' ? '#00CCFF' : '#8B5CF6',
      kitchen: mode === 'blueprint' ? '#FF6600' : '#F59E0B',
      bathroom: mode === 'blueprint' ? '#00FFFF' : '#06B6D4',
      dining: mode === 'blueprint' ? '#00FF88' : '#10B981',
      office: mode === 'blueprint' ? '#6600FF' : '#6366F1',
      garage: mode === 'blueprint' ? '#666666' : '#78716C',
      utility: mode === 'blueprint' ? '#333333' : '#71717A',
      unknown: mode === 'blueprint' ? '#0044AA' : '#64748B',
    };
    return base;
  }, [mode]);

  // Create room shape
  const createRoomShape = (polygon: { x: number; y: number }[]): THREE.Shape => {
    const shape = new THREE.Shape();
    if (polygon.length < 3) return shape;
    
    shape.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x, polygon[i].y);
    }
    shape.closePath();
    return shape;
  };

  return (
    <group>
      {/* Background plane for blueprint mode */}
      {mode === 'blueprint' && (
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[centerX, -0.02, centerZ]} 
          receiveShadow={false}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial color={colors.background} />
        </mesh>
      )}

      {/* Grid for blueprint mode */}
      {mode === 'blueprint' && (
        <gridHelper 
          args={[200, 40, colors.accent, '#1a2a4a']} 
          position={[centerX, 0, centerZ]}
        />
      )}

      {/* Base floor */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[centerX, -0.01, centerZ]} 
        receiveShadow={mode !== 'blueprint'}
      >
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial 
          color={mode === 'wireframe' ? '#111111' : colors.floor}
          opacity={mode === 'blueprint' ? 0.1 : mode === 'wireframe' ? 0.5 : 0.5}
          transparent={mode === 'blueprint' || mode === 'wireframe'}
          wireframe={mode === 'wireframe'}
        />
      </mesh>

      {/* Room floors */}
      {plan.rooms && plan.rooms.map((room: Room, index: number) => {
        if (!room.polygon || room.polygon.length < 3) return null;

        const shape = createRoomShape(room.polygon);
        const roomColor = roomColors[room.type] || roomColors.unknown;
        
        return (
          <group key={`room-${index}`}>
            {/* Room floor */}
            <mesh
              position={[0, 0.005, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow={mode !== 'blueprint'}
            >
              <shapeGeometry args={[shape]} />
              <meshStandardMaterial
                color={roomColor}
                opacity={mode === 'blueprint' ? 0.15 : mode === 'wireframe' ? 0.2 : 0.4}
                transparent
                wireframe={mode === 'wireframe'}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* Room outline for blueprint */}
            {mode === 'blueprint' && (
              <lineSegments position={[0, 0.01, 0]}>
                <edgesGeometry args={[new THREE.ShapeGeometry(shape)]} />
                <lineBasicMaterial color={roomColor} linewidth={2} />
              </lineSegments>
            )}
          </group>
        );
      })}

      {/* Walls */}
      {plan.walls && plan.walls.map((wall: Wall, index: number) => {
        const start = new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y);
        const end = new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y);
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        const wallHeight = wall.height || WALL_HEIGHT;
        const wallThickness = Math.max(wall.thickness, 0.15);
        
        const center = new THREE.Vector3(
          (wall.startPoint.x + wall.endPoint.x) / 2,
          wallHeight / 2,
          (wall.startPoint.y + wall.endPoint.y) / 2
        );

        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          direction.normalize()
        );

        const isWireframe = mode === 'wireframe';
        const isBlueprint = mode === 'blueprint';

        return (
          <mesh
            key={`wall-${index}`}
            position={center}
            quaternion={quaternion}
            castShadow={!isWireframe && !isBlueprint}
            receiveShadow={!isWireframe && !isBlueprint}
          >
            <boxGeometry args={[length, wallHeight, wallThickness]} />
            <meshStandardMaterial
              color={wallColors[wall.type] || wallColors.interior}
              transparent={isBlueprint}
              opacity={isBlueprint ? 0.8 : 1}
              wireframe={isWireframe}
              roughness={isWireframe ? 0 : 0.8}
              metalness={isWireframe ? 0 : 0.1}
            />
          </mesh>
        );
      })}

      {/* Doors */}
      {plan.openings && plan.openings.filter(o => o.type === 'door').map((opening: Opening, index: number) => {
        const wall = plan.walls.find(w => w.id === opening.wallId);
        if (!wall) return null;
        
        const doorWidth = opening.width || 0.9;
        const doorHeight = opening.height || 2.1;
        
        const start = new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y);
        const end = new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y);
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        
        const doorPos = new THREE.Vector3(
          opening.position.x,
          doorHeight / 2,
          opening.position.y
        );
        
        const rotation = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          direction
        );

        return (
          <group key={`door-${index}`} position={doorPos} quaternion={rotation}>
            <mesh position={[doorWidth/2 - 0.05, 0, 0]}>
              <boxGeometry args={[doorWidth - 0.1, doorHeight - 0.2, 0.05]} />
              <meshStandardMaterial 
                color={colors.door} 
                wireframe={mode === 'wireframe'}
                transparent={mode === 'blueprint'}
                opacity={mode === 'blueprint' ? 0.9 : 1}
              />
            </mesh>
            {/* Door swing arc */}
            {mode !== 'wireframe' && (
              <mesh position={[0, 0.02, -doorWidth/2]} rotation={[0, 0, 0]}>
                <ringGeometry args={[doorWidth - 0.05, doorWidth, 16, 1, 0, Math.PI/2]} />
                <meshBasicMaterial 
                  color={colors.door} 
                  opacity={0.3} 
                  transparent 
                  side={THREE.DoubleSide} 
                />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Windows */}
      {plan.openings && plan.openings.filter(o => o.type === 'window').map((opening: Opening, index: number) => {
        const wall = plan.walls.find(w => w.id === opening.wallId);
        if (!wall) return null;
        
        const windowWidth = opening.width || 1.2;
        const windowHeight = opening.height || 1.2;
        
        const start = new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y);
        const end = new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y);
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        
        const windowPos = new THREE.Vector3(
          opening.position.x,
          windowHeight,
          opening.position.y
        );
        
        const rotation = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          direction
        );

        return (
          <group key={`window-${index}`} position={windowPos} quaternion={rotation}>
            {/* Window frame */}
            <mesh>
              <boxGeometry args={[windowWidth + 0.1, 0.1, 0.2]} />
              <meshStandardMaterial 
                color={colors.window} 
                wireframe={mode === 'wireframe'}
                transparent={mode === 'blueprint'}
                opacity={mode === 'blueprint' ? 0.9 : 1}
              />
            </mesh>
            {/* Glass */}
            {mode !== 'wireframe' && (
              <mesh>
                <boxGeometry args={[windowWidth, windowHeight, 0.02]} />
                <meshStandardMaterial 
                  color={colors.window} 
                  opacity={mode === 'blueprint' ? 0.5 : 0.4} 
                  transparent 
                  roughness={0.1}
                  metalness={0.9}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

// Camera auto-fit
function CameraFit({ plan: _plan }: { plan: ProcessedFloorPlan }) {
  return null;
}

export default VisualizationModes;
