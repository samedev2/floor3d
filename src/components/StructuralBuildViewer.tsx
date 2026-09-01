import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  HardHat,
  Table2,
  Ruler,
  Scissors,
  Eye,
  Layers,
  Gauge,
} from 'lucide-react';
import { useStore } from '../store';
import { buildQB5DFromStructural } from '../qb5d';
import { MATERIAL_COLOR } from '../qb5d/standards';
import { CASA_6X8_PLAN, HAND_DRAWN_PLAN } from '../floorplan/structuralIntelligence';
import type { QB5DElement, QB5DModel, MaterialKey } from '../qb5d/types';
import { QuantitiesPanel } from './QuantitiesPanel';

// ============================================
// Helpers de animação
// ============================================
const smooth = (x: number) => x * x * (3 - 2 * x);

function growth(el: QB5DElement, t: number): number {
  if (t <= el.tStart) return 0;
  if (t >= el.tEnd) return 1;
  return smooth((t - el.tStart) / Math.max(1e-4, el.tEnd - el.tStart));
}

const TRANSLUCENT: MaterialKey[] = ['vidro'];

// Configuração estável do Canvas (evita reconfigurar o renderer a cada tick)
const CANVAS_DPR: [number, number] = [1, 1.75];
const CANVAS_CAMERA = { position: [12, 10, 14] as [number, number, number], fov: 55 };
const CANVAS_GL = { antialias: true, powerPreference: 'high-performance' as const };

// ============================================
// Grupo instanciado por material
// ============================================
function BuildGroup({
  elements,
  materialKey,
  progressRef,
  alvOpacity,
  isolate,
  clipPlane,
}: {
  elements: QB5DElement[];
  materialKey: MaterialKey;
  progressRef: React.MutableRefObject<number>;
  alvOpacity: number;
  isolate: string | null;
  clipPlane: THREE.Plane | null;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  const isAlv = materialKey === 'bloco_ceramico';
  const translucent = TRANSLUCENT.includes(materialKey) || (isAlv && alvOpacity < 1);

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(MATERIAL_COLOR[materialKey]),
      roughness: materialKey === 'vidro' ? 0.1 : 0.92,
      metalness: 0,
      transparent: translucent,
      opacity: materialKey === 'vidro' ? 0.35 : isAlv ? alvOpacity : 1,
    });
    if (clipPlane) m.clippingPlanes = [clipPlane];
    return m;
  }, [materialKey, translucent, isAlv, alvOpacity, clipPlane]);

  useEffect(() => () => {
    geom.dispose();
    mat.dispose();
  }, [geom, mat]);

  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const t = progressRef.current;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      let g = growth(el, t);
      if (isolate && el.phase !== isolate) g = 0;
      const [sx, sy, sz] = el.transform.size;
      const [px, py, pz] = el.transform.position;
      const hy = Math.max(1e-4, sy * g);
      let cy = py;
      if (el.anchor === 'base') cy = py - sy / 2 + hy / 2;
      else if (el.anchor === 'top') cy = py + sy / 2 - hy / 2;
      const lat = el.anchor === 'center' ? Math.max(1e-4, 0.55 + 0.45 * g) : 1;
      dummy.position.set(px, cy, pz);
      dummy.rotation.set(el.transform.rotation[0], el.transform.rotation[1], el.transform.rotation[2]);
      dummy.scale.set(Math.max(1e-4, sx * lat), hy, Math.max(1e-4, sz * lat));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, elements.length]}
      castShadow={!translucent}
      receiveShadow
      frustumCulled={false}
    />
  );
}

// ============================================
// Driver do relógio da animação
// ============================================
function Clock({
  progressRef,
  playing,
  durationSec,
  onTick,
}: {
  progressRef: React.MutableRefObject<number>;
  playing: boolean;
  durationSec: number;
  onTick: (t: number) => void;
}) {
  const lastEmit = useRef(-1);
  useFrame((_, delta) => {
    if (playing && progressRef.current < 1) {
      progressRef.current = Math.min(1, progressRef.current + Math.min(delta, 0.1) / durationSec);
    }
    // só re-renderiza a HUD quando o percentual (0,5%) muda
    const bucket = Math.round(progressRef.current * 200);
    if (bucket !== lastEmit.current) {
      lastEmit.current = bucket;
      onTick(progressRef.current);
    }
  });
  return null;
}

