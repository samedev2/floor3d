import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, X, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import { geminiChat, type GeminiFloorPlan } from '../lib/geminiChat';

interface GeminiChatPanelProps {
  initialImage: string;
  onApply: (plan: GeminiFloorPlan) => void;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

const SUGGESTED_PROMPTS = [
  'Adicione uma porta de 0,80m entre Sala e Cozinha',
  'Divida o Quarto 1 em dois quartos menores',
  'Mova a parede do banheiro 30cm para a direita',
  'Adicione uma janela na parede externa da Sala',
  'Faça a casa ter 8m x 10m em vez de 6x8',
];

export function GeminiChatPanel({ initialImage, onApply, onClose }: GeminiChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<GeminiFloorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialAnalyzed, setInitialAnalyzed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Run initial analysis
  useEffect(() => {
    if (initialImage && !initialAnalyzed) {
      runInitialAnalysis();
    }
  }, [initialImage]);

  async function runInitialAnalysis() {
    setIsLoading(true);
    setError(null);
    setMessages([{
      role: 'model',
      text: 'Analisando a planta com Gemini AI...',
      timestamp: Date.now(),
    }]);
    try {
      const plan = await geminiChat.analyzeImage(initialImage);
      setCurrentPlan(plan);
      setInitialAnalyzed(true);
      setMessages([{
        role: 'model',
        text: `Pronto! Detectei ${plan.walls.length} paredes e ${plan.rooms.length} cômodos (${plan.widthMeters}×${plan.heightMeters}m).\n\n` +
              (plan.notes || '') +
              `\n\nVocê pode pedir ajustes abaixo, ou tocar em "Aplicar" para usar esta estrutura.`,
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao analisar');
      setMessages([{
        role: 'model',
        text: 'Não consegui conectar ao Gemini AI. Verifique sua internet e tente novamente.\n\nEnquanto isso, você pode tocar em "Aplicar estrutura padrão" para usar um fallback.',
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const { plan, reply } = await geminiChat.refine(text);
      setCurrentPlan(plan);
      setMessages(prev => [...prev, {
        role: 'model',
        text: reply,
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro');
      setMessages(prev => [...prev, {
        role: 'model',
        text: 'Erro ao processar. Tente reformular.',
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  function applyStandard() {
    const plan = geminiChat.simpleFallback(6, 8);
    onApply(plan);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-pink-400" />
          <h2 className="font-bold text-white text-sm">Chat com Gemini AI</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700">
          <X className="w-5 h-5 text-slate-400" />
        </button>
      </div>

      {/* Status Bar */}
      {currentPlan && (
        <div className="px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-emerald-200">
            {currentPlan.walls.length} paredes • {currentPlan.rooms.length} cômodos • {currentPlan.widthMeters}×{currentPlan.heightMeters}m
          </span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-slate-800 text-slate-200 border border-slate-700'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl px-3 py-2 text-sm text-slate-300 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Processando...
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-200">{error}</p>
        </div>
      )}

      {/* Suggested Prompts */}
      {messages.length <= 1 && !isLoading && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {SUGGESTED_PROMPTS.slice(0, 3).map((p, i) => (
            <button
              key={i}
              onClick={() => sendMessage(p)}
              className="text-[10px] px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-slate-300"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-slate-700 bg-slate-800/50">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ex: adicione uma porta na Sala..."
            className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="px-3 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 rounded-xl text-white disabled:text-slate-500"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 mt-2">
          <button
            onClick={() => currentPlan && onApply(currentPlan)}
            disabled={!currentPlan}
            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 rounded-xl text-white text-sm font-semibold disabled:text-slate-500"
          >
            ✓ Aplicar ({currentPlan?.walls.length || 0} paredes)
          </button>
          <button
            onClick={applyStandard}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300 text-xs"
          >
            Padrão 6×8
          </button>
        </div>
      </div>
    </div>
  );
}
