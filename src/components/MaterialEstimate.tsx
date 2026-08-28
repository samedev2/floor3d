/**
 * MaterialEstimate - Estimativa de materiais de construção
 *
 * Recebe o `model3d` do store (do último import) e gera uma
 * lista de materiais com quantidade, unidade e descrição.
 *
 * Funcionalidades:
 * - Configuração de tipo de tijolo
 * - Toggle de etapas (reboco, contrapiso, piso, aço)
 * - Tabela por categoria (Estrutura, Alvenaria, etc)
 * - Exportar como texto (clipboard) ou CSV
 * - Compartilhar via Web Share API
 */

import { useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Download, Copy, Share2, Calculator, Package, AlertTriangle } from 'lucide-react';
import { useStore } from '../store';
import {
  estimateMaterials,
  fromModel3D,
  fromAxisParser,
  estimateToText,
  estimateToCSV,
  type BrickType,
  type MaterialEstimate as TMaterialEstimate,
  type MaterialLine,
} from '../lib/materialEstimator';

interface MaterialEstimateProps {
  onClose: () => void;
}

const BRICK_OPTIONS: { value: BrickType; label: string; description: string }[] = [
  { value: 'ceramic-6holes', label: 'Tijolo cerâmico 6 furos', description: '9×14×19cm — mais comum' },
  { value: 'block-ceramic', label: 'Bloco cerâmico', description: '11.5×14×24cm — paredes maiores' },
  { value: 'block-concrete', label: 'Bloco de concreto', description: '14×19×39cm — estrutural' },
];

