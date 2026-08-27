import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import type { ProcessedFloorPlan, Wall, Room, Point, Opening } from '../lib/shared';

const WALL_HEIGHT = 2.8; // 2.8 meters

export function Viewer3D() {
  const { processedPlan } = useStore();

  if (!processedPlan) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-slate-400">Carregue uma planta primeiro</p>
      </div>
    );
  }

  // Calculate center
  const { centerX, centerZ } = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (processedPlan.walls && processedPlan.walls.length > 0) {
      processedPlan.walls.forEach((wall: Wall) => {
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
  }, [processedPlan]);

  return (
    <div className="flex-1 relative">
      <Canvas
        shadows
        gl={{ antialias: true }}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Ultra-wide FOV for 2x larger view coverage */}
        <PerspectiveCamera
          makeDefault
          position={[centerX, 80, centerZ + 120]}
          fov={100}
          near={0.1}
          far={2000}
        />
        
        {/* Lighting */}
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
        
        {/* 3D Scene with Walls Standing Up */}
        <FloorPlanScene plan={processedPlan} />
        
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
        
        <CameraFit plan={processedPlan} />
      </Canvas>
      
      <div className="absolute bottom-4 left-4 glass rounded-lg px-3 py-2 text-xs">
        <p className="text-slate-400">Arraste para rotacionar • Pinça para zoom</p>
      </div>
    </div>
  );
}

// Full 3D Floor Plan Scene with Walls Standing Up
function FloorPlanScene({ plan }: { plan: ProcessedFloorPlan }) {
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

  // Calculate center
  let centerX = 0, centerZ = 0;
  if (plan.walls && plan.walls.length > 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    plan.walls.forEach((wall: Wall) => {
      minX = Math.min(minX, wall.startPoint.x, wall.endPoint.x);
      maxX = Math.max(maxX, wall.startPoint.x, wall.endPoint.x);
      minZ = Math.min(minZ, wall.startPoint.y, wall.endPoint.y);
      maxZ = Math.max(maxZ, wall.startPoint.y, wall.endPoint.y);
    });
    centerX = (minX + maxX) / 2;
    centerZ = (minZ + maxZ) / 2;
  }

  // Create a shape from room polygon for proper room floor
  const createRoomShape = (polygon: Point[]): THREE.Shape => {
    const shape = new THREE.Shape();
    if (polygon.length < 3) return shape;
    
    shape.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x, polygon[i].y);
    }
    shape.closePath();
    return shape;
  };

  // Calculate wall center for positioning
  const getWallCenter = (wall: Wall) => {
    const start = new THREE.Vector3(wall.startPoint.x, 0, wall.startPoint.y);
    const end = new THREE.Vector3(wall.endPoint.x, 0, wall.endPoint.y);
    return new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
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

  return (
    <group>
      {/* Base floor */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[centerX, -0.01, centerZ]} 
        receiveShadow
      >
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#1E293B" opacity={0.5} transparent />
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
                opacity={0.4}
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
                fontSize: '12px',
                fontWeight: 'bold',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
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
        const wallThickness = Math.max(wall.thickness, 0.15);
        
        const center = getWallCenter(wall);
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
        
        // Position door along wall
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
            {/* Door frame */}
            <mesh position={[0, doorHeight/2, 0]} castShadow>
              <boxGeometry args={[doorWidth + 0.1, 0.1, 0.2]} />
              <meshStandardMaterial color="#8B4513" roughness={0.9} />
            </mesh>
            {/* Door panel */}
            <mesh position={[doorWidth/2 - 0.05, doorHeight/2 - 0.1, 0]} castShadow>
              <boxGeometry args={[doorWidth - 0.1, doorHeight - 0.2, 0.05]} />
              <meshStandardMaterial color="#A0522D" roughness={0.7} />
            </mesh>
            {/* Door swing arc hint */}
            <mesh position={[0, 0.02, -doorWidth/2]} rotation={[0, 0, 0]}>
              <ringGeometry args={[doorWidth - 0.05, doorWidth, 16, 1, 0, Math.PI/2]} />
              <meshBasicMaterial color="#ffffff" opacity={0.2} transparent side={THREE.DoubleSide} />
            </mesh>
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
            <mesh castShadow>
              <boxGeometry args={[windowWidth + 0.1, 0.1, 0.2]} />
              <meshStandardMaterial color="#4A5568" roughness={0.5} metalness={0.3} />
            </mesh>
            {/* Glass */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[windowWidth, windowHeight, 0.02]} />
              <meshStandardMaterial 
                color="#87CEEB" 
                opacity={0.4} 
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

// Camera auto-fit with improved positioning
function CameraFit({ plan }: { plan: ProcessedFloorPlan }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!plan || !plan.walls || plan.walls.length === 0) return;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

    plan.walls.forEach((wall: Wall) => {
      minX = Math.min(minX, wall.startPoint.x, wall.endPoint.x);
      maxX = Math.max(maxX, wall.startPoint.x, wall.endPoint.x);
      minZ = Math.min(minZ, wall.startPoint.y, wall.endPoint.y);
      maxZ = Math.max(maxZ, wall.startPoint.y, wall.endPoint.y);
    });

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ);

    // Position camera for full view with 2x coverage
    const distance = size * 1.8;
    camera.position.set(centerX, distance * 1.2, centerZ + distance * 1.2);
    camera.lookAt(centerX, 0, centerZ);
  }, [plan, camera]);

  return null;
}