// ============================================
// Enquadra a câmera ao modelo
// ============================================
function FrameCamera({ model }: { model: QB5DModel }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  useEffect(() => {
    const [minx, miny, minz] = model.bounds.min;
    const [maxx, maxy, maxz] = model.bounds.max;
    const cx = (minx + maxx) / 2;
    const cy = (miny + maxy) / 2;
    const cz = (minz + maxz) / 2;
    const r = Math.max(maxx - minx, maxy - miny, maxz - minz);
    camera.position.set(cx + r * 0.9, cy + r * 0.8, cz + r * 1.15);
    camera.near = 0.05;
    camera.far = r * 12;
    camera.updateProjectionMatrix();
    if (controls.current) {
      controls.current.target.set(cx, cy * 0.6, cz);
      controls.current.update();
    }
  }, [model, camera]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      minDistance={1}
      maxDistance={400}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}

// ============================================
// Cotas principais
// ============================================
function Dimensions({ model }: { model: QB5DModel }) {
  const [minx, miny, minz] = model.bounds.min;
  const [maxx, , maxz] = model.bounds.max;
  const y = miny - 0.15;
  const label = (p: [number, number, number], txt: string) => (
    <Html position={p} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
      <div className="px-1.5 py-0.5 rounded bg-slate-900/80 text-[10px] text-cyan-200 whitespace-nowrap border border-cyan-500/30">
        {txt}
      </div>
    </Html>
  );
  return (
    <group>
      <Line points={[[minx, y, minz - 0.3], [maxx, y, minz - 0.3]]} color="#22d3ee" lineWidth={1} />
      <Line points={[[minx - 0.3, y, minz], [minx - 0.3, y, maxz]]} color="#22d3ee" lineWidth={1} />
      <Line points={[[minx - 0.3, miny, minz - 0.3], [minx - 0.3, miny + model.meta.peDireito, minz - 0.3]]} color="#22d3ee" lineWidth={1} />
      {label([(minx + maxx) / 2, y, minz - 0.55], `${(maxx - minx).toFixed(2)} m`)}
      {label([minx - 0.55, y, (minz + maxz) / 2], `${(maxz - minz).toFixed(2)} m`)}
      {label([minx - 0.55, miny + model.meta.peDireito / 2, minz - 0.3], `pé-direito ${model.meta.peDireito.toFixed(2)} m`)}
    </group>
  );
}

// ============================================
// Cena
// ============================================
function Scene({
  model,
  progressRef,
  playing,
  durationSec,
  onTick,
  alvOpacity,
  isolate,
  showDims,
  clip,
}: {
  model: QB5DModel;
  progressRef: React.MutableRefObject<number>;
  playing: boolean;
  durationSec: number;
  onTick: (t: number) => void;
  alvOpacity: number;
  isolate: string | null;
  showDims: boolean;
  clip: number | null;
}) {
  const { gl } = useThree();
  const clipPlane = useMemo(
    () => (clip == null ? null : new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)),
    [clip == null]
  );
  useEffect(() => {
    gl.localClippingEnabled = clip != null;
  }, [gl, clip]);
  useEffect(() => {
    if (clipPlane && clip != null) clipPlane.constant = clip;
  }, [clipPlane, clip]);

  const groups = useMemo(() => {
    const byMat = new Map<MaterialKey, QB5DElement[]>();
    for (const el of model.elements) {
      const arr = byMat.get(el.material) ?? [];
      arr.push(el);
      byMat.set(el.material, arr);
    }
    return [...byMat.entries()];
  }, [model]);

  const groundY = model.bounds.min[1];

  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#eaf2ff', '#5a4633', 0.5]} />
      <directionalLight
        position={[model.bounds.max[0] + 8, model.bounds.max[1] + 14, model.bounds.max[2] + 10]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />

      <Grid
        position={[0, groundY - 0.001, 0]}
        args={[60, 60]}
        cellSize={0.5}
        cellColor="#334155"
        sectionSize={2}
        sectionColor="#475569"
        fadeDistance={45}
        infiniteGrid
      />
      <mesh position={[0, groundY - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#0f172a" roughness={1} />
      </mesh>

      {groups.map(([matKey, els]) => (
        <BuildGroup
          key={matKey}
          elements={els}
          materialKey={matKey}
          progressRef={progressRef}
          alvOpacity={alvOpacity}
          isolate={isolate}
          clipPlane={clipPlane}
        />
      ))}

      {showDims && <Dimensions model={model} />}

      <Clock progressRef={progressRef} playing={playing} durationSec={durationSec} onTick={onTick} />
      <FrameCamera model={model} />
    </>
  );
}

// ============================================
// Componente principal
// ============================================
interface Props {
  onClose?: () => void;
}

export function StructuralBuildViewer({ onClose }: Props) {
  const { qb5dModel, qb5dPlaybackKey, qb5dOptions, setQb5dModel, bumpQb5dPlayback, setQb5dOptions } =
    useStore();

  const progressRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [alvOpacity, setAlvOpacity] = useState(1);
  const [isolate, setIsolate] = useState<string | null>(null);
  const [showDims, setShowDims] = useState(false);
  const [clipOn, setClipOn] = useState(false);
  const [showQty, setShowQty] = useState(false);

  // (re)inicia a animação quando muda a planta
  useEffect(() => {
    progressRef.current = 0;
    setT(0);
    setPlaying(true);
  }, [qb5dPlaybackKey, qb5dModel]);

  const durationSec = Math.max(3, qb5dOptions.durationSec) / speed;

  const loadDemo = useCallback(
    (which: '6x8' | '2pav') => {
      const src = which === '6x8' ? CASA_6X8_PLAN : HAND_DRAWN_PLAN;
      const model = buildQB5DFromStructural(src, {
        lajePreMoldada: qb5dOptions.lajePreMoldada,
        mostrarPintura: qb5dOptions.mostrarPintura,
      });
      setQb5dModel(model);
      bumpQb5dPlayback();
    },
    [qb5dOptions, setQb5dModel, bumpQb5dPlayback]
  );

  const restart = () => {
    progressRef.current = 0;
    setT(0);
    setPlaying(true);
  };

  const scrub = (v: number) => {
    progressRef.current = v;
    setT(v);
  };

  // fase atual + fiada
  const currentPhase = useMemo(() => {
    if (!qb5dModel) return null;
    let cur = qb5dModel.phases[0];
    for (const p of qb5dModel.phases) if (t >= p.tStart - 1e-6) cur = p;
    return cur;
  }, [qb5dModel, t]);

  const fiadaInfo = useMemo(() => {
    if (!qb5dModel || !currentPhase || currentPhase.key !== 'alvenaria') return null;
    const frac = (t - currentPhase.tStart) / Math.max(1e-4, currentPhase.tEnd - currentPhase.tStart);
    const f = Math.min(qb5dModel.fiadas, Math.max(1, Math.ceil(frac * qb5dModel.fiadas)));
    return `fiada ${f}/${qb5dModel.fiadas}`;
  }, [qb5dModel, currentPhase, t]);

  const clip = clipOn && qb5dModel ? qb5dModel.bounds.max[2] - (qb5dModel.bounds.max[2] - qb5dModel.bounds.min[2]) * (0.15 + 0.7 * (1 - t)) : null;

  // ---------------- Empty state ----------------
  if (!qb5dModel) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 to-slate-950 flex flex-col">
        <Header onClose={onClose} subtitle="Estruturação da fundação ao acabamento" />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 rounded-3xl bg-amber-500/15 flex items-center justify-center mb-5">
            <HardHat className="w-10 h-10 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Nenhuma planta carregada</h2>
          <p className="text-slate-400 max-w-md mb-6 text-sm">
            Importe uma planta 2D na tela inicial para gerar a estrutura real (concreto
            armado + alvenaria de vedação, ABNT/NBR) com animação da obra. Ou veja um
            exemplo pronto:
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => loadDemo('6x8')}
              className="px-5 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold"
            >
              Exemplo — Casa 6×8 (térreo)
            </button>
            <button
              onClick={() => loadDemo('2pav')}
              className="px-5 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold"
            >
              Exemplo — Sobrado 7,5×11,25
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Viewer ----------------
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <Header
        onClose={onClose}
        subtitle={`${qb5dModel.meta.elementCount} elementos · ${qb5dModel.foundationType.replace('_', ' ')} · ${qb5dModel.meta.area.toFixed(1)} m²${qb5dModel.meta.lod ? ' · LOD' : ''}`}
      />

      <div className="flex-1 relative">
        <Canvas shadows dpr={CANVAS_DPR} camera={CANVAS_CAMERA} gl={CANVAS_GL}>
          <color attach="background" args={['#0b1220']} />
          <Scene
            model={qb5dModel}
            progressRef={progressRef}
            playing={playing}
            durationSec={durationSec}
            onTick={setT}
            alvOpacity={alvOpacity}
            isolate={isolate}
            showDims={showDims}
            clip={clip}
          />
        </Canvas>

        {/* HUD topo-esquerda: fase atual */}
        <div className="absolute top-4 left-4 bg-slate-900/85 backdrop-blur rounded-xl p-3 border border-slate-700 max-w-[230px]">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: currentPhase?.color ?? '#888' }}
            />
            <span className="text-white text-sm font-bold">{currentPhase?.label ?? '—'}</span>
          </div>
          <div className="text-slate-400 text-xs">
            {Math.round(t * 100)}% da obra{fiadaInfo ? ` · ${fiadaInfo}` : ''}
          </div>
        </div>

        {/* Legenda de fases topo-direita */}
        <div className="absolute top-4 right-4 bg-slate-900/85 backdrop-blur rounded-xl p-2 border border-slate-700 hidden sm:block">
          {qb5dModel.phases.map((p) => {
            const done = t >= p.tEnd - 1e-6;
            const active = currentPhase?.key === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setIsolate(isolate === p.key ? null : p.key)}
                className={`flex items-center gap-2 w-full px-2 py-1 rounded text-left text-xs transition-colors ${
                  isolate === p.key ? 'bg-cyan-600/30' : active ? 'bg-slate-700/60' : 'hover:bg-slate-800'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color, opacity: done || active ? 1 : 0.3 }} />
                <span className={done || active ? 'text-white' : 'text-slate-500'}>{p.label}</span>
              </button>
            );
          })}
          {isolate && <div className="text-[10px] text-cyan-400 px-2 pt-1">clique de novo p/ ver tudo</div>}
        </div>

        {/* Avisos de sanidade */}
        {qb5dModel.bom.warnings.length > 0 && (
          <div className="absolute bottom-36 left-4 max-w-[280px] bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 text-[11px] text-amber-200 space-y-1">
            {qb5dModel.bom.warnings.slice(0, 3).map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
          </div>
        )}
      </div>

      {/* Barra de controles */}
      <div className="bg-slate-900/95 border-t border-slate-800 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="w-10 h-10 rounded-lg bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center text-white flex-shrink-0"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button
            onClick={restart}
            className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white flex-shrink-0"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={t}
            onChange={(e) => scrub(parseFloat(e.target.value))}
            className="flex-1 accent-cyan-500"
          />
          <div className="flex items-center gap-1 flex-shrink-0">
            {[0.5, 1, 2].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  speed === s ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Toggle active={showDims} onClick={() => setShowDims((v) => !v)} icon={<Ruler className="w-4 h-4" />} label="Cotas" />
          <Toggle active={clipOn} onClick={() => setClipOn((v) => !v)} icon={<Scissors className="w-4 h-4" />} label="Corte" />
          <Toggle
            active={alvOpacity < 1}
            onClick={() => setAlvOpacity((v) => (v < 1 ? 1 : 0.35))}
            icon={<Eye className="w-4 h-4" />}
            label="Alvenaria translúcida"
          />
          <Toggle
            active={qb5dOptions.lajePreMoldada}
            onClick={() => setQb5dOptions({ lajePreMoldada: !qb5dOptions.lajePreMoldada })}
            icon={<Layers className="w-4 h-4" />}
            label="Laje pré-moldada"
          />
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg px-2 py-1.5 flex-shrink-0">
            <Gauge className="w-4 h-4 text-slate-400" />
            <span className="text-[11px] text-slate-400">Duração</span>
            <input
              type="range"
              min={6}
              max={40}
              step={1}
              value={qb5dOptions.durationSec}
              onChange={(e) => setQb5dOptions({ durationSec: parseInt(e.target.value) })}
              className="w-20 accent-cyan-500"
            />
            <span className="text-[11px] text-white w-8">{qb5dOptions.durationSec}s</span>
          </div>
          <button
            onClick={() => setShowQty(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex-shrink-0"
          >
            <Table2 className="w-4 h-4" />
            Quantitativo (QB · 5D)
          </button>
        </div>
      </div>

      {showQty && <QuantitiesPanel model={qb5dModel} onClose={() => setShowQty(false)} />}
    </div>
  );
}

function Header({ onClose, subtitle }: { onClose?: () => void; subtitle: string }) {
  return (
    <div className="flex items-center justify-between p-4 bg-slate-900/80 backdrop-blur border-b border-slate-800 z-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
          <HardHat className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h1 className="font-bold text-white text-sm">Estrutura Real · QB5D</h1>
          <p className="text-slate-400 text-xs">{subtitle}</p>
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${
        active ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
