import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  RefreshCw,
  Eye,
  Library,
  Sparkles,
  Grid3x3,
  Building2,
  AlertCircle,
  Sparkle,
  Activity,
  ChevronRight,
  Bot,
  Key,
  Settings as SettingsIcon,
  Cloud,
} from 'lucide-react';
import { FloorPlan3DViewer } from './components/FloorPlan3DViewer';
import { PermissionHandler } from './components/PermissionHandler';
import { PlantLibrary } from './components/PlantLibrary';
import { GaussianSplattingViewer } from './components/GaussianSplattingViewer';
import { PreciseBlockoutEditor } from './components/PreciseBlockoutEditor';
import { GeminiChatPanel } from './components/GeminiChatPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { AuthScreen } from './components/AuthScreen';
import { useStore } from './store';
import { axisLineParser } from './floorplan/axisLineParser';
import { simpleFallbackParser } from './floorplan/simpleFallbackParser';
import { geminiChat, hasApiKey, type GeminiFloorPlan } from './lib/geminiChat';
import { LAYERS } from './floorplan/typesExtensions';
import type { RoomData } from './floorplan/typesExtensions';
import { Lock } from 'lucide-react';
import './App.css';

type ViewKey = 'viewer3D' | 'precise' | 'library' | 'gaussian' | 'aiChat' | 'settings' | 'auth';

interface ModeCard {
  key: ViewKey;
  title: string;
  desc: string;
  icon: React.ReactNode;
  gradient: string;
  border: string;
  available: boolean;
}

const MODE_CARDS: ModeCard[] = [
  {
    key: 'aiChat',
    title: 'Chat com IA',
    desc: 'Em breve',
    icon: <Bot />,
    gradient: 'from-pink-500/20 to-purple-600/5',
    border: 'border-pink-500/20',
    available: false,
  },
  {
    key: 'viewer3D',
    title: 'Visualizador 360°',
    desc: 'Gira e explora a casa 3D',
    icon: <Eye />,
    gradient: 'from-emerald-500/30 to-teal-600/10',
    border: 'border-emerald-500/40',
    available: true,
  },
  {
    key: 'precise',
    title: 'Blockout Preciso',
    desc: 'Em breve',
    icon: <Grid3x3 />,
    gradient: 'from-green-500/20 to-emerald-600/5',
    border: 'border-green-500/20',
    available: false,
  },
  {
    key: 'library',
    title: 'Biblioteca',
    desc: 'Plantas organizadas em pastas',
    icon: <Library />,
    gradient: 'from-cyan-500/30 to-blue-600/10',
    border: 'border-cyan-500/40',
    available: true,
  },
  {
    key: 'gaussian',
    title: 'Gaussian Splatting',
    desc: 'Em breve',
    icon: <Sparkles />,
    gradient: 'from-amber-500/20 to-orange-600/5',
    border: 'border-amber-500/20',
    available: false,
  },
];

