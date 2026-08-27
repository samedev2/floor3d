import { useState, useRef, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as THREE from 'three';
import { 
  Upload, 
  Camera, 
  X, 
  Loader2,
  AlertTriangle,
  RotateCw,
  Trash2,
  Sparkles,
  MapPin,
  FileImage,
  Wand2,
  Download,
  Box,
} from 'lucide-react';

// ============================================
// IMAGE TO 3D CONVERTER
// Converts PNG/JPEG → .ply (point cloud) or .glb (mesh)
// ============================================

async function convertImageToSplatting(
  file: File, 
  outputFormat: 'ply' | 'glb',
  options: { depthScale?: number; pointDensity?: number } = {}
): Promise<{ data: Blob | string; type: string; filename: string }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const depthScale = options.depthScale || 0.3;
  const pointDensity = options.pointDensity || 2; // 1=full, 2=half, 4=quarter

  // Create canvas to read pixels
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const pixels = imageData.data;

  // Calculate aspect ratio
  const aspect = img.width / img.height;
  const scale = 5; // World scale
  const worldWidth = scale * aspect;
  const worldHeight = scale;

  if (outputFormat === 'ply') {
    // Convert to PLY point cloud
    const positions: number[] = [];
    const colors: number[] = [];
    
    // Method 1: Dense point cloud from image pixels
    for (let y = 0; y < img.height; y += pointDensity) {
      for (let x = 0; x < img.width; x += pointDensity) {
        const idx = (y * img.width + x) * 4;
        const r = pixels[idx] / 255;
        const g = pixels[idx + 1] / 255;
        const b = pixels[idx + 2] / 255;
        const a = pixels[idx + 3] / 255;
        
        if (a < 0.1) continue; // Skip transparent
        
        // Convert pixel to world position
        const worldX = (x / img.width - 0.5) * worldWidth;
        const worldY = (0.5 - y / img.height) * worldHeight;
        
        // Simulate depth from brightness (darker = further away)
        const brightness = (r + g + b) / 3;
        const worldZ = (brightness - 0.5) * depthScale;
        
        positions.push(worldX, worldY, worldZ);
        colors.push(r, g, b);
      }
    }
    
    // Build PLY content
    let plyContent = `ply
format ascii 1.0
element vertex ${positions.length / 3}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
`;
    
    for (let i = 0; i < positions.length; i += 3) {
      plyContent += `${positions[i]} ${positions[i + 1]} ${positions[i + 2]} ${Math.round(colors[i] * 255)} ${Math.round(colors[i + 1] * 255)} ${Math.round(colors[i + 2] * 255)}\n`;
    }
    
    return {
      data: new Blob([plyContent], { type: 'text/plain' }),
      type: 'text/plain',
      filename: file.name.replace(/\.[^/.]+$/, '') + '.ply'
    };
  } else {
    // Convert to GLB (mesh plane with image as texture)
    return new Promise((resolve, reject) => {
      const texture = new THREE.TextureLoader().load(
        URL.createObjectURL(file),
        () => {
          // Create plane geometry with the image as texture
          const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight, 32, 32);
          
          // Add depth variation based on image brightness
          const positions = geometry.attributes.position;
          const colorCanvas = document.createElement('canvas');
          colorCanvas.width = 32;
          colorCanvas.height = 32;
          const colorCtx = colorCanvas.getContext('2d')!;
          colorCtx.drawImage(img, 0, 0, 32, 32);
          const colorData = colorCtx.getImageData(0, 0, 32, 32).data;
          
          for (let i = 0; i < positions.count; i++) {
            const x = i % 33;
            const y = Math.floor(i / 33);
            const colorIdx = (y * 32 + x) * 4;
            const r = colorData[colorIdx] / 255;
            const g = colorData[colorIdx + 1] / 255;
            const b = colorData[colorIdx + 2] / 255;
            const brightness = (r + g + b) / 3;
            
            // Displace Z based on brightness
            positions.setZ(i, (brightness - 0.5) * depthScale);
          }
          
          geometry.computeVertexNormals();
          
          const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            roughness: 0.8,
            metalness: 0.1,
          });
          
          const mesh = new THREE.Mesh(geometry, material);
          
          // Export to GLB
          const exporter = new GLTFExporter();
          exporter.parse(
            mesh,
            (result) => {
              if (result instanceof ArrayBuffer) {
                resolve({
                  data: new Blob([result], { type: 'model/gltf-binary' }),
                  type: 'model/gltf-binary',
                  filename: file.name.replace(/\.[^/.]+$/, '') + '.glb'
                });
              } else {
                resolve({
                  data: new Blob([JSON.stringify(result)], { type: 'model/gltf+json' }),
                  type: 'model/gltf+json',
                  filename: file.name.replace(/\.[^/.]+$/, '') + '.gltf'
                });
              }
            },
            (error) => reject(error),
            { binary: true }
          );
        },
        undefined,
        reject
      );
    });
  }
}

