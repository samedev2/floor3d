/**
 * MaterialEstimate - Estimativa de materiais de construção
 *
 * Melhorias UI/UX em v2.1.2:
 * - Skeleton de loading
 * - Accordion por categoria (economiza espaço)
 * - Resumo executivo com custos estimados
 * - Cards redesenhados com ícones por categoria
 * - Hierarquia visual melhorada
 */

import { useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Download, Copy, Share2, Calculator,
  Package, AlertTriangle, ChevronDown, ChevronUp,
  Layers, Home, Ruler, DollarSign, Shield, Paintbrush,
  Grid3X3, Zap, DoorOpen, Wind
} from 'lucide-react';
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

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Estrutura': <Shield className="w-4 h-4 text-blue-400" />,
  'Alvenaria': <Layers className="w-4 h-4 text-orange-400" />,
  'Revestimento': <Paintbrush className="w-4 h-4 text-purple-400" />,
  'Piso': <Grid3X3 className="w-4 h-4 text-emerald-400" />,
  'Acabamento': <Home className="w-4 h-4 text-teal-400" />,
  'Elétrica': <Zap className="w-4 h-4 text-yellow-400" />,
  'Hidráulica': <Wind className="w-4 h-4 text-cyan-400" />,
};

function getCategoryIcon(category: string) {
  return CATEGORY_ICONS[category] ?? <Package className="w-4 h-4 text-slate-400" />;
}

// Custo médio por categoria (valores estimados em R$)
const COST_PER_SQM: Record<string, number> = {
  'Estrutura': 180,
  'Alvenaria': 120,
  'Revestimento': 80,
  'Piso': 110,
  'Acabamento': 90,
  'Elétrica': 60,
  'Hidráulica': 70,
};

