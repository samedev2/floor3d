import { useState, useEffect } from 'react';
import { Mail, Lock, LogIn, UserPlus, X, Loader2, AlertCircle, CheckCircle2, LogOut, Database, Settings as SettingsIcon } from 'lucide-react';
import {
  getConfig, setConfig, getCurrentUser,
  signIn, signUp, signOut, testConnection,
  type SupabaseConfig,
} from '../lib/supabase';
import { SettingsPanel } from './SettingsPanel';

interface AuthScreenProps {
  onClose?: () => void;
  onAuthChange?: (user: any) => void;
}

export function AuthScreen({ onClose, onAuthChange }: AuthScreenProps) {
  const [cfg, setCfg] = useState<SupabaseConfig | null>(getConfig());
  const [user, setUser] = useState<any>(null);
  const [mode, setMode] = useState<'signin' | 'signup' | 'config'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // URL + key temporários (no modo config)
  const [tmpUrl, setTmpUrl] = useState(cfg?.url || '');
  const [tmpKey, setTmpKey] = useState(cfg?.anonKey || '');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    refreshUser();
  }, []);

  async function refreshUser() {
    const u = await getCurrentUser();
    setUser(u);
    onAuthChange?.(u);
  }

  async function handleAuth() {
    if (!email || !password) {
      setError('Preencha email e senha');
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signup') {
        const { user, error } = await signUp(email, password);
        if (error) {
          setError(error);
        } else if (user) {
          setInfo('Conta criada! Verifique seu email para confirmar.');
        }
      } else {
        const { user, error } = await signIn(email, password);
        if (error) {
          setError(error);
        } else {
          setUser(user);
          onAuthChange?.(user);
          setInfo('Login realizado!');
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    await signOut();
    setUser(null);
    onAuthChange?.(null);
    setLoading(false);
  }

  async function handleSaveConfig() {
    if (!tmpUrl || !tmpKey) {
      setError('Preencha URL e Anon Key');
      return;
    }
    setConfig({ url: tmpUrl.trim(), anonKey: tmpKey.trim() });
    setCfg({ url: tmpUrl.trim(), anonKey: tmpKey.trim() });
    setMode('signin');
    setError(null);
    setInfo('Configuração salva!');

    // Auto-testar conexão
    setTesting(true);
    const result = await testConnection();
    setTesting(false);
    if (!result.ok) {
      setError(`Conexão: ${result.error}`);
    }
  }

  async function handleTestConnection() {
    setConfig({ url: tmpUrl.trim(), anonKey: tmpKey.trim() });
    setTesting(true);
    const result = await testConnection();
    setTesting(false);
    if (!result.ok) {
      setError(result.error || 'Erro desconhecido');
    } else {
      setError(null);
      setInfo('Conexão OK! Pode fazer login.');
    }
  }

  if (showSettings) {
    return <SettingsPanel onClose={() => setShowSettings(false)} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
      <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Database className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-bold text-white">Sincronização na Nuvem</h1>
            <p className="text-slate-400 text-sm">Supabase</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400"
            title="Configurações Gemini"
          >
            <SettingsIcon className="w-5 h-5" />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-700 text-slate-400">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex items-start justify-center pt-8">
        <div className="w-full max-w-md">

          {/* Sem config Supabase - pedir para configurar */}
          {!cfg && (
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-2">Configurar Supabase</h2>
              <p className="text-sm text-slate-400 mb-4">
                Cole abaixo a URL do seu projeto e a Anon Key para ativar a sincronização na nuvem.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-300 mb-1 block">Project URL</label>
                  <input
                    type="url"
                    value={tmpUrl}
                    onChange={e => setTmpUrl(e.target.value)}
                    placeholder="https://xxx.supabase.co"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 mb-1 block">Anon Key</label>
                  <input
                    type="password"
                    value={tmpKey}
                    onChange={e => setTmpKey(e.target.value)}
                    placeholder="eyJhbGc..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                {error && (
                  <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-200">{error}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-sm"
                  >
                    {testing ? 'Testando...' : 'Testar'}
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-white text-sm font-semibold"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Config existe - mostrar login */}
          {cfg && !user && (
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">
                  {mode === 'signup' ? 'Criar conta' : 'Entrar'}
                </h2>
                <button
                  onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
                  className="text-xs text-cyan-400 underline"
                >
                  {mode === 'signin' ? 'Criar nova conta' : 'Já tenho conta'}
                </button>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="senha (min 6 caracteres)"
                    onKeyDown={e => e.key === 'Enter' && handleAuth()}
                    className="w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
                {error && (
                  <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-200">{error}</p>
                  </div>
                )}
                {info && (
                  <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">{info}</p>
                  </div>
                )}
                <button
                  onClick={handleAuth}
                  disabled={loading}
                  className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : mode === 'signup' ? (
                    <><UserPlus className="w-4 h-4" /> Criar conta</>
                  ) : (
                    <><LogIn className="w-4 h-4" /> Entrar</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Já logado */}
          {cfg && user && (
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-300 font-bold text-lg">
                  {user.email?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-white">{user.email}</p>
                  <p className="text-xs text-emerald-400">Conectado</p>
                </div>
              </div>
              <div className="space-y-2">
                <button
                  onClick={handleLogout}
                  disabled={loading}
                  className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm font-semibold flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                  Sair
                </button>
                {onClose && (
                  <button
                    onClick={onClose}
                    className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-white text-sm font-semibold"
                  >
                    Continuar
                  </button>
                )}
              </div>
            </div>
          )}

          {cfg && (
            <p className="text-xs text-slate-500 text-center mt-4">
              Suas plantas são salvas automaticamente quando você processa uma imagem.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
