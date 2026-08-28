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
  Calculator,
} from 'lucide-react';
import { FloorPlan3DViewer } from './components/FloorPlan3DViewer';
import { PermissionHandler } from './components/PermissionHandler';
import { PlantLibrary } from './components/PlantLibrary';
import { GaussianSplattingViewer } from './components/GaussianSplattingViewer';
import { PreciseBlockoutEditor } from './components/PreciseBlockoutEditor';
import { GeminiChatPanel } from './components/GeminiChatPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { AuthScreen } from './components/AuthScreen';
import { MaterialEstimate } from './components/MaterialEstimate';
import { useStore } from './store';
import { geminiChat, hasApiKey, type GeminiFloorPlan } from './lib/geminiChat';
import { usePlantImport } from './lib/usePlantImport';
import { planToModel3D, planToFloorPlan } from './lib/plantImportCore';
import { Lock } from 'lucide-react';
import './App.css';

type ViewKey = 'viewer3D' | 'precise' | 'library' | 'gaussian' | 'aiChat' | 'settings' | 'auth' | 'materials';

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
    desc: 'Refine a planta com linguagem natural',
    icon: <Bot />,
    gradient: 'from-pink-500/30 to-purple-600/10',
    border: 'border-pink-500/40',
    available: true,
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
    key: 'materials',
    title: 'Materiais de Obra',
    desc: 'Conta tijolos, cimento, areia e mais',
    icon: <Calculator />,
    gradient: 'from-orange-500/30 to-amber-600/10',
    border: 'border-orange-500/40',
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
  // HOOK UNIFICADO DE IMPORT
  // ============================================
  const {
    importFile,
    isImporting,
    progress,
    error: importError,
    lastResult,
  } = usePlantImport({
    onSuccess: (result, model3d, floorPlan) => {
      setProcessedPlan(floorPlan);
      setModel3d(model3d);
      setCapturedImage(result.imageDataUrl);
    },
    onError: () => {
      // erro já é mostrado via importError state
    },
  });

  // Handler unificado: usado tanto pelo botão azul quanto pelos submenus
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset do input pra permitir re-upload do mesmo arquivo
    e.target.value = '';
    await importFile(file);
  }, [importFile]);

  const handleReset = useCallback(() => {
    setProcessedPlan(null);
    setModel3d(null);
    setCapturedImage(null);
    geminiChat.reset();
  }, [setProcessedPlan, setModel3d, setCapturedImage]);

  // Aplica um plano vindo do GeminiChatPanel (mesma lógica do hook)
  const applyPlanFromChat = useCallback((plan: GeminiFloorPlan) => {
    const model3d = planToModel3D(plan);
    const floorPlan = planToFloorPlan(plan);
    setProcessedPlan(floorPlan);
    setModel3d(model3d);
  }, [setProcessedPlan, setModel3d]);

  // Helper: pendingImage vem do lastResult do hook
  const pendingImage = lastResult?.imageDataUrl ?? null;

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
  if (view === 'materials') return <MaterialEstimate onClose={() => setView(null)} />;
  if (view === 'aiChat') {
    const img = pendingImage || (typeof window !== 'undefined' ? window.localStorage.getItem('floorvision_last_image') : null);
    if (img) {
      return (
        <GeminiChatPanel
          initialImage={img}
          onClose={() => setView(null)}
          onApply={(plan) => { applyPlanFromChat(plan); setView(null); }}
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
            {importError && (
              <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{importError}</p>
              </div>
            )}
            {lastResult && lastResult.success && !isImporting && (
              <div className="mb-3 p-3 bg-green-500/10 border border-green-500/30 rounded-xl flex items-start gap-2">
                <Sparkle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-green-200 flex-1">
                  <strong>✅ {lastResult.stats.wallCount} paredes</strong> ({lastResult.stats.externalWalls} externas + {lastResult.stats.internalWalls} internas),
                  {' '}{lastResult.stats.roomCount} cômodos em {lastResult.stats.widthMeters}×{lastResult.stats.heightMeters}m
                  <span className="text-slate-400 text-xs ml-2">
                    via {lastResult.source === 'gemini' ? 'Gemini AI' : lastResult.source === 'parser' ? 'parser local' : 'fallback'}
                  </span>
                </div>
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
                  {isImporting ? (
                    <Activity className="w-7 h-7 text-white animate-pulse" />
                  ) : (
                    <Upload className="w-7 h-7 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-xl mb-1">
                    {isImporting ? (progress?.message || 'Processando...') : 'Importar Planta 2D'}
                  </h2>
                  <p className="text-sm text-slate-300 mb-3">
                    {isImporting
                      ? 'Aguarde — processando imagem'
                      : aiEnabled
                        ? 'Gemini AI analisa — depois você pode refinar no chat'
                        : 'Parser local detecta paredes e cômodos'}
                  </p>
                  {!isImporting && (
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
                  {isImporting && (
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
