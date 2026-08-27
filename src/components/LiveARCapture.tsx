import { useState, useCallback, useRef, useEffect } from 'react';
import { Camera, Image, CheckCircle } from 'lucide-react';
import { SimpleAROverlay } from '../ui/ar/SimpleAROverlay';

export function LiveARCapture({ onClose }: { onClose: () => void }) {
  const [captureMode, setCaptureMode] = useState<'menu' | 'camera' | 'ar'>('menu');
  const [showAR, setShowAR] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start camera preview
  useEffect(() => {
    if (captureMode === 'camera') {
      startCamera();
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [captureMode]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera error:', err);
    }
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0);
    
    // Stop camera
    streamRef.current.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    
    // Open AR overlay directly
    setShowAR(true);
  }, []);

  // Show AR overlay
  if (showAR) {
    return <SimpleAROverlay onClose={onClose} />;
  }

  // Camera view
  if (captureMode === 'camera') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Camera preview */}
        <video
          ref={videoRef}
          className="flex-1 w-full object-cover"
          autoPlay
          playsInline
          muted
        />

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setCaptureMode('menu')}
              className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white"
            >
              ✕
            </button>
            <span className="text-white font-medium">Capturar Planta</span>
            <div className="w-10" />
          </div>
        </div>

        {/* Capture button */}
        <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex justify-center">
            <button
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full bg-white border-4 border-blue-500 flex items-center justify-center hover:scale-105 transition-transform"
            >
              <div className="w-16 h-16 rounded-full bg-blue-500" />
            </button>
          </div>
          <p className="text-white/70 text-center mt-4 text-sm">
            Aponte para a planta e capture
          </p>
        </div>
      </div>
    );
  }

  // Menu
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white"
          >
            ✕
          </button>
          <span className="text-white font-bold text-lg">AR ao Vivo</span>
          <div className="w-10" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-24 h-24 rounded-3xl bg-blue-500/20 flex items-center justify-center mb-6">
          <Camera className="w-12 h-12 text-blue-400" />
        </div>

        <h2 className="text-2xl font-bold text-white mb-2">AR ao Vivo</h2>
        <p className="text-slate-400 text-center mb-8 max-w-xs">
          Capture uma planta ou use a câmera para visualizar em Realidade Aumentada
        </p>

        <div className="w-full max-w-sm space-y-4">
          {/* Camera option */}
          <button
            onClick={() => setCaptureMode('camera')}
            className="w-full py-4 px-6 bg-blue-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 hover:bg-blue-500 transition-colors"
          >
            <Camera className="w-6 h-6" />
            <span>Capturar Planta</span>
          </button>

          {/* Demo AR */}
          <button
            onClick={() => setShowAR(true)}
            className="w-full py-4 px-6 bg-green-600 rounded-2xl text-white font-bold flex items-center justify-center gap-3 hover:bg-green-500 transition-colors"
          >
            <CheckCircle className="w-6 h-6" />
            <span>Ver Demo AR Agora</span>
          </button>

          {/* Gallery */}
          <label className="w-full py-4 px-6 bg-slate-700 rounded-2xl text-white font-medium flex items-center justify-center gap-3 hover:bg-slate-600 transition-colors cursor-pointer">
            <Image className="w-6 h-6" />
            <span>Escolher da Galeria</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  // Open AR overlay directly with gallery image
                  setShowAR(true);
                }
              }}
            />
          </label>
        </div>

        {/* Tips */}
        <div className="mt-8 text-center text-sm text-slate-500">
          <p className="font-medium text-slate-400 mb-2">Dicas:</p>
          <p>• Use plantas com linhas retas</p>
          <p>• Boa iluminação sem sombras</p>
          <p>• Fundo branco ou claro</p>
        </div>
      </div>
    </div>
  );
}