// ============================================
// PLY LOADER (existente)
// ============================================
async function loadPLY(file: File): Promise<SplattingData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const loader = new PLYLoader();
        const geometry = loader.parse(e.target?.result as string);
        
        if (!geometry.attributes.color) {
          const colors = new Float32Array(geometry.attributes.position.count * 3);
          for (let i = 0; i < colors.length; i += 3) {
            colors[i] = 0.7;
            colors[i + 1] = 0.7;
            colors[i + 2] = 0.8;
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
        
        const positions = geometry.attributes.position.array as Float32Array;
        const colors = geometry.attributes.color.array as Float32Array;
        
        resolve({
          positions,
          colors,
          count: geometry.attributes.position.count,
          source: file.name,
          type: 'pointcloud',
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function loadGLB(file: File): Promise<{ gltf: any, data: SplattingData }> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const url = URL.createObjectURL(file);
    
    loader.load(
      url,
      (gltf) => {
        const positions: number[] = [];
        const colors: number[] = [];
        
        gltf.scene.traverse((obj: any) => {
          if (obj.isMesh && obj.geometry) {
            const pos = obj.geometry.attributes.position;
            const col = obj.geometry.attributes.color;
            
            for (let i = 0; i < pos.count; i++) {
              positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
              if (col) {
                colors.push(col.getX(i), col.getY(i), col.getZ(i));
              } else {
                colors.push(0.7, 0.7, 0.8);
              }
            }
          }
        });
        
        URL.revokeObjectURL(url);
        
        resolve({
          gltf,
          data: {
            positions: new Float32Array(positions),
            colors: new Float32Array(colors),
            count: positions.length / 3,
            source: file.name,
            type: 'mesh',
          },
        });
      },
      undefined,
      reject
    );
  });
}

// ============================================
// TYPES
// ============================================
interface SplattingData {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
  scale?: number;
  source: string;
  type: 'pointcloud' | 'gaussian' | 'mesh';
}

// ============================================
// POINT CLOUD RENDERER
// ============================================
function PointCloud({ data, pinPosition }: { 
  data: SplattingData; 
  pinPosition: THREE.Vector3 | null;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    return geo;
  }, [data]);

  return (
    <group>
      <points geometry={geometry}>
        <pointsMaterial
          size={0.02}
          vertexColors
          sizeAttenuation
          transparent
          opacity={0.9}
        />
      </points>
      
      {pinPosition && (
        <group position={pinPosition}>
          <mesh>
            <coneGeometry args={[0.15, 0.3, 16]} />
            <meshStandardMaterial color="#EF4444" emissive="#DC2626" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.05, 0.1, 0.3, 16]} />
            <meshStandardMaterial color="#FCA5A5" />
          </mesh>
          <Html position={[0, 0.4, 0]} center>
            <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold whitespace-nowrap">
              📍 PIN ANCORADO
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

// ============================================
// SURFACE PLANE
// ============================================
function SurfacePlane({ onPin, scale = 10 }: { 
  onPin: (point: THREE.Vector3) => void;
  scale?: number;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onPin(e.point);
      }}
    >
      <planeGeometry args={[scale, scale]} />
      <meshStandardMaterial 
        color="#3B82F6" 
        transparent
        opacity={0.15}
        side={THREE.DoubleSide}
      />
      <gridHelper args={[scale, scale / 0.5, '#60A5FA', '#1E40AF']} position={[0, 0.001, 0]} />
    </mesh>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
interface GaussianSplattingViewerProps {
  onClose?: () => void;
}

export function GaussianSplattingViewer({ onClose }: GaussianSplattingViewerProps) {
  const [view, setView] = useState<'import' | 'viewer'>('import');
  const [splattingData, setSplattingData] = useState<SplattingData | null>(null);
  const [gltfScene, setGltfScene] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  
  // Pin tracking
  const [pinPosition, setPinPosition] = useState<THREE.Vector3 | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [surfaceScale, setSurfaceScale] = useState(10);
  
  // Image conversion options
  const [depthScale, setDepthScale] = useState(0.3);
  const [pointDensity, setPointDensity] = useState(2);
  const [convertedFile, setConvertedFile] = useState<{ data: Blob, filename: string } | null>(null);
  
  // Camera mode
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ============================================
  // FILE UPLOAD (PLY/GLB/GLTF)
  // ============================================
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStatus('Carregando arquivo 3D...');

    try {
      const ext = file.name.toLowerCase().split('.').pop();
      
      if (ext === 'ply') {
        setProcessingStatus('Processando point cloud...');
        const data = await loadPLY(file);
        setSplattingData(data);
        setView('viewer');
      } else if (ext === 'glb' || ext === 'gltf') {
        setProcessingStatus('Carregando modelo 3D...');
        const { gltf, data } = await loadGLB(file);
        setGltfScene(gltf.scene);
        setSplattingData(data);
        setView('viewer');
      } else {
        throw new Error('Formato não suportado. Use: .ply, .glb, .gltf ou converta uma imagem.');
      }
    } catch (err) {
      setError('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // ============================================
  // IMAGE TO 3D CONVERSION
  // ============================================
  const handleImageConversion = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    outputFormat: 'ply' | 'glb'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStatus(`Convertendo imagem para .${outputFormat}...`);

    try {
      const result = await convertImageToSplatting(file, outputFormat, {
        depthScale,
        pointDensity,
      });
      
      setConvertedFile({
        data: result.data as Blob,
        filename: result.filename,
      });
      
      setProcessingStatus(`Convertido: ${result.filename}`);
      
      // Auto-load the converted file
      const convertedFile = new File([result.data], result.filename, { type: result.type });
      
      if (outputFormat === 'ply') {
        const data = await loadPLY(convertedFile);
        data.source = `${file.name} → .ply`;
        setSplattingData(data);
      } else {
        const { gltf, data } = await loadGLB(convertedFile);
        data.source = `${file.name} → .glb`;
        setGltfScene(gltf.scene);
        setSplattingData(data);
      }
      
      setView('viewer');
    } catch (err) {
      setError('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setIsProcessing(false);
    }
  }, [depthScale, pointDensity]);

  // ============================================
  // DOWNLOAD CONVERTED FILE
  // ============================================
  const downloadConverted = useCallback(() => {
    if (!convertedFile) return;
    const url = URL.createObjectURL(convertedFile.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = convertedFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [convertedFile]);

  // ============================================
  // CAMERA MODE
  // ============================================
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      setError('Não foi possível acessar a câmera');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // ============================================
  // PIN TRACKING
  // ============================================
  const handlePin = useCallback((point: THREE.Vector3) => {
    setPinPosition(point.clone());
  }, []);

  // ============================================
  // IMPORT VIEW
  // ============================================
  if (view === 'import') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
        <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-pink-400" />
            </div>
            <div>
              <h1 className="font-bold text-white">Gaussian Splatting 3D</h1>
              <p className="text-slate-400 text-sm">Importar ou converter imagem</p>
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

        <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
          <div className="w-20 h-20 rounded-3xl bg-pink-500/20 flex items-center justify-center mb-6">
            <Wand2 className="w-10 h-10 text-pink-400" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Importar Modelo 3D</h2>
          <p className="text-slate-400 text-center mb-6 max-w-md">
            Carregue um arquivo 3D ou converta uma imagem PNG/JPEG para .ply/.glb
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".ply,.glb,.gltf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
          />

          <div className="w-full max-w-sm space-y-3">
            {/* Direct 3D file upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full py-4 px-6 bg-pink-600 hover:bg-pink-500 disabled:bg-slate-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>{processingStatus}</span>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6" />
                  <span>Arquivo 3D (.ply, .glb)</span>
                </>
              )}
            </button>

            {/* Image conversion section */}
            <div className="bg-slate-800/70 border-2 border-cyan-500/40 rounded-2xl p-4">
              <h3 className="text-cyan-400 font-bold text-sm mb-3 flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                Converter Imagem → 3D
              </h3>
              <p className="text-slate-400 text-xs mb-3">
                Transforme uma imagem PNG/JPEG em point cloud ou mesh 3D
              </p>
              
              {/* Conversion Options */}
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-slate-400 text-xs flex justify-between">
                    <span>Profundidade</span>
                    <span className="text-cyan-400">{depthScale.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={depthScale}
                    onChange={(e) => setDepthScale(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs flex justify-between">
                    <span>Densidade</span>
                    <span className="text-cyan-400">{pointDensity === 1 ? 'Alta' : pointDensity === 2 ? 'Média' : 'Baixa'}</span>
                  </label>
                  <select
                    value={pointDensity}
                    onChange={(e) => setPointDensity(parseInt(e.target.value))}
                    className="w-full bg-slate-700 text-white text-xs px-2 py-1 rounded"
                  >
                    <option value="1">Alta (mais pontos)</option>
                    <option value="2">Média</option>
                    <option value="4">Baixa (menos pontos)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    if (imageInputRef.current) {
                      imageInputRef.current.onchange = (e: any) => handleImageConversion(e, 'ply');
                      imageInputRef.current.click();
                    }
                  }}
                  disabled={isProcessing}
                  className="py-3 px-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2"
                >
                  <FileImage className="w-4 h-4" />
                  <span>→ .ply</span>
                </button>
                <button
                  onClick={() => {
                    if (imageInputRef.current) {
                      imageInputRef.current.onchange = (e: any) => handleImageConversion(e, 'glb');
                      imageInputRef.current.click();
                    }
                  }}
                  disabled={isProcessing}
                  className="py-3 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Box className="w-4 h-4" />
                  <span>→ .glb</span>
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-left">
              <h3 className="text-white text-sm font-bold mb-2">Como funciona:</h3>
              <ul className="text-slate-300 text-xs space-y-1">
                <li>• <strong>Direto:</strong> .ply, .glb, .gltf</li>
                <li>• <strong>Conversão:</strong> imagem vira point cloud</li>
                <li>• <strong>Profundidade:</strong> brilho da imagem</li>
                <li>• <strong>Visualizar:</strong> clique para PIN</li>
                <li>• <strong>AR:</strong> botão câmera</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // VIEWER
  // ============================================
  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800/80 backdrop-blur border-b border-slate-700 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('import')}
            className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-pink-500/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-pink-400" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm">
              {splattingData?.source || 'Modelo 3D'}
            </h1>
            <p className="text-slate-400 text-xs">
              {splattingData?.count.toLocaleString()} pontos
              {pinPosition && ' • 📍 PIN ativo'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {convertedFile && (
            <button
              onClick={downloadConverted}
              className="px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 bg-green-600 text-white"
              title="Baixar arquivo convertido"
            >
              <Download className="w-3.5 h-3.5" />
              Salvar
            </button>
          )}
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
              autoRotate ? 'bg-green-600 text-white' : 'bg-slate-700 text-white'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={cameraActive ? stopCamera : startCamera}
            className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 ${
              cameraActive ? 'bg-red-600 text-white' : 'bg-cyan-600 text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            {cameraActive ? 'AR' : 'Camera'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Canvas + Camera Background */}
      <div className="flex-1 relative">
        {cameraActive && (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            playsInline
            muted
          />
        )}
        
        <Canvas
          shadows
          camera={{ position: [5, 5, 5], fov: 60 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: cameraActive ? 'transparent' : '#0a0a0a' }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />
          
          <gridHelper args={[20, 20, '#475569', '#334155']} position={[0, -0.01, 0]} />
          
          <SurfacePlane 
            onPin={handlePin}
            scale={surfaceScale}
          />
          
          {splattingData && gltfScene ? (
            <primitive object={gltfScene} />
          ) : splattingData ? (
            <PointCloud 
              data={splattingData}
              pinPosition={pinPosition}
            />
          ) : null}
          
          <OrbitControls
            enableZoom={true}
            enablePan={true}
            enableRotate={true}
            minDistance={1}
            maxDistance={50}
            autoRotate={autoRotate}
            autoRotateSpeed={1}
            target={[0, 0, 0]}
          />
        </Canvas>
      </div>

      {/* Conversion status */}
      {isProcessing && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-slate-800/95 backdrop-blur border border-cyan-500 rounded-xl p-3 z-20 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          <span className="text-cyan-400 text-sm">{processingStatus}</span>
        </div>
      )}

      {/* Pin info panel */}
      {pinPosition && (
        <div className="absolute top-20 left-4 bg-slate-800/95 backdrop-blur border border-slate-700 rounded-xl p-3 z-20 w-64">
          <h3 className="text-white text-sm font-bold mb-2 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-red-400" />
            PIN Tracker
          </h3>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Posição X:</span>
              <span className="text-cyan-400 font-mono">{pinPosition.x.toFixed(2)}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Posição Z:</span>
              <span className="text-cyan-400 font-mono">{pinPosition.z.toFixed(2)}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Distância da origem:</span>
              <span className="text-cyan-400 font-mono">
                {Math.sqrt(pinPosition.x ** 2 + pinPosition.z ** 2).toFixed(2)}m
              </span>
            </div>
          </div>
          <button
            onClick={() => setPinPosition(null)}
            className="w-full mt-2 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white flex items-center justify-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Remover PIN
          </button>
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-slate-900 to-transparent z-10">
        <div className="flex justify-center gap-2 mb-2">
          <button
            onClick={() => setSurfaceScale(Math.max(2, surfaceScale - 1))}
            className="px-3 py-1.5 bg-slate-800 rounded-lg text-white text-xs"
          >
            − Superfície
          </button>
          <button
            onClick={() => setSurfaceScale(surfaceScale + 1)}
            className="px-3 py-1.5 bg-slate-800 rounded-lg text-white text-xs"
          >
            + Superfície
          </button>
        </div>
        
        <p className="text-center text-slate-500 text-xs">
          {pinPosition 
            ? '📍 PIN ativo - use câmera para ver em AR' 
            : '👆 Clique no plano azul para colocar um PIN'}
        </p>
      </div>
    </div>
  );
}
