import {
  FloorPlan2D,
  Wall2D,
  Wall3D,
  Room2D,
  Room3D,
  Opening3D,
  Point2D,
  Point3D,
  Model3D,
  ScaleConfig,
  CoordinateSystem,
  VisualizationConfig,
  RoomType,
} from '../types';
import * as THREE from 'three';

// ============================================
// 3D RECONSTRUCTION ENGINE
// Converte planta 2D para modelo 3D
// ============================================

export class ReconstructionEngine3D {
  private wallHeight = 2.7; // metros
  private wallThickness = 0.15; // metros
  private doorHeight = 2.1; // metros
  private windowFromFloor = 0.9; // metros

  // Reconstruir modelo 3D completo
  reconstruct(
    floorPlan: FloorPlan2D,
    scale: ScaleConfig,
    coordinateSystem: CoordinateSystem
  ): Model3D {
    // Reconstruir paredes 3D
    const walls3D = this.reconstructWalls(floorPlan.walls, scale, coordinateSystem);

    // Reconstruir aberturas 3D
    const openings3D = this.reconstructOpenings(floorPlan, scale, coordinateSystem);

    // Reconstruir cômodos 3D
    const rooms3D = this.reconstructRooms(floorPlan.rooms, scale, coordinateSystem);

    // Aplicar aberturas às paredes
    this.applyOpeningsToWalls(walls3D, openings3D);

    return {
      id: `model_${Date.now()}`,
      walls: walls3D,
      rooms: rooms3D,
      floorPlan,
      scale,
      coordinateSystem,
      metadata: {
        createdAt: new Date(),
        sourceImage: undefined,
        sourceType: 'camera',
        processingTime: 0,
        detectedElements: this.getDetectedElements(floorPlan),
      },
    };
  }

  // Reconstruir paredes 3D
  private reconstructWalls(
    walls2D: Wall2D[],
    scale: ScaleConfig,
    coordSystem: CoordinateSystem
  ): Wall3D[] {
    const walls3D: Wall3D[] = [];

    for (const wall of walls2D) {
      // Converter pontos 2D para 3D
      const start2D = this.transformPoint(wall.start, scale, coordSystem);
      const end2D = this.transformPoint(wall.end, scale, coordSystem);

      // Calcular comprimento
      const dx = end2D.x - start2D.x;
      const dy = end2D.y - start2D.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      // Calcular rotação
      const rotation = Math.atan2(dy, dx);

      // Calcular centro
      const centerX = (start2D.x + end2D.x) / 2;
      const centerY = (start2D.y + end2D.y) / 2;

      walls3D.push({
        id: wall.id,
        position: { x: centerX, y: this.wallHeight / 2, z: centerY },
        length,
        height: this.wallHeight,
        thickness: this.wallThickness,
        rotation,
        openings: [],
        material: wall.isExterior ? 'brick' : 'drywall',
        color: wall.isExterior ? '#4A5568' : '#718096',
      });
    }

    return walls3D;
  }

  // Reconstruir aberturas (portas e janelas)
  private reconstructOpenings(
    floorPlan: FloorPlan2D,
    scale: ScaleConfig,
    coordSystem: CoordinateSystem
  ): Opening3D[] {
    const openings3D: Opening3D[] = [];

    // Processar portas
    for (const door of floorPlan.doors) {
      const position = this.transformPoint(door.position, scale, coordSystem);
      openings3D.push({
        id: door.id,
        type: 'door',
        position: {
          x: position.x,
          y: this.doorHeight / 2,
          z: position.y,
        },
        width: door.width / scale.pixelsPerMeter,
        height: this.doorHeight,
        rotation: door.rotation,
        depth: this.wallThickness,
      });
    }

    // Processar janelas
    for (const win of floorPlan.windows) {
      const position = this.transformPoint(win.position, scale, coordSystem);
      openings3D.push({
        id: win.id,
        type: 'window',
        position: {
          x: position.x,
          y: this.windowFromFloor + (win.height || 120) / scale.pixelsPerMeter / 2,
          z: position.y,
        },
        width: win.width / scale.pixelsPerMeter,
        height: (win.height || 120) / scale.pixelsPerMeter,
        rotation: win.rotation,
        depth: this.wallThickness,
      });
    }

    return openings3D;
  }

