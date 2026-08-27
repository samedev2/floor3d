import { create } from 'zustand';

interface AppState {
  processedPlan: any;
  model3d: any;
  viewMode: '2d' | '3d' | 'ar';
  isProcessing: boolean;
  error: string | null;
  showGrid: boolean;
  
  // Captured image for AR overlay
  capturedImage: string | null;
  
  // AR overlay controls
  arScale: number;
  arPosition: { x: number; y: number };
  arRotation: number;
  arPinned: boolean;
  arMode: 'idle' | 'adjusting' | 'pinned';
  
  setProcessedPlan: (plan: any) => void;
  setModel3d: (model: any) => void;
  setViewMode: (mode: '2d' | '3d' | 'ar') => void;
  setIsProcessing: (processing: boolean) => void;
  setError: (error: string | null) => void;
  toggleGrid: () => void;
  
  // AR image
  setCapturedImage: (image: string | null) => void;
  
  // AR controls
  setArScale: (scale: number) => void;
  setArPosition: (pos: { x: number; y: number }) => void;
  setArRotation: (rotation: number) => void;
  setArPinned: (pinned: boolean) => void;
  setArMode: (mode: 'idle' | 'adjusting' | 'pinned') => void;
  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  processedPlan: null,
  model3d: null,
  viewMode: '2d',
  isProcessing: false,
  error: null,
  showGrid: true,
  
  // AR image
  capturedImage: null,
  
  // AR controls
  arScale: 1,
  arPosition: { x: 0, y: 0 },
  arRotation: 0,
  arPinned: false,
  arMode: 'idle',
  
  setProcessedPlan: (plan) => set({ processedPlan: plan }),
  setModel3d: (model) => set({ model3d: model }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setError: (error) => set({ error }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  
  // AR image
  setCapturedImage: (image) => set({ capturedImage: image }),
  
  // AR controls
  setArScale: (scale) => set({ arScale: scale }),
  setArPosition: (pos) => set({ arPosition: pos }),
  setArRotation: (rotation) => set({ arRotation: rotation }),
  setArPinned: (pinned) => set({ arPinned: pinned }),
  setArMode: (mode) => set({ arMode: mode }),
  
  reset: () => set({
    processedPlan: null,
    model3d: null,
    viewMode: '2d',
    isProcessing: false,
    error: null,
    capturedImage: null,
    arScale: 1,
    arPosition: { x: 0, y: 0 },
    arRotation: 0,
    arPinned: false,
    arMode: 'idle',
  }),
}));
