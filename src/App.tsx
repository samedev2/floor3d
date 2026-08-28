import { useState, useCallback, useRef } from 'react';
import {
  Upload,
  RefreshCw,
  Scan,
  Bug,
  Move,
  Grid3x3,
  Sparkles,
  Eye,
  Activity,
  Library,
  TestTube2,
  GitBranch,
  ChevronRight,
  AlertCircle,
  Sparkle,
  Building2,
} from 'lucide-react';
import { FloorPlanEditor3D } from './components/FloorPlanEditor3D';
import { LiveARCapture } from './components/LiveARCapture';
import { PermissionHandler } from './components/PermissionHandler';
import { PipelineView } from './components/PipelineView';
import { PlantLibrary } from './components/PlantLibrary';
import { GaussianSplattingViewer } from './components/GaussianSplattingViewer';
import { BlenderStyleEditor } from './components/BlenderStyleEditor';
import { PreciseBlockoutEditor } from './components/PreciseBlockoutEditor';
import { SystemTester } from './components/SystemTester';
import { DebugAnalyzer } from './components/DebugAnalyzer';
import { FloorPlan3DViewer } from './components/FloorPlan3DViewer';
import { useStore } from './store';
import { openCVArchitecturalParser } from './floorplan/opencvArchitecturalParser';
import { LAYERS } from './floorplan/typesExtensions';
import type { RoomData } from './floorplan/typesExtensions';
import './App.css';

type ViewKey =
  | 'liveAR'
  | 'editor3D'
  | 'viewer3D'
  | 'library'
  | 'gaussian'
  | 'blender'
  | 'precise'
  | 'tester'
  | 'pipeline'
  | 'debug';

interface ModeCard {
  key: ViewKey;
  title: string;
  desc: string;
  icon: React.ReactNode;
  gradient: string;
  border: string;
  badge?: string;
  badgeColor?: string;
}

interface ModeGroup {
  id: string;
  label: string;
  cards: ModeCard[];
}

const MODE_GROUPS: ModeGroup[] = [
  {
    id: 'capture',
    label: 'Captura',
    cards: [
      {
        key: 'liveAR',
        title: 'AR ao Vivo',
        desc: 'Câmera + ARCore em tempo real',
        icon: <Scan />,
        gradient: 'from-cyan-500/30 to-blue-600/10',
        border: 'border-cyan-500/40',
        badge: 'NOVO',
        badgeColor: 'bg-cyan-500/20 text-cyan-300',
      },
      {
        key: 'editor3D',
        title: 'Importar Planta',
        desc: 'PNG/JPG/PDF → 3D com OpenCV',
        icon: <Upload />,
        gradient: 'from-blue-500/30 to-indigo-600/10',
        border: 'border-blue-500/40',
      },
    ],
  },
  {
    id: 'view',
    label: 'Visualização 3D',
    cards: [
      {
        key: 'viewer3D',
        title: 'Visualizador 360°',
        desc: 'Gira e explora a casa em 3D',
        icon: <Eye />,
        gradient: 'from-emerald-500/30 to-teal-600/10',
        border: 'border-emerald-500/40',
      },
      {
        key: 'blender',
        title: 'Editor Blender',
        desc: 'Gizmos para mover/rotacionar',
        icon: <Move />,
        gradient: 'from-blue-500/30 to-purple-600/10',
        border: 'border-blue-500/40',
        badge: 'NOVO',
        badgeColor: 'bg-blue-500/20 text-blue-300',
      },
      {
        key: 'precise',
        title: 'Blockout Preciso',
        desc: 'Paredes alinhadas + 5 cômodos',
        icon: <Grid3x3 />,
        gradient: 'from-green-500/30 to-emerald-600/10',
        border: 'border-green-500/40',
        badge: 'CORRIGIDO',
        badgeColor: 'bg-green-500/20 text-green-300',
      },
    ],
  },
  {
    id: 'data',
    label: 'Dados & Visualização',
    cards: [
      {
        key: 'library',
        title: 'Biblioteca',
        desc: 'Salva e carrega plantas',
        icon: <Library />,
        gradient: 'from-cyan-500/30 to-blue-600/10',
        border: 'border-cyan-500/40',
      },
      {
        key: 'gaussian',
        title: 'Gaussian Splatting',
        desc: 'Imagem → PLY/GLB + Pin Tracker',
        icon: <Sparkles />,
        gradient: 'from-pink-500/30 to-rose-600/10',
        border: 'border-pink-500/40',
      },
    ],
  },
  {
    id: 'diag',
    label: 'Diagnóstico',
    cards: [
      {
        key: 'tester',
        title: 'Teste Automático',
        desc: '18 verificações do sistema',
        icon: <TestTube2 />,
        gradient: 'from-amber-500/30 to-orange-600/10',
        border: 'border-amber-500/40',
      },
      {
        key: 'pipeline',
        title: 'Pipeline Completo',
        desc: '2D → 3D → AR hierarquia',
        icon: <GitBranch />,
        gradient: 'from-violet-500/30 to-purple-600/10',
        border: 'border-violet-500/40',
      },
      {
        key: 'debug',
        title: 'Debug Analyzer',
        desc: 'Logs e diagnóstico detalhado',
        icon: <Bug />,
        gradient: 'from-red-500/30 to-orange-600/10',
        border: 'border-red-500/40',
      },
    ],
  },
];

