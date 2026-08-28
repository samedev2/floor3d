import { useState, useEffect, useCallback } from 'react';
import { Sparkles } from 'lucide-react';

interface PermissionHandlerProps {
  onPermissionsGranted: () => void;
  onSkip: () => void;
}

const STORAGE_KEY = 'floorvision_permissions_accepted';

/**
 * Tela de boas-vindas leve.
 * NAO solicita permissões no início (camera só quando precisar).
 * Só aparece uma vez — depois disso o app vai direto para o menu.
 */
export function PermissionHandler({ onPermissionsGranted }: PermissionHandlerProps) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verifica cache - se já aceitou/skipou antes, pula direto
    const accepted = localStorage.getItem(STORAGE_KEY);
    if (accepted === 'true') {
      onPermissionsGranted();
    } else {
      setVisible(true);
    }
    setLoading(false);
  }, [onPermissionsGranted]);

  const handleAccept = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
    onPermissionsGranted();
  }, [onPermissionsGranted]);

  if (loading || !visible) return null;

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-6 z-50">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30 mb-6">
        <Sparkles className="w-10 h-10 text-white" />
      </div>

      <h1 className="text-3xl font-bold text-white mb-2 text-center">
        Floor3D
      </h1>
      <p className="text-slate-400 text-center mb-8 max-w-sm">
        Transforme plantas 2D em modelos 3D com inteligência artificial
      </p>

      <div className="w-full max-w-sm space-y-3 mb-8">
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xl">
            📐
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Importar planta 2D</p>
            <p className="text-slate-400 text-xs">PNG, JPG ou PDF</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl">
            🎲
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Visualizar 3D em 360°</p>
            <p className="text-slate-400 text-xs">Gire, explore, entenda o espaço</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 text-xl">
            📁
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Salvar em pastas</p>
            <p className="text-slate-400 text-xs">Organize suas plantas por tipo</p>
          </div>
        </div>
      </div>

      <button
        onClick={handleAccept}
        className="w-full max-w-sm py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded-2xl text-white font-bold text-lg shadow-lg shadow-cyan-500/20 transition-all active:scale-95"
      >
        Começar
      </button>

      <p className="text-slate-500 text-xs text-center mt-4 max-w-xs">
        Câmera e outras permissões serão solicitadas apenas quando você usar a função que precisa delas
      </p>
    </div>
  );
}
