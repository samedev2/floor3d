/**
 * usePlantImport - Hook React para import de plantas 2D
 *
 * Encapsula a lógica unificada (Gemini → parser → fallback) em um hook
 * pronto para usar. Substitui a duplicação entre App.tsx e PlantLibrary.tsx.
 *
 * Uso:
 *   const { importFile, isImporting, progress, error, lastResult } = usePlantImport();
 *   await importFile(file);
 */

import { useState, useCallback, useRef } from 'react';
import {
  importFloorPlan,
  planToModel3D,
  planToFloorPlan,
  getLastImage,
  setLastImage,
  type ImportResult,
  type ImportProgress,
  type Model3DObjects,
} from './plantImportCore';
import { hasApiKey } from './geminiChat';

export interface UsePlantImportOptions {
  /**
   * Callback chamado quando import termina com sucesso
   */
  onSuccess?: (result: ImportResult, model3d: Model3DObjects, floorPlan: any) => void;

  /**
   * Callback chamado quando import falha
   */
  onError?: (error: string) => void;
}

export interface UsePlantImportReturn {
  /** Importa um arquivo (File object) */
  importFile: (file: File) => Promise<ImportResult | null>;

  /** Importa a partir de uma imagem já carregada (data URL) */
  importDataUrl: (dataUrl: string) => Promise<ImportResult | null>;

  /** Importa novamente a última imagem (reprocessa) */
  reprocessLast: () => Promise<ImportResult | null>;

  /** Está importando agora? */
  isImporting: boolean;

  /** Progresso atual */
  progress: ImportProgress | null;

  /** Mensagem de erro (null se tudo OK) */
  error: string | null;

  /** Última imagem (sempre disponível, mesmo se parsing falhou) */
  lastImage: string | null;

  /** Resultado do último import bem-sucedido */
  lastResult: ImportResult | null;
}

export function usePlantImport(options: UsePlantImportOptions = {}): UsePlantImportReturn {
  const { onSuccess, onError } = options;
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const lastImageRef = useRef<string | null>(getLastImage());
  const [lastImage, setLastImageState] = useState<string | null>(lastImageRef.current);

  // Função genérica que faz o parse
  const runImport = useCallback(async (
    runner: () => Promise<ImportResult>
  ): Promise<ImportResult | null> => {
    setIsImporting(true);
    setError(null);
    setProgress({ stage: 'loading', message: 'Iniciando...' });

    try {
      const result = await runner();
      const finalImage = result.imageDataUrl;
      lastImageRef.current = finalImage;
      setLastImageState(finalImage);
      setLastResult(result);

      if (result.success) {
        const model3d = planToModel3D(result.plan);
        const floorPlan = planToFloorPlan(result.plan);
        onSuccess?.(result, model3d, floorPlan);
        setProgress({
          stage: 'finalizing',
          message: `✅ ${result.stats.wallCount} paredes, ${result.stats.roomCount} cômodos em ${result.stats.widthMeters}×${result.stats.heightMeters}m`,
        });
      } else {
        const errMsg = 'Não foi possível detectar a estrutura. Tente outra imagem.';
        setError(errMsg);
        onError?.(errMsg);
      }

      return result;
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      setError(msg);
      onError?.(msg);
      return null;
    } finally {
      setIsImporting(false);
    }
  }, [onSuccess, onError]);

  /**
   * Importa a partir de um arquivo (File object)
   * Suporta: PNG, JPG, JPEG, WEBP, PDF
   */
  const importFile = useCallback(async (file: File): Promise<ImportResult | null> => {
    return runImport(() => importFloorPlan(file, p => setProgress(p)));
  }, [runImport]);

  /**
   * Importa a partir de uma data URL (imagem já carregada)
   * Útil para imagens vindas de câmera ou canvas
   */
  const importDataUrl = useCallback(async (dataUrl: string): Promise<ImportResult | null> => {
    setLastImage(dataUrl);
    return runImport(async () => {
      // Converte data URL em File-like
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'capture.png', { type: blob.type });
      return importFloorPlan(file, p => setProgress(p));
    });
  }, [runImport]);

  /**
   * Reprocessa a última imagem (mesma imagem, novo parse)
   */
  const reprocessLast = useCallback(async (): Promise<ImportResult | null> => {
    const img = lastImageRef.current ?? getLastImage();
    if (!img) {
      const msg = 'Nenhuma imagem anterior para reprocessar.';
      setError(msg);
      onError?.(msg);
      return null;
    }
    return importDataUrl(img);
  }, [importDataUrl, onError]);

  return {
    importFile,
    importDataUrl,
    reprocessLast,
    isImporting,
    progress,
    error,
    lastImage,
    lastResult,
  };
}

/**
 * Hook auxiliar que expõe só o status de IA habilitada
 */
export function useHasAiKey() {
  const [enabled] = useState(hasApiKey());
  return enabled;
}
