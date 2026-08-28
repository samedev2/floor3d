import { useState, useEffect } from 'react';
import { X, Key, Save, Trash2, Eye, EyeOff, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

const STORAGE_KEY = 'floorvision_gemini_key';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setApiKey(stored);
  }, []);

  async function testKey() {
    if (!apiKey.trim()) {
      setError('Cole uma chave primeiro');
      return;
    }
    setIsTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey.trim(),
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Responda apenas OK' }] }],
          }),
        }
      );
      if (response.ok) {
        setTestResult('ok');
        setError(null);
      } else {
        const data = await response.json();
        setTestResult('fail');
        setError(data.error?.message || 'Chave inválida');
      }
    } catch (e) {
      setTestResult('fail');
      setError(e instanceof Error ? e.message : 'Erro de conexão');
    } finally {
      setIsTesting(false);
    }
  }

  function saveKey() {
    localStorage.setItem(STORAGE_KEY, apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function clearKey() {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey('');
    setTestResult(null);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      <div className="flex items-center justify-between p-4 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5 text-cyan-400" />
          <h2 className="font-bold text-white text-base">Configurações</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700">
          <X className="w-5 h-5 text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
          <h3 className="font-bold text-white mb-2 text-sm">Chave da API Gemini</h3>
          <p className="text-xs text-slate-400 mb-3">
            Usada para análise inteligente de plantas (recomendado).
            Sem chave, o app usa o parser local (menos preciso).
          </p>

          <div className="relative mb-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIza..."
              className="w-full px-3 py-2 pr-10 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200">{error}</p>
            </div>
          )}

          {testResult === 'ok' && (
            <div className="mb-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <p className="text-xs text-emerald-200">Chave válida! Gemini AI ativado.</p>
            </div>
          )}

          {saved && (
            <div className="mb-2 p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400" />
              <p className="text-xs text-cyan-200">Chave salva.</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={testKey}
              disabled={isTesting || !apiKey.trim()}
              className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-xs font-semibold"
            >
              {isTesting ? 'Testando...' : 'Testar chave'}
            </button>
            <button
              onClick={saveKey}
              disabled={!apiKey.trim()}
              className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-1"
            >
              <Save className="w-3 h-3" />
              Salvar
            </button>
            {apiKey && (
              <button
                onClick={clearKey}
                className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-xs"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-xl">
          <h3 className="font-bold text-cyan-200 mb-2 text-sm">Como conseguir uma chave grátis</h3>
          <ol className="text-xs text-slate-300 space-y-2 list-decimal pl-4">
            <li>Acesse <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-cyan-400 underline">aistudio.google.com/apikey</a> <ExternalLink className="inline w-3 h-3" /></li>
            <li>Faça login com sua conta Google</li>
            <li>Clique em <strong>Create API Key</strong></li>
            <li>Copie a chave (começa com "AIza...")</li>
            <li>Cole aqui e salve</li>
          </ol>
          <p className="text-xs text-slate-400 mt-3">
            ✓ Plano gratuito: 15 req/min, 1500 req/dia<br />
            ✓ Não precisa de cartão de crédito
          </p>
        </div>

        <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
          <h3 className="font-bold text-white mb-2 text-sm">Sobre o app</h3>
          <div className="text-xs text-slate-300 space-y-1">
            <div>Versão: <strong>1.5.0</strong></div>
            <div>Parser local: OTSU + axis-line</div>
            <div>Parser IA: Gemini 1.5 Flash</div>
            <div>APK: 11.5 MB</div>
          </div>
        </div>
      </div>
    </div>
  );
}
