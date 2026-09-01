import { useMemo, useState } from 'react';
import { X, Copy, Check, AlertTriangle } from 'lucide-react';
import type { QB5DModel } from '../qb5d/types';
import { PHASE_META } from '../qb5d/standards';

const PRICE_KEY = 'qb5d_precos_unitarios';

function loadPrices(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PRICE_KEY) || '{}');
  } catch {
    return {};
  }
}

interface Props {
  model: QB5DModel;
  onClose: () => void;
}

export function QuantitiesPanel({ model, onClose }: Props) {
  const [prices, setPrices] = useState<Record<string, number>>(loadPrices);
  const [copied, setCopied] = useState(false);

  const setPrice = (key: string, v: number) => {
    const next = { ...prices, [key]: v };
    setPrices(next);
    try {
      localStorage.setItem(PRICE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const grouped = useMemo(() => {
    const g = new Map<string, typeof model.bom.lines>();
    for (const l of model.bom.lines) {
      const arr = g.get(l.phase) ?? [];
      arr.push(l);
      g.set(l.phase, arr);
    }
    return [...g.entries()];
  }, [model]);

  const hasPrices = Object.values(prices).some((v) => v > 0);
  const total = model.bom.lines.reduce((s, l) => s + (prices[l.key] || 0) * l.quantity, 0);

  const copyTSV = async () => {
    const rows = [
      ['Fase', 'Serviço', 'Unid.', 'Quantidade', ...(hasPrices ? ['R$ unit.', 'R$ total'] : [])].join('\t'),
      ...model.bom.lines.map((l) =>
        [
          PHASE_META[l.phase].label,
          l.service,
          l.unit,
          l.quantity.toLocaleString('pt-BR'),
          ...(hasPrices
            ? [(prices[l.key] || 0).toString(), ((prices[l.key] || 0) * l.quantity).toFixed(2)]
            : []),
        ].join('\t')
      ),
    ];
    try {
      await navigator.clipboard.writeText(rows.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-slate-900 w-full sm:max-w-2xl sm:rounded-2xl border border-slate-700 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div>
            <h2 className="text-white font-bold">Quantitativo de materiais · QB · 5D</h2>
            <p className="text-slate-400 text-xs">
              {model.meta.area.toFixed(1)} m² construídos · {model.foundationType.replace('_', ' ')} ·{' '}
              {model.fiadas} fiadas
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {model.bom.warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
              {model.bom.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {grouped.map(([phase, lines]) => (
            <div key={phase}>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: PHASE_META[phase as keyof typeof PHASE_META].color }}
                />
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  {PHASE_META[phase as keyof typeof PHASE_META].label}
                </h3>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="border-b border-slate-800/60">
                      <td className="py-1.5 pr-2 text-slate-200">{l.service}</td>
                      <td className="py-1.5 px-2 text-right text-white font-medium whitespace-nowrap">
                        {l.quantity.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-1.5 pl-2 text-slate-500 w-8">{l.unit}</td>
                      <td className="py-1.5 pl-2 w-24">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="R$"
                          value={prices[l.key] ?? ''}
                          onChange={(e) => setPrice(l.key, parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-800 rounded px-1.5 py-0.5 text-xs text-white text-right border border-slate-700 focus:border-cyan-500 outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3">
          {hasPrices ? (
            <div className="text-white">
              <span className="text-slate-400 text-xs">Total estimado</span>
              <div className="font-bold text-lg">
                {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </div>
            </div>
          ) : (
            <span className="text-slate-500 text-xs">
              Preencha os preços unitários para estimar o custo (salvos no dispositivo).
            </span>
          )}
          <button
            onClick={copyTSV}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex-shrink-0"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copiado' : 'Copiar tabela'}
          </button>
        </div>
      </div>
    </div>
  );
}
