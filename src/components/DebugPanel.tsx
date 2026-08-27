import { useState, useEffect } from 'react';
import { useStore } from '../store';

export function DebugPanel() {
  const { processedPlan, isProcessing, error } = useStore();
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    // Listen for console.log from the app
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => {
      originalLog.apply(console, args);
      setLogs(prev => [...prev.slice(-50), `[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a).substring(0, 100) : String(a)).join(' ')}`]);
    };
    
    console.error = (...args) => {
      originalError.apply(console, args);
      setLogs(prev => [...prev.slice(-50), `[ERROR] ${args.map(a => typeof a === 'object' ? JSON.stringify(a).substring(0, 100) : String(a)).join(' ')}`]);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  }, []);

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="fixed bottom-4 right-4 w-80 max-h-96 bg-black/90 text-white text-xs rounded-lg overflow-hidden z-[100] border border-white/20">
      <div className="bg-red-600 px-3 py-2 font-bold">🔧 Debug Panel</div>
      
      <div className="p-2 space-y-2 max-h-64 overflow-y-auto">
        <div>
          <span className="font-bold">Status:</span>
          <span className={isProcessing ? 'text-yellow-400' : 'text-green-400'}>
            {isProcessing ? ' Processando...' : ' Pronto'}
          </span>
        </div>
        
        <div>
          <span className="font-bold">Planta:</span>
          <span className={processedPlan ? 'text-green-400' : 'text-red-400'}>
            {processedPlan ? ` Sim (${processedPlan.walls?.length || 0} paredes)` : ' Não'}
          </span>
        </div>
        
        {error && (
          <div className="text-red-400">
            <span className="font-bold">Erro:</span> {error}
          </div>
        )}
        
        {processedPlan && (
          <div className="text-slate-400">
            <div>Paredes: {processedPlan.walls?.length || 0}</div>
            <div>Comodos: {processedPlan.rooms?.length || 0}</div>
            <div>Tipo: {processedPlan.source?.type || 'desconhecido'}</div>
            <div>Dimensoes: {processedPlan.source?.dimensions?.width}x{processedPlan.source?.dimensions?.height}</div>
          </div>
        )}
        
        <div className="border-t border-white/20 pt-2">
          <div className="font-bold mb-1">Logs (ultimos):</div>
          <div className="text-slate-300 space-y-1 font-mono">
            {logs.slice(-10).map((log, i) => (
              <div key={i} className={log.includes('ERROR') ? 'text-red-400' : 'text-slate-400'}>
                {log.substring(0, 80)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