  // Reconstruir cômodos 3D
  private reconstructRooms(
    rooms2D: Room2D[],
    scale: ScaleConfig,
    coordSystem: CoordinateSystem
  ): Room3D[] {
    const rooms3D: Room3D[] = [];

    for (const room of rooms2D) {
      const center2D = this.transformPoint(room.center, scale, coordSystem);

      rooms3D.push({
        id: room.id,
        name: room.name,
        type: room.type,
        walls: room.walls,
        floorArea: room.polygon.map((p) => {
          const transformed = this.transformPoint(p, scale, coordSystem);
          return { x: transformed.x, y: 0, z: transformed.y };
        }),
        center: { x: center2D.x, y: this.wallHeight / 2, z: center2D.y },
        height: this.wallHeight,
        floorMaterial: this.getFloorMaterial(room.type),
        wallMaterial: 'paint',
      });
    }

    return rooms3D;
  }

  // Aplicar aberturas às paredes
  private applyOpeningsToWalls(walls3D: Wall3D[], openings3D: Opening3D[]): void {
    for (const opening of openings3D) {
      // Encontrar parede mais próxima
      let closestWall: Wall3D | null = null;
      let minDist = Infinity;

      for (const wall of walls3D) {
        const dx = opening.position.x - wall.position.x;
        const dz = opening.position.z - wall.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < minDist && dist < wall.length / 2) {
          minDist = dist;
          closestWall = wall;
        }
      }

      if (closestWall) {
        closestWall.openings.push(opening);
      }
    }
  }

  // Transformar ponto 2D para coordenadas do modelo
  private transformPoint(
    point: Point2D,
    scale: ScaleConfig,
    coordSystem: CoordinateSystem
  ): Point2D {
    let x = point.x - coordSystem.origin.x;
    let y = point.y - coordSystem.origin.y;

    // Aplicar rotação
    if (coordSystem.rotation !== 0) {
      const cos = Math.cos(-coordSystem.rotation);
      const sin = Math.sin(-coordSystem.rotation);
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      x = rx;
      y = ry;
    }

    // Aplicar flip
    if (coordSystem.flipX) x = -x;
    if (coordSystem.flipY) y = -y;

    // Converter para metros
    return {
      x: x / scale.pixelsPerMeter,
      y: y / scale.pixelsPerMeter,
    };
  }

  // Obter material do piso por tipo de cômodo
  private getFloorMaterial(type: RoomType): string {
    switch (type) {
      case 'bathroom':
        return 'tile_ceramic';
      case 'kitchen':
        return 'tile_ceramic';
      case 'living':
        return 'hardwood';
      case 'bedroom':
        return 'hardwood';
      case 'dining':
        return 'hardwood';
      default:
        return 'concrete';
    }
  }

  // Obter elementos detectados
  private getDetectedElements(floorPlan: FloorPlan2D): string[] {
    const elements: string[] = [];
    
    if (floorPlan.walls.length > 0) elements.push('walls');
    if (floorPlan.doors.length > 0) elements.push('doors');
    if (floorPlan.windows.length > 0) elements.push('windows');
    if (floorPlan.rooms.length > 0) elements.push('rooms');
    
    return elements;
  }

  // Criar mesh THREE.js do modelo
  createThreeJSMeshes(
    model: Model3D,
    config: VisualizationConfig
  ): THREE.Group {
    const group = new THREE.Group();

    // Criar paredes
    if (config.showWalls) {
      const wallsGroup = this.createWallsMesh(model.walls, config);
      group.add(wallsGroup);
    }

    // Criar piso
    if (config.showFloor) {
      const floorGroup = this.createFloorMesh(model, config);
      group.add(floorGroup);
    }

    // Criar teto
    if (config.showCeiling) {
      const ceilingGroup = this.createCeilingMesh(model, config);
      group.add(ceilingGroup);
    }

    // Criar portas
    if (config.showDoors) {
      const doorsGroup = this.createDoorsMesh(model.walls, config);
      group.add(doorsGroup);
    }

    // Criar janelas
    if (config.showWindows) {
      const windowsGroup = this.createWindowsMesh(model.walls, config);
      group.add(windowsGroup);
    }

    // Criar labels dos cômodos
    if (config.showRooms) {
      const labelsGroup = this.createRoomLabels(model.rooms);
      group.add(labelsGroup);
    }

    return group;
  }

  // Criar mesh das paredes
  private createWallsMesh(
    walls: Wall3D[],
    config: VisualizationConfig
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Walls';

    const material = new THREE.MeshStandardMaterial({
      color: config.materials.walls.color,
      transparent: config.materials.walls.opacity < 1,
      opacity: config.materials.walls.opacity,
      wireframe: config.materials.walls.wireframe,
    });

    for (const wall of walls) {
      // Geometria da parede principal
      const geometry = new THREE.BoxGeometry(
        wall.length,
        wall.height,
        wall.thickness
      );

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(wall.position.x, wall.position.y, wall.position.z);
      mesh.rotation.y = -wall.rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      group.add(mesh);

      // Criar furos para aberturas
      for (const opening of wall.openings) {
        const holeGeometry = new THREE.BoxGeometry(
          opening.width,
          opening.height,
          wall.thickness + 0.01
        );
        const hole = new THREE.Mesh(holeGeometry);
        
        // Calcular posição relativa na parede
        const relX = opening.position.x - wall.position.x;
        hole.position.set(
          wall.position.x + relX * Math.cos(wall.rotation),
          opening.position.y,
          wall.position.z + relX * Math.sin(wall.rotation)
        );
        hole.rotation.y = -wall.rotation;

        // Subtraction would require CSG, simplified by adding colored mesh
        const holeMaterial = new THREE.MeshStandardMaterial({
          color: opening.type === 'door' ? '#8B4513' : '#87CEEB',
          transparent: true,
          opacity: 0.5,
        });
        const holeMesh = new THREE.Mesh(holeGeometry, holeMaterial);
        holeMesh.position.copy(hole.position);
        holeMesh.rotation.y = -wall.rotation;
        group.add(holeMesh);
      }
    }

    return group;
  }

  // Criar mesh do piso
  private createFloorMesh(
    model: Model3D,
    config: VisualizationConfig
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Floor';

    const { bounds } = model.floorPlan;
    const width = (bounds.max.x - bounds.min.x) / model.scale.pixelsPerMeter;
    const height = (bounds.max.y - bounds.min.y) / model.scale.pixelsPerMeter;

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshStandardMaterial({
      color: config.materials.floor.color,
      transparent: config.materials.floor.opacity < 1,
      opacity: config.materials.floor.opacity,
      wireframe: config.materials.floor.wireframe,
    });

    const floor = new THREE.Mesh(geometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, 0, height / 2);
    floor.receiveShadow = true;

    group.add(floor);

    // Adicionar cômodos coloridos
    for (const room of model.rooms) {
      if (room.floorArea.length >= 3) {
        const roomGeometry = this.createPolygonGeometry(room.floorArea);
        const roomMaterial = new THREE.MeshStandardMaterial({
          color: this.getRoomColor(room.type),
          transparent: true,
          opacity: 0.4,
        });
        const roomMesh = new THREE.Mesh(roomGeometry, roomMaterial);
        roomMesh.rotation.x = -Math.PI / 2;
        roomMesh.position.y = 0.01;
        roomMesh.receiveShadow = true;
        group.add(roomMesh);
      }
    }

    return group;
  }

  // Criar mesh do teto
  private createCeilingMesh(
    model: Model3D,
    config: VisualizationConfig
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Ceiling';

    if (!config.materials.ceiling.visible) return group;

    const { bounds } = model.floorPlan;
    const width = (bounds.max.x - bounds.min.x) / model.scale.pixelsPerMeter;
    const height = (bounds.max.y - bounds.min.y) / model.scale.pixelsPerMeter;

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshStandardMaterial({
      color: config.materials.ceiling.color,
      transparent: true,
      opacity: config.materials.ceiling.opacity,
      side: THREE.DoubleSide,
    });

    const ceiling = new THREE.Mesh(geometry, material);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(width / 2, model.rooms[0]?.height || this.wallHeight, height / 2);

    group.add(ceiling);

    return group;
  }

  // Criar mesh das portas
  private createDoorsMesh(
    walls: Wall3D[],
    config: VisualizationConfig
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Doors';

    const material = new THREE.MeshStandardMaterial({
      color: config.materials.doors.color,
    });

    for (const wall of walls) {
      for (const opening of wall.openings) {
        if (opening.type !== 'door') continue;

        const geometry = new THREE.BoxGeometry(
          opening.width,
          opening.height,
          0.05
        );

        const door = new THREE.Mesh(geometry, material);
        
        // Calcular posição
        const relX = opening.position.x - wall.position.x;
        door.position.set(
          wall.position.x + relX * Math.cos(wall.rotation),
          opening.height / 2,
          wall.position.z + relX * Math.sin(wall.rotation)
        );
        door.rotation.y = -opening.rotation;

        group.add(door);

        // Moldura da porta
        const frameGeometry = new THREE.BoxGeometry(
          opening.width + 0.1,
          0.05,
          0.08
        );
        const frameMaterial = new THREE.MeshStandardMaterial({ color: '#5D4037' });
        
        const topFrame = new THREE.Mesh(frameGeometry, frameMaterial);
        topFrame.position.copy(door.position);
        topFrame.position.y = opening.height;
        topFrame.rotation.y = -opening.rotation;
        group.add(topFrame);
      }
    }

    return group;
  }

  // Criar mesh das janelas
  private createWindowsMesh(
    walls: Wall3D[],
    config: VisualizationConfig
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Windows';

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: config.materials.windows.color,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: '#87CEEB',
      transparent: true,
      opacity: 0.3,
    });

    for (const wall of walls) {
      for (const opening of wall.openings) {
        if (opening.type !== 'window') continue;

        // Moldura da janela
        const frameGeometry = new THREE.BoxGeometry(
          opening.width + 0.1,
          opening.height + 0.1,
          0.05
        );
        const frame = new THREE.Mesh(frameGeometry, frameMaterial);

        const relX = opening.position.x - wall.position.x;
        frame.position.set(
          wall.position.x + relX * Math.cos(wall.rotation),
          opening.position.y,
          wall.position.z + relX * Math.sin(wall.rotation)
        );
        frame.rotation.y = -opening.rotation;
        group.add(frame);

        // Vidro
        if (config.materials.windows.showGlass) {
          const glassGeometry = new THREE.PlaneGeometry(opening.width, opening.height);
          const glass = new THREE.Mesh(glassGeometry, glassMaterial);
          glass.position.copy(frame.position);
          glass.position.z += 0.03;
          glass.rotation.y = -opening.rotation;
          group.add(glass);
        }
      }
    }

    return group;
  }

  // Criar labels dos cômodos
  private createRoomLabels(rooms: Room3D[]): THREE.Group {
    const group = new THREE.Group();
    group.name = 'RoomLabels';

    // Usar Html do drei para labels
    // Por enquanto, criar placeholder visual
    for (const room of rooms) {
      const labelGeometry = new THREE.PlaneGeometry(0.5, 0.2);
      const labelMaterial = new THREE.MeshBasicMaterial({
        color: '#1a1a1a',
        transparent: true,
        opacity: 0.7,
      });
      const label = new THREE.Mesh(labelGeometry, labelMaterial);
      label.position.set(room.center.x, 0.05, room.center.z);
      label.rotation.x = -Math.PI / 2;
      group.add(label);
    }

    return group;
  }

  // Criar geometria de polígono
  private createPolygonGeometry(points: Point3D[]): THREE.BufferGeometry {
    const vertices: number[] = [];

    const center = { x: 0, y: 0, z: 0 };
    for (const p of points) {
      center.x += p.x;
      center.z += p.z;
    }
    center.x /= points.length;
    center.z /= points.length;

    // Triangulação simples (venter fan)
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      vertices.push(center.x, 0, center.z);
      vertices.push(p1.x, 0, p1.z);
      
      const p2 = points[(i + 1) % points.length];
      vertices.push(p2.x, 0, p2.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    return geometry;
  }

  // Obter cor do cômodo
  private getRoomColor(type: RoomType): string {
    switch (type) {
      case 'living': return '#4299e1'; // azul
      case 'bedroom': return '#9f7aea'; // roxo
      case 'kitchen': return '#ed8936'; // laranja
      case 'bathroom': return '#38b2ac'; // ciano
      case 'dining': return '#48bb78'; // verde
      default: return '#a0aec0'; // cinza
    }
  }

  // Configurar altura das paredes
  setWallHeight(height: number): void {
    this.wallHeight = height;
  }

  // Configurar espessura das paredes
  setWallThickness(thickness: number): void {
    this.wallThickness = thickness;
  }
}

// Instância singleton
export const reconstructionEngine = new ReconstructionEngine3D();