export function MaterialEstimate({ onClose }: MaterialEstimateProps) {
  const { model3d, processedPlan } = useStore();
  const [brickType, setBrickType] = useState<BrickType>('ceramic-6holes');
  const [includeReboco, setIncludeReboco] = useState(true);
  const [includeContrapiso, setIncludeContrapiso] = useState(true);
  const [includePiso, setIncludePiso] = useState(true);
  const [includeAco, setIncludeAco] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Calcular estimativa
  const estimate = useMemo<TMaterialEstimate | null>(() => {
    if (!model3d && !processedPlan) return null;

    let input;

    if (model3d?.objects) {
      input = fromModel3D(model3d.objects, model3d.rooms || []);
    } else if (processedPlan?.walls) {
      // converte do formato legacy
      input = fromAxisParser(processedPlan.walls, processedPlan.rooms || []);
    } else {
      return null;
    }

    return estimateMaterials({
      ...input,
      brickType,
      includeReboco,
      includeContrapiso,
      includePiso,
      includeAco,
    });
  }, [model3d, processedPlan, brickType, includeReboco, includeContrapiso, includePiso, includeAco]);

  const copyToClipboard = useCallback(async () => {
    if (!estimate) return;
    const text = estimateToText(estimate);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Lista copiada para a área de transferência!');
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch {
      // Fallback: cria textarea e copia
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopyFeedback('Lista copiada!');
        setTimeout(() => setCopyFeedback(null), 3000);
      } catch {
        setCopyFeedback('Não foi possível copiar');
      }
      document.body.removeChild(ta);
    }
  }, [estimate]);

  const downloadCSV = useCallback(() => {
    if (!estimate) return;
    const csv = estimateToCSV(estimate);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `materiais-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [estimate]);

  const shareEstimate = useCallback(async () => {
    if (!estimate) return;
    const text = estimateToText(estimate);
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Estimativa de Materiais',
          text,
        });
      } catch {
        // user cancelou, sem problema
      }
    } else {
      copyToClipboard();
    }
  }, [estimate, copyToClipboard]);

  // Agrupar linhas por categoria
  const byCategory = useMemo(() => {
    if (!estimate) return new Map<string, MaterialLine[]>();
    const map = new Map<string, MaterialLine[]>();
    for (const line of estimate.lines) {
      if (!map.has(line.category)) map.set(line.category, []);
      map.get(line.category)!.push(line);
    }
    return map;
  }, [estimate]);

  // Empty state
  if (!model3d && !processedPlan) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
        <Header onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <Package className="w-16 h-16 text-slate-600 mb-4" />
          <h2 className="text-white text-lg font-bold mb-2">Nenhuma planta carregada</h2>
          <p className="text-slate-400 text-sm max-w-sm">
            Importe uma planta 2D primeiro para gerar a estimativa de materiais.
          </p>
          <button
            onClick={onClose}
            className="mt-4 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 rounded-xl text-white text-sm font-semibold"
          >
            Voltar ao menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      <Header onClose={onClose} />

      {/* Feedback de cópia */}
      {copyFeedback && (
        <div className="absolute top-16 left-0 right-0 mx-4 p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl flex items-center gap-2 z-10">
          <Calculator className="w-4 h-4 text-emerald-400" />
          <p className="text-emerald-200 text-sm">{copyFeedback}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Resumo */}
        {estimate && (
          <div className="px-4 pt-4">
            <div className="max-w-3xl mx-auto">
              <div className="grid grid-cols-3 gap-2 mb-4">
                <Stat label="Paredes" value={`${estimate.totalWallArea.toFixed(1)} m²`} color="orange" />
                <Stat label="Construído" value={`${estimate.totalFloorArea.toFixed(1)} m²`} color="emerald" />
                <Stat label="Perímetro" value={`${estimate.totalPerimetro.toFixed(1)} m`} color="cyan" />
              </div>
            </div>
          </div>
        )}

        {/* Configurações */}
        <section className="px-4">
          <div className="max-w-3xl mx-auto">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">
              Tipo de tijolo
            </h3>
            <div className="space-y-2 mb-4">
              {BRICK_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setBrickType(opt.value)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    brickType === opt.value
                      ? 'bg-orange-500/20 border-orange-500/60'
                      : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-semibold">{opt.label}</p>
                      <p className="text-slate-400 text-xs">{opt.description}</p>
                    </div>
                    {brickType === opt.value && (
                      <div className="w-2 h-2 rounded-full bg-orange-400" />
                    )}
                  </div>
                </button>
              ))}
            </div>

            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">
              Etapas a calcular
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Toggle label="Reboco" enabled={includeReboco} onToggle={() => setIncludeReboco(!includeReboco)} />
              <Toggle label="Contrapiso" enabled={includeContrapiso} onToggle={() => setIncludeContrapiso(!includeContrapiso)} />
              <Toggle label="Piso final" enabled={includePiso} onToggle={() => setIncludePiso(!includePiso)} />
              <Toggle label="Aço estrutural" enabled={includeAco} onToggle={() => setIncludeAco(!includeAco)} />
            </div>
          </div>
        </section>

        {/* Lista de materiais */}
        {estimate && (
          <section className="px-4 pb-4">
            <div className="max-w-3xl mx-auto space-y-3">
              {Array.from(byCategory.entries()).map(([category, items]) => (
                <div key={category}>
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">
                    {category} ({items.length})
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((line, i) => (
                      <div
                        key={i}
                        className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-white text-sm font-semibold flex-1 min-w-0">
                            {line.item}
                          </p>
                          <p className="text-orange-300 text-sm font-bold whitespace-nowrap">
                            {line.quantity < 10
                              ? line.quantity.toFixed(1)
                              : Math.ceil(line.quantity)}
                            <span className="text-slate-400 text-xs font-normal ml-1">
                              {line.unit}
                            </span>
                          </p>
                        </div>
                        <p className="text-slate-400 text-xs leading-snug">
                          {line.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {estimate.warnings.length > 0 && (
                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-200">
                    {estimate.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-center text-xs text-slate-500 mt-4 px-4">
                Total: {estimate.summary.totalItems} itens · {estimate.summary.estimatedWeightKg} kg
              </div>
            </div>
          </section>
        )}

        <div className="h-4" />
      </div>

      {/* Bottom bar: ações */}
      {estimate && (
        <div className="border-t border-slate-800 p-3 bg-slate-900/95 backdrop-blur">
          <div className="max-w-3xl mx-auto grid grid-cols-3 gap-2">
            <button
              onClick={copyToClipboard}
              className="flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-white text-sm"
            >
              <Copy className="w-4 h-4" />
              Copiar
            </button>
            <button
              onClick={downloadCSV}
              className="flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-white text-sm"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              onClick={shareEstimate}
              className="flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 rounded-xl text-white text-sm font-semibold"
            >
              <Share2 className="w-4 h-4" />
              Compartilhar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTES
// ============================================
function Header({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur border-b border-slate-800/60 z-20">
      <button
        onClick={onClose}
        className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
        title="Voltar"
      >
        <ArrowLeft className="w-5 h-5 text-slate-300" />
      </button>
      <div className="flex-1 min-w-0">
        <h1 className="font-bold text-white text-base leading-none">Materiais de Obra</h1>
        <p className="text-[10px] text-slate-400 leading-none mt-1">
          Estimativa automática de materiais
        </p>
      </div>
      <Calculator className="w-6 h-6 text-orange-400" />
    </header>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: 'orange' | 'emerald' | 'cyan' }) {
  const colors = {
    orange: 'from-orange-500/20 to-amber-600/5 border-orange-500/30 text-orange-300',
    emerald: 'from-emerald-500/20 to-teal-600/5 border-emerald-500/30 text-emerald-300',
    cyan: 'from-cyan-500/20 to-blue-600/5 border-cyan-500/30 text-cyan-300',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-3 text-center`}>
      <p className={`text-base font-bold ${colors[color].split(' ').pop()}`}>{value}</p>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function Toggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
        enabled
          ? 'bg-emerald-500/20 border-emerald-500/40'
          : 'bg-slate-800/50 border-slate-700'
      }`}
    >
      <span className="text-white text-sm">{label}</span>
      <div className={`w-9 h-5 rounded-full p-0.5 transition-all ${enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
        <div
          className={`w-4 h-4 rounded-full bg-white transition-all ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  );
}