export default function App() {
  const [view, setView] = useState<ViewKey | null>(null);
  const [showPermissions, setShowPermissions] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const {
    setProcessedPlan,
    setModel3d,
    setCapturedImage,
    processedPlan,
  } = useStore();

  // Check if API key exists
  useEffect(() => {
    setAiEnabled(hasApiKey());
  }, [view]);

  // ============================================
  // CONVERTE PLANO GEMINI → MODELO 3D
  // ============================================
  const applyGeminiPlan = useCallback((plan: GeminiFloorPlan) => {
    const cx = plan.widthMeters / 2;
    const cz = plan.heightMeters / 2;

    const newObjects: any[] = [];
    let extCount = 0, intCount = 0;
    plan.walls.forEach((w, i) => {
      const sx = w.start.x - cx;
      const sz = w.start.y - cz;
      const ex = w.end.x - cx;
      const ez = w.end.y - cz;
      const length = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
      if (length < 0.1) return; // ignora paredes degeneradas
      if (w.type === 'exterior') extCount++; else intCount++;
      newObjects.push({
        id: `wall_${i}`,
        type: 'wall',
        source_2d: `gemini_${i}`,
        position: [(sx + ex) / 2, 1.4, (sz + ez) / 2],
        rotation: [0, -Math.atan2(ez - sz, ex - sx), 0],
        dimensions: { length, thickness: w.thickness, height: 2.80 },
        confidence: 1.0,
        editable: true,
        layer: LAYERS.WALLS,
        isExterior: w.type === 'exterior',
      });
    });

    const detectedRooms: RoomData[] = plan.rooms.map((r, i) => {
      const center = r.polygon.reduce(
        (acc, p) => ({ x: acc.x + p.x, z: acc.z + p.y }),
        { x: 0, z: 0 }
      );
      if (r.polygon.length > 0) {
        center.x /= r.polygon.length;
        center.z /= r.polygon.length;
      }
      return {
        id: `room_${i}`,
        name: r.name,
        type: r.type as any,
        walls: [],
        polygon: r.polygon.map(p => ({ x: p.x - cx, z: p.y - cz })),
        area: r.area,
        center: { x: center.x - cx, z: center.z - cz },
      };
    });

    detectedRooms.forEach(room => {
      const size = Math.max(2, Math.sqrt(Math.max(1, room.area)) * 1.2);
      newObjects.push({
        id: `floor_${room.id}`,
        type: 'floor',
        source_2d: room.id,
        position: [room.center.x, 0.01, room.center.z],
        rotation: [0, 0, 0],
        dimensions: { length: size, thickness: size, height: 0.02 },
        confidence: 1,
        editable: true,
        layer: LAYERS.FLOORS,
        roomId: room.id,
        name: room.name,
      });
      newObjects.push({
        id: `ceiling_${room.id}`,
        type: 'ceiling',
        source_2d: room.id,
        position: [room.center.x, 2.80, room.center.z],
        rotation: [0, 0, 0],
        dimensions: { length: size, thickness: size, height: 0.02 },
        confidence: 1,
        editable: true,
        layer: LAYERS.CEILINGS,
        roomId: room.id,
        name: room.name,
      });
    });

    newObjects.push({
      id: 'ground_floor',
      type: 'floor',
      source_2d: 'ground',
      position: [0, -0.01, 0],
      rotation: [0, 0, 0],
      dimensions: { length: plan.widthMeters + 0.5, thickness: plan.heightMeters + 0.5, height: 0.02 },
      confidence: 1,
      editable: true,
      layer: LAYERS.FLOORS,
      name: 'Piso Térreo',
    });

    const syntheticPlan = {
      projectName: 'Planta IA',
      totalArea: plan.widthMeters * plan.heightMeters,
      totalWidth: plan.widthMeters,
      totalDepth: plan.heightMeters,
      wallHeight: 2.80,
      floors: 1,
      vertices: [],
      walls: plan.walls.map((w, i) => ({
        id: `W${i}`,
        length: Math.sqrt((w.end.x - w.start.x) ** 2 + (w.end.y - w.start.y) ** 2),
        thickness: w.thickness,
        height: 2.80,
        type: w.type,
        sourceStart: { x: 0, y: 0 },
        sourceEnd: { x: 0, y: 0 },
      })),
      dimensions: [],
      rooms: plan.rooms.map((r, i) => ({
        id: `R${i}`,
        name: r.name,
        type: r.type,
        walls: [],
        floor: r.polygon,
        area: r.area,
        center: { x: 0, y: 0 },
      })),
    };

    setProcessedPlan(syntheticPlan as any);
    setModel3d({ objects: newObjects, rooms: detectedRooms } as any);
    setSuccessMsg(`✅ ${extCount} paredes externas + ${intCount} internas, ${plan.rooms.length} cômodos em ${plan.widthMeters}×${plan.heightMeters}m`);
  }, [setProcessedPlan, setModel3d]);

  // ============================================
  // UPLOAD + DETECT: Gemini AI (com fallbacks)
  // ============================================
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setSuccessMsg(null);
    setProcessingStatus('Carregando arquivo...');

    // Salva a imagem para o chat (sempre, mesmo se parsing falhar)
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (typeof window !== 'undefined' && dataUrl) {
        window.localStorage.setItem('floorvision_last_image', dataUrl);
        setPendingImage(dataUrl);
      }
    };
    reader.readAsDataURL(file);

    try {
      const { convertFileToImage } = await import('./lib/pdfConverter');
      const imageDataUrl = await convertFileToImage(file);

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const imgEl = new Image();
        imgEl.onload = () => resolve(imgEl);
        imgEl.onerror = () => reject(new Error('Falha ao carregar imagem'));
        imgEl.src = imageDataUrl;
      });

      setCapturedImage(imageDataUrl);

      // ESTRATÉGIA 1: Gemini AI (se tem chave)
      if (hasApiKey()) {
        try {
          setProcessingStatus('Gemini AI analisando...');
          const plan = await geminiChat.analyzeImage(imageDataUrl);
          if (plan && plan.walls.length >= 4) {
            applyGeminiPlan(plan);
            setIsProcessing(false);
            return;
          }
        } catch (e: any) {
          console.warn('Gemini falhou:', e);
          // Mostra erro mas continua com fallback
          if (e.message && !e.message.includes('NO_API_KEY')) {
            setError(`IA: ${e.message}. Usando parser local...`);
          }
        }
      } else {
        setError(null);
      }

      // ESTRATÉGIA 2: Parser local (axis-line)
      setProcessingStatus('Parser local (offline)...');
      const result = await axisLineParser.parse(img, {
        onProgress: (msg) => setProcessingStatus(msg),
      });

      if (result.success && result.walls.length >= 4) {
        const cx = result.plan!.totalWidth / 2;
        const cz = result.plan!.totalDepth / 2;
        const ppm = img.width / result.plan!.totalWidth;
        const plan: GeminiFloorPlan = {
          widthMeters: result.plan!.totalWidth,
          heightMeters: result.plan!.totalDepth,
          walls: result.walls.map(w => ({
            start: { x: (w.sourceStart?.x || 0) / ppm - cx + cx, y: (w.sourceStart?.y || 0) / ppm - cz + cz },
            end: { x: (w.sourceEnd?.x || 0) / ppm - cx + cx, y: (w.sourceEnd?.y || 0) / ppm - cz + cz },
            thickness: w.thickness,
            type: w.type === 'exterior' ? 'exterior' : 'interior',
          })),
          rooms: result.rooms.map(r => ({
            name: r.name || 'Cômodo',
            type: 'unknown',
            polygon: r.floor.map(p => ({ x: p.x + cx, y: p.y + cz })),
            area: r.area,
          })),
          notes: 'Detectado por parser local (offline)',
        };
        applyGeminiPlan(plan);
        setIsProcessing(false);
        return;
      }

      // ESTRATÉGIA 3: Fallback simples
      setProcessingStatus('Estrutura padrão...');
      const fallback = await simpleFallbackParser.parse(img);
      if (fallback.success) {
        const plan: GeminiFloorPlan = {
          widthMeters: fallback.plan!.totalWidth,
          heightMeters: fallback.plan!.totalDepth,
          walls: fallback.walls.map(w => ({
            start: { x: w.sourceStart?.x ?? 0, y: w.sourceStart?.y ?? 0 },
            end: { x: w.sourceEnd?.x ?? 0, y: w.sourceEnd?.y ?? 0 },
            thickness: w.thickness,
            type: w.type === 'exterior' ? 'exterior' : 'interior',
          })),
          rooms: fallback.rooms.map(r => ({
            name: r.name,
            type: 'unknown',
            polygon: r.floor,
            area: r.area,
          })),
          notes: fallback.warnings[0] || 'Estrutura padrão gerada',
        };
        applyGeminiPlan(plan);
        setSuccessMsg(`ℹ️ Estrutura padrão (6×8m): ${plan.walls.length} paredes, ${plan.rooms.length} cômodos. Configure a chave Gemini para melhor detecção.`);
      }
      setIsProcessing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setIsProcessing(false);
    }
  }, [setCapturedImage, setProcessedPlan, setModel3d, applyGeminiPlan]);

  const handleReset = useCallback(() => {
    setProcessedPlan(null);
    setModel3d(null);
    setCapturedImage(null);
    setPendingImage(null);
    setError(null);
    setSuccessMsg(null);
    geminiChat.reset();
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
  if (view === 'viewer3D') return <FloorPlan3DViewer onClose={() => setView(null)} />;
  if (view === 'library') return <PlantLibrary onClose={() => setView(null)} />;
  if (view === 'gaussian') return <GaussianSplattingViewer onClose={() => setView(null)} />;
  if (view === 'precise') return <PreciseBlockoutEditor onClose={() => setView(null)} />;
  if (view === 'settings') return <SettingsPanel onClose={() => setView(null)} />;
  if (view === 'auth') return <AuthScreen onClose={() => setView(null)} />;
  if (view === 'aiChat') {
    const img = pendingImage || (typeof window !== 'undefined' ? window.localStorage.getItem('floorvision_last_image') : null);
    if (img) {
      return (
        <GeminiChatPanel
          initialImage={img}
          onClose={() => setView(null)}
          onApply={(plan) => { applyGeminiPlan(plan); setView(null); }}
        />
      );
    }
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center p-6">
        <Bot className="w-16 h-16 text-pink-400 mb-4" />
        <h2 className="text-white text-lg font-bold mb-2">Chat com IA</h2>
        <p className="text-slate-400 text-sm text-center mb-2 max-w-sm">
          Importe uma planta 2D para começar.
        </p>
        {!aiEnabled && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2 max-w-sm">
            <Key className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200">
              <strong>Sem chave Gemini:</strong> o app usará o parser local. Configure a chave em <button onClick={() => setView('settings')} className="underline">Configurações</button> para análise com IA.
            </div>
          </div>
        )}
        <input
          ref={chatFileInputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={handleFileUpload}
          className="hidden"
          id="plant-upload-chat"
        />
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <label
            htmlFor="plant-upload-chat"
            className="px-5 py-3 bg-cyan-500 hover:bg-cyan-400 rounded-xl text-white text-sm font-semibold cursor-pointer text-center"
          >
            <Upload className="inline w-4 h-4 mr-2" />
            Importar planta
          </label>
          <button
            onClick={() => setView('settings')}
            className="px-5 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-sm flex items-center justify-center gap-2"
          >
            <Key className="w-4 h-4" />
            Configurar chave Gemini
          </button>
          <button
            onClick={() => setView(null)}
            className="px-5 py-2 text-slate-400 hover:text-slate-300 text-sm"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

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
            <p className="text-[10px] text-slate-400 leading-none mt-1">Planta → 3D</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView('auth')}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
            title="Conta Supabase"
          >
            <Cloud className="w-5 h-5 text-slate-400" />
          </button>
          <button
            onClick={() => setView('settings')}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors relative"
            title="Configurações Gemini"
          >
            <SettingsIcon className="w-5 h-5 text-slate-400" />
            {aiEnabled && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-400 rounded-full" />
            )}
          </button>
          {processedPlan && (
            <button
              onClick={handleReset}
              className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
              title="Nova planta"
            >
              <RefreshCw className="w-5 h-5 text-slate-400" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {/* HERO: UPLOAD */}
        <section className="px-4 pt-4 pb-2">
          <div className="max-w-2xl mx-auto">
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

            {!aiEnabled && (
              <div className="mb-3 p-3 bg-gradient-to-r from-amber-500/10 to-pink-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2">
                <Key className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-100 flex-1">
                  <strong>Análise com IA desativada.</strong> O app usará o parser local (menos preciso).
                  <button onClick={() => setView('settings')} className="ml-2 underline text-amber-300">Configurar chave</button>
                </div>
              </div>
            )}

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
                      ? 'Aguarde — processando imagem'
                      : aiEnabled
                        ? 'Gemini AI analisa — depois você pode refinar no chat'
                        : 'Parser local detecta paredes e cômodos'}
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
          </div>
        </section>

        {/* MODE GRID: 5 cards */}
        <section className="px-4 pb-6">
          <div className="max-w-2xl mx-auto space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-2.5 px-1">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Modos
                </h3>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {MODE_CARDS.map((card) => (
                  <button
                    key={card.key}
                    onClick={() => card.available && setView(card.key)}
                    disabled={!card.available}
                    className={`group relative overflow-hidden text-left rounded-2xl p-3.5 bg-gradient-to-br ${card.gradient} border ${card.border} ${card.available ? 'hover:scale-[1.02] active:scale-[0.98] cursor-pointer' : 'opacity-50 cursor-not-allowed'} transition-all backdrop-blur-sm`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-9 h-9 rounded-xl bg-slate-900/60 backdrop-blur flex items-center justify-center text-white [&>svg]:w-5 [&>svg]:h-5">
                        {card.icon}
                      </div>
                      {!card.available && (
                        <Lock className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      {card.key === 'aiChat' && aiEnabled && card.available && (
                        <span className="px-1.5 py-0.5 bg-emerald-500/30 rounded-full text-[9px] font-bold text-emerald-300">IA</span>
                      )}
                    </div>
                    <h3 className="font-bold text-sm text-white mb-0.5 leading-tight">
                      {card.title}
                    </h3>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      {card.available ? card.desc : 'Em breve'}
                    </p>
                    {card.available && (
                      <ChevronRight className="absolute right-2 bottom-2 w-4 h-4 text-white/30 group-hover:text-white/70 group-hover:translate-x-0.5 transition-all" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="h-4" />
      </main>
    </div>
  );
}
