import { 
  Box, 
  Grid3X3, 
  Layers, 
  Building2, 
  LayoutGrid,
  Check 
} from 'lucide-react';
import type { VisualizationMode } from './VisualizationModes';

interface ViewModeSelectorProps {
  currentMode: VisualizationMode;
  onModeChange: (mode: VisualizationMode) => void;
}

const viewModes: { mode: VisualizationMode; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    mode: 'structure', 
    label: 'Estrutura', 
    icon: <Box className="w-4 h-4" />, 
    description: 'Visualização sólida padrão' 
  },
  { 
    mode: 'wireframe', 
    label: 'Wireframe', 
    icon: <Grid3X3 className="w-4 h-4" />, 
    description: 'Visualização em linhas' 
  },
  { 
    mode: 'blueprint', 
    label: 'Blueprint', 
    icon: <LayoutGrid className="w-4 h-4" />, 
    description: 'Estilo planta técnica azul' 
  },
  { 
    mode: 'architectural', 
    label: 'Arquitetônico', 
    icon: <Building2 className="w-4 h-4" />, 
    description: 'Materiais realistas' 
  },
  { 
    mode: 'bim', 
    label: 'BIM', 
    icon: <Layers className="w-4 h-4" />, 
    description: 'Modelo de informação da construção' 
  },
];

export function ViewModeSelector({ currentMode, onModeChange }: ViewModeSelectorProps) {
  return (
    <div className="bg-surface/90 backdrop-blur-lg rounded-xl p-2">
      <div className="flex gap-1">
        {viewModes.map(({ mode, label, icon, description }) => (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            className={`
              flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all
              ${currentMode === mode 
                ? 'bg-primary text-white' 
                : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              }
            `}
            title={description}
          >
            {icon}
            <span className="text-xs font-medium">{label}</span>
            {currentMode === mode && (
              <Check className="w-3 h-3 absolute -top-1 -right-1" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ViewModeSelector;