export default function App() {
  const [view, setView] = useState<ViewKey | null>(null);
  const [showPermissions, setShowPermissions] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    setProcessedPlan,
    setModel3d,
    setCapturedImage,
    processedPlan,
  } = useStore();

  // ============================================
  // UPLOAD + DETECT WALLS (OpenCV)
  // ============================================
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setSuccessMsg(null);
    setProcessingStatus('Carregando arquivo...');

    try {
      // 1. Converte PDF/PNG/JPG para imagem
      const { convertFileToImage } = await import('./lib/pdfConverter');
      const imageDataUrl = await convertFileToImage(file);

      // 2. Carrega como HTMLImageElement
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const imgEl = new Image();
        imgEl.onload = () => resolve(imgEl);
        imgEl.onerror = () => reject(new Error('Falha ao carregar imagem'));
        imgEl.src = imageDataUrl;
      });

      setCapturedImage(imageDataUrl);
      setProcessingStatus('OpenCV detectando paredes...');

      // 3. Parser OpenCV.js (HoughLinesP + Canny + findContours)
      const result = await openCVArchitecturalParser.parse(img, {
        onProgress: (msg) => setProcessingStatus(msg),
      });

      if (!result.success || result.walls.length < 4) {
        setError(
          `Não foi possível detectar paredes suficientes. ` +
          `Detectadas: ${result.walls.length}, cômodos: ${result.rooms.length}. ` +
          `Tente uma imagem com paredes em cor forte (vermelho).`
        );
        setIsProcessing(false);
        return;
      }

      setProcessingStatus(`${result.walls.length} paredes, ${result.rooms.length} cômodos detectados`);

      // 4. Constrói modelo 3D
      const cx = result.plan!.totalWidth / 2;
      const cz = result.plan!.totalDepth / 2;
      const ppm = img.width / result.plan!.totalWidth;

      // Converte para SemanticObjects
      const newObjects: any[] = [];
      result.walls.forEach((w, i) => {
        const sx = (w.sourceStart?.x || 0) / ppm - cx;
        const sz = (w.sourceStart?.y || 0) / ppm - cz;
        const ex = (w.sourceEnd?.x || 0) / ppm - cx;
        const ez = (w.sourceEnd?.y || 0) / ppm - cz;
        const length = Math.sqrt((ex-sx)**2 + (ez-sz)**2);
        const isExt = w.length > Math.max(result.plan!.totalWidth, result.plan!.totalDepth) * 0.6;
        newObjects.push({
          id: `wall_${i}`,
          type: 'wall',
          source_2d: w.id,
          position: [(sx+ex)/2, 1.4, (sz+ez)/2],
          rotation: [0, -Math.atan2(ez-sz, ex-sx), 0],
          dimensions: { length, thickness: isExt ? 0.25 : 0.15, height: 2.80 },
          confidence: 0.9,
          editable: true,
          layer: LAYERS.WALLS,
          isExterior: isExt,
        });
      });

      // Cômodos com piso e teto
      const detectedRooms: RoomData[] = result.rooms.map((r, i) => ({
        id: r.id,
        name: r.name || `Cômodo ${i+1}`,
        type: 'unknown' as any,
        walls: [],
        polygon: r.floor.map(p => ({ x: p.x, z: p.y })),
        area: r.area,
        center: { x: r.center.x, z: r.center.y },
      }));

      detectedRooms.forEach(room => {
        // Piso do cômodo
        newObjects.push({
          id: `floor_${room.id}`,
          type: 'floor',
          source_2d: room.id,
          position: [room.center.x, 0.01, room.center.z],
          rotation: [0, 0, 0],
          dimensions: { length: Math.sqrt(room.area)*1.2, thickness: Math.sqrt(room.area)*1.2, height: 0.02 },
          confidence: 1,
          editable: true,
          layer: LAYERS.FLOORS,
          roomId: room.id,
          name: room.name,
        });
        // Teto do cômodo
        newObjects.push({
          id: `ceiling_${room.id}`,
          type: 'ceiling',
          source_2d: room.id,
          position: [room.center.x, 2.80, room.center.z],
          rotation: [0, 0, 0],
          dimensions: { length: Math.sqrt(room.area)*1.2, thickness: Math.sqrt(room.area)*1.2, height: 0.02 },
          confidence: 1,
          editable: true,
          layer: LAYERS.CEILINGS,
          roomId: room.id,
          name: room.name,
        });
      });

      // Piso único embaixo (cobre a casa toda)
      newObjects.push({
        id: 'ground_floor',
        type: 'floor',
        source_2d: 'ground',
        position: [0, -0.01, 0],
        rotation: [0, 0, 0],
        dimensions: { length: result.plan!.totalWidth + 0.5, thickness: result.plan!.totalDepth + 0.5, height: 0.02 },
        confidence: 1,
        editable: true,
        layer: LAYERS.FLOORS,
        name: 'Piso Térreo',
      });

      setProcessedPlan(result.plan! as any);
      setModel3d({ objects: newObjects, rooms: detectedRooms } as any);
      setSuccessMsg(`✅ ${result.walls.length} paredes + ${result.rooms.length} cômodos em ${result.plan!.totalWidth.toFixed(1)}×${result.plan!.totalDepth.toFixed(1)}m`);
      setIsProcessing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setIsProcessing(false);
    } finally {
      // Limpa input para permitir re-upload do mesmo arquivo
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [setCapturedImage, setProcessedPlan, setModel3d]);

  const handleReset = useCallback(() => {
    setProcessedPlan(null);
    setModel3d(null);
    setCapturedImage(null);
    setError(null);
    setSuccessMsg(null);
  }, [setProcessedPlan, setModel3d, setCapturedImage]);

  if (showPermissions) {
    return (
      <PermissionHandler
        onPermissionsGranted={() => setShowPermissions(false)}
        onSkip={() => setShowPermissions(false)}
      />
    );
  }

  // Routers
  if (view === 'liveAR') return <LiveARCapture onClose={() => setView(null)} />;
  if (view === 'editor3D') return <FloorPlanEditor3D onClose={() => setView(null)} />;
  if (view === 'viewer3D') return <FloorPlan3DViewer onClose={() => setView(null)} />;
  if (view === 'library') return <PlantLibrary onClose={() => setView(null)} />;
  if (view === 'gaussian') return <GaussianSplattingViewer onClose={() => setView(null)} />;
  if (view === 'blender') return <BlenderStyleEditor onClose={() => setView(null)} />;
  if (view === 'precise') return <PreciseBlockoutEditor onClose={() => setView(null)} />;
  if (view === 'tester') return <SystemTester onClose={() => setView(null)} />;
  if (view === 'pipeline') {
    return (
      <PipelineView
        onClose={() => setView(null)}
        onNavigate={(stage) => {
          setView(null);
          if (stage === 'ar') setView('liveAR');
          else if (stage === 'editor') setView('editor3D');
        }}
      />
    );
  }
  if (view === 'debug') return <DebugAnalyzer />;

  return (
    <div className="app-container h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white">
      {/* HEADER */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900/80 backdrop-blur-lg border-b border-slate-800/60 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none">Floor3D</h1>
            <p className="text-[10px] text-slate-400 leading-none mt-1">Planta → 3D + AR</p>
          </div>
        </div>
        {processedPlan && (
          <button
            onClick={handleReset}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
            title="Nova planta"
          >
            <RefreshCw className="w-5 h-5 text-slate-400" />
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto">
        {/* HERO / UPLOAD AREA */}
        <section className="px-4 pt-4 pb-2">
          <div className="max-w-2xl mx-auto">
            {/* Status messages */}
            {error && (
              <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}
            {successMsg && (
              <div className="mb-3 p-3 bg-green-500/10 border border-green-500/30 rounded-xl flex items-start gap-2">
                <Sparkle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-green-200">{successMsg}</p>
              </div>
            )}

            {/* HERO CARD: Upload */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-500/20 via-blue-600/10 to-purple-600/20 border border-cyan-500/30 p-5 mb-3">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.15),transparent_60%)]" />
              <div className="relative flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-cyan-500/30">
                  {isProcessing ? (
                    <Activity className="w-7 h-7 text-white animate-pulse" />
                  ) : (
                    <Upload className="w-7 h-7 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-xl mb-1">
                    {isProcessing ? processingStatus || 'Processando...' : 'Importar Planta 2D'}
                  </h2>
                  <p className="text-sm text-slate-300 mb-3">
                    {isProcessing
                      ? 'Aguarde — OpenCV detectando paredes e cômodos'
                      : 'Arraste ou toque — converte PNG/JPG/PDF em casa 3D'}
                  </p>
                  {!isProcessing && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="plant-upload"
                      />
                      <label
                        htmlFor="plant-upload"
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded-xl font-semibold text-sm cursor-pointer shadow-lg shadow-cyan-500/20 transition-all active:scale-95"
                      >
                        <Upload className="w-4 h-4" />
                        Escolher arquivo
                      </label>
                    </>
                  )}
                  {isProcessing && (
                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden mt-2">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse w-2/3" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* AR ao Vivo - destaque */}
            <button
              onClick={() => setView('liveAR')}
              className="group w-full relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 p-4 transition-all active:scale-[0.98] shadow-lg shadow-purple-500/20 mb-3"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.15),transparent_50%)]" />
              <div className="relative flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                  <Scan className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="font-bold text-white text-lg">AR ao Vivo</h3>
                  <p className="text-xs text-white/80">Câmera em tempo real com ARCore</p>
                </div>
                <ChevronRight className="w-5 h-5 text-white/80 group-hover:translate-x-1 transition-transform" />
                <span className="px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-bold text-white">NOVO</span>
              </div>
            </button>
          </div>
        </section>

        {/* MODE GRID (cards) */}
        <section className="px-4 pb-6">
          <div className="max-w-2xl mx-auto space-y-5">
            {MODE_GROUPS.filter(g => g.id !== 'capture').map((group) => (
              <div key={group.id}>
                <div className="flex items-center gap-2 mb-2.5 px-1">
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    {group.label}
                  </h3>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {group.cards.map((card) => (
                    <button
                      key={card.key}
                      onClick={() => setView(card.key)}
                      className={`group relative overflow-hidden text-left rounded-2xl p-3.5 bg-gradient-to-br ${card.gradient} border ${card.border} hover:scale-[1.02] active:scale-[0.98] transition-all backdrop-blur-sm`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="w-9 h-9 rounded-xl bg-slate-900/60 backdrop-blur flex items-center justify-center text-white [&>svg]:w-5 [&>svg]:h-5">
                          {card.icon}
                        </div>
                        {card.badge && (
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${card.badgeColor}`}>
                            {card.badge}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-sm text-white mb-0.5 leading-tight">
                        {card.title}
                      </h3>
                      <p className="text-[11px] text-slate-300 leading-snug">
                        {card.desc}
                      </p>
                      <ChevronRight className="absolute right-2 bottom-2 w-4 h-4 text-white/30 group-hover:text-white/70 group-hover:translate-x-0.5 transition-all" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="h-4" />
      </main>
    </div>
  );
}
