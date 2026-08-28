/**
 * LoginGate - Tela de logon profissional (lock screen)
 *
 * Aparece ANTES do app se não houver usuário logado.
 * Funcionalidades:
 * - Logo/branding Floor3D
 * - Form de login com email + senha
 * - Setup do Supabase (URL + Anon Key)
 * - "Não tem conta? Fale com o administrador"
 * - Esqueci a senha (envia email)
 * - Testa conexão antes de tentar login
 * - Animações suaves
 * - Se já tem sessão válida, vai direto pro app
 */

import { useState, useEffect, useRef } from 'react';
import {
  Building2, Mail, Lock, LogIn, Loader2, AlertCircle, CheckCircle2,
  Database, Eye, EyeOff, Key, HelpCircle, Settings, ExternalLink, Sparkles,
} from 'lucide-react';
import {
  getConfig, setConfig, getCurrentUser, signIn, testConnection,
  type SupabaseConfig,
} from '../lib/supabase';

interface LoginGateProps {
  onAuthenticated: (user: any) => void;
  version?: string;
}

type Mode = 'login' | 'config' | 'forgot';

export function LoginGate({ onAuthenticated, version = 'v2.0.1' }: LoginGateProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [cfg, setCfg] = useState<SupabaseConfig | null>(getConfig());
  const [checking, setChecking] = useState(true);

  // Login form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Config form
  const [tmpUrl, setTmpUrl] = useState(cfg?.url || '');
  const [tmpKey, setTmpKey] = useState(cfg?.anonKey || '');
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  // ============================================
  // VERIFICA SE JÁ TEM SESSÃO VÁLIDA
  // ============================================
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (!mounted) return;
        if (u) {
          onAuthenticated(u);
          return;
        }
        // Sem user: verifica config do Supabase
        const c = getConfig();
        if (c) {
          setCfg(c);
          setMode('login');
          // Testa conexão silenciosamente
          const r = await testConnection();
          if (mounted) setConnectionOk(r.ok);
        } else {
          setMode('config');
        }
      } catch (e) {
        console.error('LoginGate init:', e);
      } finally {
        if (mounted) setChecking(false);
      }
    })();
    return () => { mounted = false; };
  }, [onAuthenticated]);

  // ============================================
  // LOGIN
  // ============================================
  async function handleLogin() {
    if (!email || !password) {
      setError('Preencha email e senha');
      return;
    }
    if (!cfg) {
      setMode('config');
      setError('Configure o Supabase primeiro');
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { user, error } = await signIn(email.trim().toLowerCase(), password);
      if (error) {
        if (error.includes('Invalid login')) {
          setError('Email ou senha incorretos');
        } else if (error.includes('Email not confirmed')) {
          setError('Email não confirmado. Procure o administrador.');
        } else {
          setError(error);
        }
      } else if (user) {
        setInfo('Login realizado! Entrando...');
        setTimeout(() => onAuthenticated(user), 600);
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  }

  // ============================================
  // SAVE CONFIG
  // ============================================
  async function handleSaveConfig() {
    if (!tmpUrl || !tmpKey) {
      setError('Preencha URL e Anon Key');
      return;
    }
    const url = tmpUrl.trim();
    const key = tmpKey.trim();

    // Validação básica
    if (!url.startsWith('http')) {
      setError('URL deve começar com http:// ou https://');
      return;
    }
    if (!key.startsWith('eyJ')) {
      setError('Anon Key inválida (deve começar com "eyJ")');
      return;
    }

    setConfig({ url, anonKey: key });
    setCfg({ url, anonKey: key });
    setError(null);
    setInfo('Configuração salva! Testando conexão...');

    setTesting(true);
    const r = await testConnection();
    setTesting(false);

    if (r.ok) {
      setConnectionOk(true);
      setInfo('Conectado! Faça login para continuar.');
      setTimeout(() => {
        setMode('login');
        setInfo(null);
      }, 1200);
    } else {
      setConnectionOk(false);
      setError(`Conexão falhou: ${r.error || 'desconhecido'}`);
    }
  }

  // ============================================
  // LOADING INICIAL
  // ============================================
  if (checking) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 flex flex-col items-center justify-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30 mb-4">
          <Building2 className="w-10 h-10 text-white" />
        </div>
        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        <p className="text-slate-500 text-xs mt-3">Verificando sessão...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 flex flex-col overflow-y-auto">
      {/* TOPO: Logo + branding */}
      <div className="flex flex-col items-center pt-12 pb-6 px-6">
        <div className="relative">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-xl shadow-cyan-500/30 mb-4">
            <Building2 className="w-12 h-12 text-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Floor3D</h1>
        <p className="text-slate-400 text-sm mt-1">Plantas 2D em modelos 3D</p>
        <p className="text-slate-600 text-xs mt-2">{version}</p>
      </div>

      {/* CARD CENTRAL */}
      <div className="flex-1 px-4 pb-6">
        <div className="max-w-md mx-auto">

          {/* === MODO LOGIN === */}
          {mode === 'login' && cfg && (
            <div className="bg-slate-800/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-1">
                <LogIn className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-bold text-white">Entrar</h2>
              </div>
              <p className="text-xs text-slate-400 mb-5">
                Acesse sua biblioteca sincronizada na nuvem.
              </p>

              <div className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(null); }}
                    placeholder="seu@email.com"
                    autoComplete="email"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && passwordRef.current?.focus()}
                    className="w-full pl-10 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition"
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    ref={passwordRef}
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(null); }}
                    placeholder="sua senha"
                    autoComplete="current-password"
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition"
                  />
                  <button
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition"
                    type="button"
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Status conexão */}
                {connectionOk === false && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-200">
                      <strong>Servidor indisponível.</strong> Verifique sua internet ou configure outro Supabase.
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-200">{error}</p>
                  </div>
                )}

                {info && (
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">{info}</p>
                  </div>
                )}

                <button
                  onClick={handleLogin}
                  disabled={loading || !email || !password}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all active:scale-95"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Entrando...</>
                  ) : (
                    <><LogIn className="w-4 h-4" /> Entrar</>
                  )}
                </button>
              </div>

              {/* Links auxiliares */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
                <button
                  onClick={() => setMode('forgot')}
                  className="text-xs text-slate-400 hover:text-cyan-400 transition flex items-center gap-1"
                >
                  <HelpCircle className="w-3 h-3" />
                  Esqueci a senha
                </button>
                <button
                  onClick={() => { setMode('config'); setError(null); setInfo(null); }}
                  className="text-xs text-slate-400 hover:text-cyan-400 transition flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" />
                  Servidor
                </button>
              </div>

              <p className="text-[10px] text-slate-500 text-center mt-4">
                Sem conta? Procure o administrador — usuários são criados no Supabase.
              </p>
            </div>
          )}

          {/* === MODO CONFIG (primeira vez / sem cfg) === */}
          {mode === 'config' && (
            <div className="bg-slate-800/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-1">
                <Database className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">Conectar ao Supabase</h2>
              </div>
              <p className="text-xs text-slate-400 mb-5">
                Cole abaixo as credenciais do seu projeto Supabase para ativar login e sincronização.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <ExternalLink className="w-3 h-3" />
                    Project URL
                  </label>
                  <input
                    type="url"
                    value={tmpUrl}
                    onChange={e => { setTmpUrl(e.target.value); setError(null); }}
                    placeholder="https://xxx.supabase.co"
                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Key className="w-3 h-3" />
                    Anon Key
                  </label>
                  <input
                    type="password"
                    value={tmpKey}
                    onChange={e => { setTmpKey(e.target.value); setError(null); }}
                    placeholder="eyJhbGciOi..."
                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition"
                  />
                </div>

                {error && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-200">{error}</p>
                  </div>
                )}

                {info && !error && (
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">{info}</p>
                  </div>
                )}

                {connectionOk === false && !error && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-200">
                      <strong>Sem conexão.</strong> Você pode salvar mesmo assim e tentar depois.
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSaveConfig}
                  disabled={testing || !tmpUrl || !tmpKey}
                  className="w-full py-3 bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 disabled:opacity-50 rounded-lg text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                >
                  {testing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Testando conexão...</>
                  ) : (
                    <><Database className="w-4 h-4" /> Salvar e conectar</>
                  )}
                </button>
              </div>

              {cfg && (
                <button
                  onClick={() => { setMode('login'); setError(null); }}
                  className="w-full mt-3 py-2 text-slate-400 hover:text-white text-sm transition"
                >
                  ← Voltar para o login
                </button>
              )}

              <div className="mt-4 p-3 bg-slate-900/50 border border-slate-700/50 rounded-lg">
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <strong>Onde conseguir?</strong> Acesse o painel do seu projeto em{' '}
                  <span className="text-cyan-400">supabase.com</span> → Settings → API.
                  A URL e a <strong>anon public</strong> key ficam lá.
                </p>
              </div>
            </div>
          )}

          {/* === MODO ESQUECI SENHA === */}
          {mode === 'forgot' && cfg && (
            <ForgotPassword
              email={email}
              onBack={() => { setMode('login'); setError(null); setInfo(null); }}
              onEmailChange={setEmail}
            />
          )}
        </div>
      </div>

      {/* RODAPÉ */}
      <div className="px-4 py-4 text-center">
        <p className="text-[10px] text-slate-600">
          Floor3D © 2026 · Funciona offline após o primeiro login
        </p>
      </div>
    </div>
  );
}

