import { useState } from 'react';
import { 
  Camera, 
  Box, 
  Layers, 
  Edit3, 
  Home,
  X,
  CheckCircle2,
  Circle,
  ChevronRight,
  Sparkles,
  Smartphone,
  ChevronDown,
  Tag
} from 'lucide-react';

interface PipelineViewProps {
  onClose?: () => void;
  onNavigate?: (stage: string) => void;
}

interface PipelineNode {
  id: string;
  name: string;
  description: string;
  icon: any;
  status: 'done' | 'pending';
  action?: string;
  children?: PipelineNode[];
}

export function PipelineView({ onClose, onNavigate }: PipelineViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['planta', '3d', 'modelo']));
  
  const toggleExpand = (id: string) => {
    const newSet = new Set(expanded);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpanded(newSet);
  };

  // Hierarquia baseada na skill fornecida
  const hierarchy: PipelineNode[] = [
    {
      id: 'camera',
      name: '📷 Câmera',
      description: 'Captura ou upload de planta',
      icon: Camera,
      status: 'done',
    },
    {
      id: 'planta',
      name: 'PLANTA 2D',
      description: 'Estrutura inicial com duas dimensões semânticas',
      icon: Layers,
      status: 'done',
      children: [
        {
          id: 'geometria-2d',
          name: '📐 GEOMETRIA',
          description: 'Linhas e pontos detectados na planta',
          icon: Layers,
          status: 'done',
        },
        {
          id: 'semantica-2d',
          name: '🏷️ SEMÂNTICA',
          description: 'Identificação: quarto, cozinha, banheiro, sala...',
          icon: Tag,
          status: 'done',
        },
      ],
    },
    {
      id: 'extrusao',
      name: '⬆️ EXTRUSÃO Z',
      description: 'Adiciona a terceira dimensão (altura) às paredes',
      icon: Sparkles,
      status: 'done',
      action: 'editor',
    },
    {
      id: '3d',
      name: 'ESTRUTURA 3D',
      description: 'Volumes 3D com classificação semântica',
      icon: Box,
      status: 'done',
      action: 'editor',
      children: [
        {
          id: 'geometria-3d',
          name: '🧱 GEOMETRIA',
          description: 'Caixas (paredes) e planos (pisos/tetos)',
          icon: Box,
          status: 'done',
        },
        {
          id: 'semantica-3d',
          name: '🚪 SEMÂNTICA',
          description: 'Ambientes nomeados: Sala, Quarto 1, Cozinha, WC...',
          icon: Tag,
          status: 'done',
        },
      ],
    },
    {
      id: 'modelo',
      name: '🏠 MODELO 3D COMPLETO',
      description: 'Paredes + Pisos + Tetos + Ambientes integrados',
      icon: Home,
      status: 'done',
      action: 'editor',
      children: [
        {
          id: 'camadas',
          name: '🗂️ Layers',
          description: 'LAYER_01_WALLS, LAYER_02_FLOORS, LAYER_03_CEILINGS',
          icon: Layers,
          status: 'done',
        },
        {
          id: 'referencias',
          name: '🔗 source_2d',
          description: 'Cada objeto 3D mantém referência à linha 2D original',
          icon: Tag,
          status: 'done',
        },
      ],
    },
    {
      id: 'editor',
      name: '✏️ EDITOR GESTOR',
      description: 'Mover, redimensionar, criar, apagar objetos',
      icon: Edit3,
      status: 'done',
      action: 'editor',
    },
    {
      id: 'detalhe',
      name: '🎨 DETALHAMENTO',
      description: 'Materiais, texturas, iluminação arquitetônica',
      icon: Sparkles,
      status: 'pending',
    },
    {
      id: 'ar',
      name: '📱 AR',
      description: 'Posicionamento em superfície real, escala 1:1',
      icon: Smartphone,
      status: 'done',
      action: 'ar',
    },
  ];

  const flatNodes = (nodes: PipelineNode[]): PipelineNode[] => {
    return nodes.flatMap(n => [n, ...(n.children || [])]);
  };
  
  const allNodes = flatNodes(hierarchy);
  const completedCount = allNodes.filter(n => n.status === 'done').length;
  const totalCount = allNodes.length;
  const progressPercent = (completedCount / totalCount) * 100;

  const renderNode = (node: PipelineNode, level: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    
    return (
      <div key={node.id} className="relative">
        <button
          onClick={() => {
            if (hasChildren) toggleExpand(node.id);
          }}
          className={`w-full text-left rounded-xl p-3 transition-all ${
            level === 0 
              ? 'bg-slate-800/70 hover:bg-slate-800 border border-slate-700' 
              : 'bg-slate-900/50 hover:bg-slate-900/70 border border-slate-800'
          } ${level > 0 ? 'ml-8' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              node.status === 'done' ? 'bg-green-500/20 text-green-400' :
              'bg-slate-700 text-slate-500'
            }`}>
              {node.status === 'done' ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
            </div>
            
            <div className="flex-1">
              <h3 className={`font-bold text-sm flex items-center gap-2 ${
                level === 0 ? 'text-white' : 'text-slate-300'
              }`}>
                {node.name}
              </h3>
              <p className={`text-xs mt-0.5 ${level === 0 ? 'text-slate-400' : 'text-slate-500'}`}>
                {node.description}
              </p>
            </div>
            
            {hasChildren && (
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            )}
            
            {node.action && !hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate?.(node.action!);
                }}
                className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg flex items-center gap-1"
              >
                Ir
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </button>
        
        {hasChildren && isExpanded && (
          <div className="mt-2 space-y-2">
            {/* Vertical connector line */}
            <div className="ml-12 border-l-2 border-slate-700 pl-2 space-y-2">
              {node.children!.map((child) => renderNode(child, level + 1))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Layers className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="font-bold text-white">Hierarquia FloorVision</h1>
            <p className="text-slate-400 text-sm">Geometria → Semântica → 3D → AR</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white text-sm font-medium">Progresso da Hierarquia</span>
          <span className="text-cyan-400 text-sm font-bold">
            {completedCount}/{totalCount} ({progressPercent.toFixed(0)}%)
          </span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Hierarchy visualization */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {hierarchy.map((node, i) => (
            <div key={node.id}>
              {renderNode(node, 0)}
              
              {/* Connector arrow */}
              {i < hierarchy.length - 1 && (
                <div className="flex justify-center py-1">
                  <div className="w-0.5 h-3 bg-gradient-to-b from-cyan-500 to-slate-700"></div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="max-w-2xl mx-auto mt-6 bg-slate-800/50 border border-slate-700 rounded-2xl p-4">
          <h3 className="text-white font-bold mb-3">📚 Hierarquia Implementada</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-300">
              <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
              <span><strong>PLANTA 2D</strong> = GEOMETRIA + SEMÂNTICA</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300 ml-4 text-xs">
              <span>• GEOMETRIA = linhas/pontos</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300 ml-4 text-xs">
              <span>• SEMÂNTICA = quarto/cozinha</span>
            </div>
            <div className="w-full h-px bg-slate-700 my-2"></div>
            <div className="flex items-center gap-2 text-slate-300">
              <div className="w-2 h-2 rounded-full bg-purple-400"></div>
              <span><strong>ESTRUTURA 3D</strong> = GEOMETRIA + SEMÂNTICA</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300 ml-4 text-xs">
              <span>• GEOMETRIA = caixas/planos</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300 ml-4 text-xs">
              <span>• SEMÂNTICA = ambientes</span>
            </div>
            <div className="w-full h-px bg-slate-700 my-2"></div>
            <div className="flex items-center gap-2 text-slate-300">
              <div className="w-2 h-2 rounded-full bg-green-400"></div>
              <span><strong>MODELO 3D</strong> = Integração completa com source_2d</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