export function MaterialEstimate({ onClose }: MaterialEstimateProps) {
  const { model3d, processedPlan } = useStore();
  const [brickType, setBrickType] = useState<BrickType>('ceramic-6holes');
  const [includeReboco, setIncludeReboco] = useState(true);
  const [includeContrapiso, setIncludeContrapiso] = useState(true);
  const [includePiso, setIncludePiso] = useState(true);
  const [includeAco, setIncludeAco] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Calcular estimativa
  const estimate = useMemo<TMaterialEstimate | null>(() => {
    if (!model3d && !processedPlan) return null;

    let input;

    if (model3d?.objects) {
      input = fromModel3D(model3d.objects, model3d.rooms || []);
    } else if (processedPlan?.walls) {
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

  // Custo estimado total
  const estimatedCost = useMemo(() => {
    if (!estimate) return 0;
    const categories = Array.from(new Set(estimate.lines.map(l => l.category)));
    return categories.reduce((sum, cat) => {
      const costPer = COST_PER_SQM[cat] ?? 80;
      const hasCategory = estimate.lines.some(l => l.category === cat);
      return sum + (hasCategory ? costPer * estimate.totalWallArea : 0);
    }, 0);
  }, [estimate]);

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

  // Toggle categoria no accordion
  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Expandir todas por padrão se nenhuma expandida
  const hasAnyExpanded = expandedCategories.size > 0;

  const copyToClipboard = useCallback(async () => {
    if (!estimate) return;
    const text = estimateToText(estimate);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Lista copiada!');
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch {
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
        setTimeout(() => setCopyFeedback(null), 3000);
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
        await navigator.share({ title: 'Estimativa de Materiais', text });
      } catch { /* user cancel */ }
    } else {
      copyToClipboard();
    }
  }, [estimate, copyToClipboard]);

  // Empty state
  if (!model3d && !processedPlan) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
        <Header onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-slate-800/60 flex items-center justify-center mb-6">
            <Package className="w-10 h-10 text-slate-600" />
          </div>
          <h2 className="text-white text-xl font-bold mb-3">Nenhuma planta carregada</h2>
          <p className="text-slate-400 text-sm max-w-xs leading-relaxed">
            Importe uma planta 2D primeiro para gerar a estimativa de materiais de construção.
          </p>
          <button
            onClick={onClose}
            className="mt-6 px-6 py-3 bg-orange-500 hover:bg-orange-400 active:bg-orange-600 rounded-xl text-white text-sm font-semibold transition-colors"
          >
            Voltar ao menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <Header onClose={onClose} />

      {/* Toast feedback */}
      <TransitionBox>
        {copyFeedback && (
          <div className="mx-4 mt-2 p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-emerald-200 text-sm">{copyFeedback}</p>
          </div>
        )}
      </TransitionBox>

      <div className="flex-1 overflow-y-auto">
        {/* === RESUMO EXECUTIVO === */}
        {estimate && (
          <div className="px-4 pt-3 pb-2">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800/80 border border-slate-700/60 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Resumo da Obra</p>
              <div className="grid grid-cols-2 gap-3">
                <SummaryCard
                  icon={<Ruler className="w-4 h-4" />}
                  label="Área de paredes"
                  value={`${estimate.totalWallArea.toFixed(1)} m²`}
                  color="text-orange-400"
                  bg="bg-orange-500/10"
                />
                <SummaryCard
                  icon={<Home className="w-4 h-4" />}
                  label="Área construída"
                  value={`${estimate.totalFloorArea.toFixed(1)} m²`}
                  color="text-emerald-400"
                  bg="bg-emerald-500/10"
                />
                <SummaryCard
                  icon={<DollarSign className="w-4 h-4" />}
                  label="Custo estimado"
                  value={`R$ ${estimatedCost.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
                  color="text-cyan-400"
                  bg="bg-cyan-500/10"
                  highlight
                />
                <SummaryCard
                  icon={<Layers className="w-4 h-4" />}
                  label="Perímetro"
                  value={`${estimate.totalPerimetro.toFixed(1)} m`}
                  color="text-purple-400"
                  bg="bg-purple-500/10"
                />
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-center justify-between">
                <span className="text-slate-400 text-xs">
                  {estimate.summary.totalItems} itens calculados
                </span>
                <span className="text-slate-400 text-xs">
                  {estimate.summary.estimatedWeightKg.toFixed(0)} kg total
                </span>
              </div>
            </div>
          </div>
        )}

        {/* === CONFIGURAÇÕES === */}
        <section className="px-4 pt-2">
          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-4 mb-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Tipo de tijolo</p>
            <div className="space-y-2">
              {BRICK_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setBrickType(opt.value)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    brickType === opt.value
                      ? 'bg-orange-500/15 border-orange-500/50'
                      : 'bg-slate-800/50 border-slate-700/60 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm font-semibold ${brickType === opt.value ? 'text-orange-300' : 'text-white'}`}>
                        {opt.label}
                      </p>
                      <p className="text-slate-500 text-xs mt-0.5">{opt.description}</p>
                    </div>
                    {brickType === opt.value && (
                      <div className="w-2 h-2 rounded-full bg-orange-400 shadow-lg shadow-orange-400/50" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-4 mb-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Etapas da obra</p>
            <div className="grid grid-cols-2 gap-2">
              <Toggle label="Reboco" enabled={includeReboco} onToggle={() => setIncludeReboco(!includeReboco)} />
              <Toggle label="Contrapiso" enabled={includeContrapiso} onToggle={() => setIncludeContrapiso(!includeContrapiso)} />
              <Toggle label="Piso final" enabled={includePiso} onToggle={() => setIncludePiso(!includePiso)} />
              <Toggle label="Aço estrutural" enabled={includeAco} onToggle={() => setIncludeAco(!includeAco)} />
            </div>
          </div>
        </section>

        {/* === LISTA DE MATERIAIS COM ACCORDION === */}
        {estimate && (
          <section className="px-4 pb-4">
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Lista de materiais ({estimate.lines.length} itens)
              </p>
              <button
                onClick={() => {
                  if (hasAnyExpanded) {
                    setExpandedCategories(new Set());
                  } else {
                    setExpandedCategories(new Set(Array.from(byCategory.keys())));
                  }
                }}
                className="text-[10px] text-orange-400 hover:text-orange-300 font-medium"
              >
                {hasAnyExpanded ? 'Recolher tudo' : 'Expandir tudo'}
              </button>
            </div>

            <div className="space-y-2">
              {Array.from(byCategory.entries()).map(([category, items]) => {
                const isOpen = hasAnyExpanded
                  ? expandedCategories.has(category)
                  : true; // todas abertas por padrão

                return (
                  <div key={category} className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden">
                    {/* Categoria header (botão accordion) */}
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center gap-3 p-4 hover:bg-slate-800/30 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-xl bg-slate-800/80 flex items-center justify-center flex-shrink-0">
                        {getCategoryIcon(category)}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white text-sm font-semibold">{category}</p>
                        <p className="text-slate-500 text-xs">{items.length} {items.length === 1 ? 'item' : 'itens'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">
                          {Math.ceil(items.reduce((s, l) => s + l.quantity, 0))} uni
                        </span>
                        {isOpen
                          ? <ChevronUp className="w-4 h-4 text-slate-500" />
                          : <ChevronDown className="w-4 h-4 text-slate-500" />
                        }
                      </div>
                    </button>

                    {/* Items da categoria */}
                    {isOpen && (
                      <div className="border-t border-slate-800/60">
                        {items.map((line, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 px-4 py-3 hover:bg-slate-800/20 transition-colors border-b border-slate-800/40 last:border-b-0"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-slate-200 text-sm leading-tight">{line.item}</p>
                              <p className="text-slate-500 text-xs mt-0.5 leading-snug">{line.description}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-orange-300 text-sm font-bold">
                                {line.quantity < 10
                                  ? line.quantity.toFixed(1)
                                  : Math.ceil(line.quantity)
                                }
                              </p>
                              <p className="text-slate-500 text-[10px]">{line.unit}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Warnings */}
              {estimate.warnings.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-200 leading-relaxed space-y-0.5">
                    {estimate.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="h-6" />
      </div>

      {/* Bottom bar */}
      {estimate && (
        <div className="border-t border-slate-800/80 p-3 bg-slate-950/95">
          <div className="flex gap-2">
            <button
              onClick={copyToClipboard}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl text-white text-sm transition-colors"
            >
              <Copy className="w-4 h-4" />
              Copiar
            </button>
            <button
              onClick={downloadCSV}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl text-white text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Baixar CSV
            </button>
            <button
              onClick={shareEstimate}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 active:from-orange-600 rounded-xl text-white text-sm font-semibold transition-all"
            >
              <Share2 className="w-4 h-4" />
              Enviar
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
    <header className="flex items-center gap-3 px-4 py-3 bg-slate-950/95 border-b border-slate-800/60 z-20">
      <button
        onClick={onClose}
        className="p-2 rounded-xl hover:bg-slate-800/80 active:bg-slate-700/60 transition-colors"
      >
        <ArrowLeft className="w-5 h-5 text-slate-300" />
      </button>
      <div className="flex-1">
        <h1 className="font-bold text-white text-base">Materiais de Obra</h1>
        <p className="text-[10px] text-slate-500">Estimativa completa por etapa</p>
      </div>
      <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
        <Calculator className="w-5 h-5 text-orange-400" />
      </div>
    </header>
  );
}

function SummaryCard({
  icon, label, value, color, bg, highlight
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bg: string;
  highlight?: boolean;
}) {
  return (
    <div className={`${bg} border border-slate-700/40 rounded-xl p-3 ${highlight ? 'ring-1 ring-orange-500/30' : ''}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Toggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
        enabled
          ? 'bg-emerald-500/15 border-emerald-500/40'
          : 'bg-slate-800/50 border-slate-700/60'
      }`}
    >
      <span className={`text-sm ${enabled ? 'text-emerald-200' : 'text-slate-400'}`}>{label}</span>
      <div className={`w-9 h-5 rounded-full p-0.5 transition-all ${enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
        <div
          className={`w-4 h-4 rounded-full bg-white shadow transition-all ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  );
}

function TransitionBox({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