// ============================================
// SUB-COMPONENTE: ESQUECI SENHA
// ============================================
function ForgotPassword({ email, onBack, onEmailChange }: {
  email: string;
  onBack: () => void;
  onEmailChange: (e: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!email) {
      setError('Digite seu email acima');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { getClient } = await import('../lib/supabase');
      const c = getClient();
      if (!c) {
        setError('Supabase não configurado');
        return;
      }
      const { error } = await c.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'Erro ao enviar email');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="bg-slate-800/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-white mb-1">Email enviado!</h2>
          <p className="text-sm text-slate-400 mb-4 max-w-xs">
            Verifique a caixa de entrada de <strong>{email}</strong> e siga as instruções para redefinir sua senha.
          </p>
          <button
            onClick={onBack}
            className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-white text-sm font-semibold"
          >
            Voltar para o login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/80 backdrop-blur border border-slate-700/60 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center gap-2 mb-1">
        <HelpCircle className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-bold text-white">Esqueci a senha</h2>
      </div>
      <p className="text-xs text-slate-400 mb-5">
        Digite seu email e enviaremos um link para você criar uma nova senha.
      </p>

      <div className="space-y-3">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="email"
            value={email}
            onChange={e => { onEmailChange(e.target.value); setError(null); }}
            placeholder="seu@email.com"
            autoFocus
            className="w-full pl-10 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition"
          />
        </div>

        {error && (
          <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sending || !email}
          className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-50 rounded-lg text-white text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          {sending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
          ) : (
            <>Enviar link de recuperação</>
          )}
        </button>

        <button
          onClick={onBack}
          className="w-full py-2 text-slate-400 hover:text-white text-sm transition"
        >
          ← Voltar para o login
        </button>
      </div>
    </div>
  );
}
