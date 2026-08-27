import { useState, useCallback } from 'react';
import { Camera, FolderOpen, MapPin, Shield, AlertCircle } from 'lucide-react';

interface PermissionHandlerProps {
  onPermissionsGranted: () => void;
  onSkip: () => void;
}

export function PermissionHandler({ onPermissionsGranted, onSkip: _onSkip }: PermissionHandlerProps) {
  const [showDenied, setShowDenied] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const requestCameraPermission = useCallback(async () => {
    setRequesting(true);
    
    try {
      // Import Camera plugin - it handles permissions internally
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      
      // This will trigger permission prompt if needed
      await Camera.getPhoto({
        quality: 10, // Low quality for permission test
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      });
      
      // If we got here, permission was granted
      onPermissionsGranted();
    } catch (err: any) {
      console.error('Camera permission error:', err);
      
      // Check if permission was denied
      if (err.message?.includes('denied') || err.message?.includes('Permission')) {
        setShowDenied(true);
      } else {
        // Other error, might be available anyway
        onPermissionsGranted();
      }
    } finally {
      setRequesting(false);
    }
  }, [onPermissionsGranted]);

  const proceedWithoutPermissions = useCallback(() => {
    onPermissionsGranted();
  }, [onPermissionsGranted]);

  if (showDenied) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10 text-red-500" />
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-4 text-center">
          Permissão Negada
        </h2>
        
        <p className="text-slate-400 text-center mb-6 max-w-sm">
          A câmera precisa de permissão para funcionar. Você pode tentar novamente ou continuar sem AR.
        </p>
        
        <div className="space-y-3 w-full max-w-sm">
          <button
            onClick={() => {
              setShowDenied(false);
              requestCameraPermission();
            }}
            className="w-full py-4 bg-primary rounded-xl text-white font-bold text-lg"
          >
            Tentar Novamente
          </button>
          
          <button
            onClick={proceedWithoutPermissions}
            className="w-full py-3 text-slate-400 text-sm"
          >
            Continuar sem Câmera
          </button>
        </div>
        
        <p className="text-slate-500 text-sm mt-6 text-center">
          Para dar permissão manualmente:<br/>
          Configurações → Apps → FloorVision → Permissões
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="p-6 bg-slate-800">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Bem-vindo ao FloorVision</h2>
            <p className="text-slate-400 text-sm">Configure para começar</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        <p className="text-slate-400 mb-6">
          Para escanear plantas e usar AR, precisamos de algumas permissões:
        </p>

        {/* Camera */}
        <div className="flex items-center gap-4 p-4 bg-slate-800 rounded-xl mb-4">
          <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center">
            <Camera className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">Câmera</p>
            <p className="text-slate-400 text-sm">Escanear plantas em tempo real</p>
          </div>
        </div>

        {/* Storage */}
        <div className="flex items-center gap-4 p-4 bg-slate-800 rounded-xl mb-4">
          <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center">
            <FolderOpen className="w-6 h-6 text-accent" />
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">Armazenamento</p>
            <p className="text-slate-400 text-sm">Salvar plantas e modelos 3D</p>
          </div>
        </div>

        {/* Location */}
        <div className="flex items-center gap-4 p-4 bg-slate-800 rounded-xl mb-6">
          <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center">
            <MapPin className="w-6 h-6 text-yellow-500" />
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">Localização</p>
            <p className="text-slate-400 text-sm">Marcar plantas por local (opcional)</p>
          </div>
        </div>

        {/* Info box */}
        <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
          <p className="text-slate-400 text-sm">
            💡 As permissões ficam ativas enquanto o app estiver aberto. 
            Você pode gerenciá-las a qualquer momento nas configurações do celular.
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="p-6 bg-slate-800 space-y-3">
        <button
          onClick={requestCameraPermission}
          disabled={requesting}
          className="w-full py-4 bg-primary rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {requesting ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Solicitando...</span>
            </>
          ) : (
            <>
              <Camera className="w-6 h-6" />
              <span>Conceder Permissões</span>
            </>
          )}
        </button>
        
        <button
          onClick={proceedWithoutPermissions}
          className="w-full py-3 text-slate-400 text-sm"
        >
          Continuar sem permissões (AR desabilitado)
        </button>
      </div>
    </div>
  );
}
