// =====================================================================
// QB5D — render.js
// Meshes Three.js dos elementos + animação 4D (sequence.js) + tema de
// visualização estilo maquete/BIM (fundo escuro, grid, tijolo com fiada,
// alvenaria que "reboca" na fase de acabamento).
// Convenção de coordenadas (igual ao dashboard):
//     worldX = (x - cx) * s ;  worldY = altura (m) ;  worldZ = -(y - cy) * s
// =====================================================================

import { LAYER_BY_ID, PLASTER_COLOR } from "./params.js";

const DROP_M = 1.15;
const easeOutCubic = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

// Textura procedural de alvenaria — fiadas horizontais + juntas verticais
// desencontradas, com "argamassa" clara nas juntas.
function makeBrickTexture(THREE) {
  const W = 256, H = 256, rows = 8, cols = 4;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#6b6b66";                 // junta / argamassa
  g.fillRect(0, 0, W, H);
  const bh = H / rows, bw = W / cols, gap = 3;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let k = -1; k < cols + 1; k++) {
      const x = k * bw + off + gap / 2;
      const y = r * bh + gap / 2;
      const shade = 0.86 + Math.random() * 0.22;
      const R = Math.round(176 * shade), Gc = Math.round(78 * shade), B = Math.round(46 * shade);
      g.fillStyle = `rgb(${R},${Gc},${B})`;
      g.fillRect(x, y, bw - gap, bh - gap);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createQB5DRenderer({ THREE }) {
  const brickTex = makeBrickTexture(THREE);

  const baseMaterials = {
    concreto: new THREE.MeshStandardMaterial({ color: 0xdfe1e3, roughness: 0.9, metalness: 0 }),
    alvenaria: new THREE.MeshStandardMaterial({ color: 0xb0512c, roughness: 0.95, metalness: 0 }),
    magro: new THREE.MeshStandardMaterial({ color: 0xc4c4c0, roughness: 0.98, metalness: 0 }),
    esquadria: new THREE.MeshStandardMaterial({ color: 0x9a8158, roughness: 0.6, metalness: 0.1 }),
    mobilia: new THREE.MeshStandardMaterial({ color: 0x5f9ea0, roughness: 0.7, metalness: 0.05 }),
    vidro: new THREE.MeshPhysicalMaterial({
      color: 0xbcd3dd, roughness: 0.05, metalness: 0,
      transparent: true, opacity: 0.34, transmission: 0.4, ior: 1.45,
    }),
  };
  const plasterMatBase = new THREE.MeshStandardMaterial({
    color: PLASTER_COLOR, roughness: 0.92, metalness: 0,
  });
  const MAX_OPACITY = { vidro: 0.34 };
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x223, transparent: true, opacity: 0.25 });

  const state = {
    group: new THREE.Group(),
    items: [],
    sequence: null,
    layerVisible: {},
    scale: 1,
    lastT: 0,
    playing: false,
    speed: 1,
    scene: null,
    prevBg: null,
    themed: false,
  };
  state.group.name = "qb5d";

  function disposeExtras() {
    for (let i = state.group.children.length - 1; i >= 0; i--) {
      const c = state.group.children[i];
      if (c.userData.qb5dTerrain || c.userData.qb5dGrid) {
        c.geometry?.dispose();
        if (c.material?.dispose) c.material.dispose();
        state.group.remove(c);
      }
    }
  }

  function clear() {
    for (const it of state.items) {
      it.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose && o.material !== edgeMat) o.material.dispose();
      });
      state.group.remove(it.group);
    }
    state.items.length = 0;
    disposeExtras();
  }

  // ----- tema de cena (fundo escuro + grid) -----
  function applyScene(structure, cx, cy, s) {
    if (!state.scene) return;
    if (!state.themed) {
      state.prevBg = state.scene.background;
      state.themed = true;
    }
    state.scene.background = new THREE.Color(0x0a0e1a);
  }
  function restoreScene() {
    if (state.scene && state.themed) {
      state.scene.background = state.prevBg;
      state.themed = false;
    }
  }

  // ----- geometria de um elemento -----
  function buildElement(el, cx, cy, s) {
    if (el.shape === "none") return null;
    const layer = LAYER_BY_ID[el.layer] || { color: 0x999999 };
    const isBrick = el.material === "alvenaria";
    const mat = (baseMaterials[el.material] || baseMaterials.concreto).clone();
    if (el.material !== "vidro") mat.color = new THREE.Color(layer.color);
    mat.transparent = true;
    mat.opacity = MAX_OPACITY[el.material] ?? 1;
    if (isBrick) {
      mat.map = brickTex.clone();
      mat.map.needsUpdate = true;
      const rep = el.brickRepeat || { x: 3, y: 2 };
      mat.map.repeat.set(rep.x, rep.y);
      mat.color = new THREE.Color(0xffffff); // deixa a textura mandar
    }

    const holder = new THREE.Group();
    holder.position.y = el.base_m;

    let mesh;
    if (el.shape === "box") {
      const w = Math.max(el.w_px * s, 1e-3);
      const d = Math.max(el.d_px * s, 1e-3);
      const h = Math.max(el.height_m, 1e-3);
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, h / 2, 0);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((el.center.x - cx) * s, 0, -(el.center.y - cy) * s);
      mesh.rotation.y = el.angleRad || 0;
    } else {
      const shape = new THREE.Shape();
      el.outline.forEach(([x, y], i) => {
        const sx = (x - cx) * s, sy = (y - cy) * s;
        i ? shape.lineTo(sx, sy) : shape.moveTo(sx, sy);
      });
      shape.closePath();
      for (const hole of el.holes || []) {
        if (!hole || hole.length < 3) continue;
        const path = new THREE.Path();
        hole.forEach(([x, y], i) => {
          const sx = (x - cx) * s, sy = (y - cy) * s;
          i ? path.lineTo(sx, sy) : path.moveTo(sx, sy);
        });
        path.closePath();
        shape.holes.push(path);
      }
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(el.height_m, 1e-3), bevelEnabled: false, curveSegments: 2,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    let elEdgeMat = null;
    if (el.material === "concreto" || el.material === "alvenaria") {
      try {
        const eg = new THREE.EdgesGeometry(mesh.geometry, 25);
        elEdgeMat = edgeMat.clone();
        mesh.add(new THREE.LineSegments(eg, elEdgeMat));
      } catch { /* geom degenerada */ }
    }
    holder.add(mesh);

    const wrap = new THREE.Group();
    wrap.add(holder);
    wrap.visible = state.layerVisible[el.layer] !== false;

    let plasterMat = null;
    if (isBrick) {
      plasterMat = plasterMatBase.clone();
      plasterMat.transparent = true;
    }
    return {
      wrap, mat, mesh, edgeMat: elEdgeMat, plasterMat,
      brickMat: mat, courses: el.courses || 0, baseY: el.base_m,
    };
  }

  // ----- terreno + grid (estilo maquete) -----
  function addTerrainGrid(structure, cx, cy, s) {
    let minBase = 0, maxX = -1e9, minX = 1e9, maxZ = -1e9, minZ = 1e9;
    for (const el of structure.elements) {
      if (el.shape === "none") continue;
      minBase = Math.min(minBase, el.base_m);
      const pts = el.shape === "box" ? [[el.center.x, el.center.y]] : (el.outline || []);
      for (const [x, y] of pts) {
        const wx = (x - cx) * s, wz = -(y - cy) * s;
        maxX = Math.max(maxX, wx); minX = Math.min(minX, wx);
        maxZ = Math.max(maxZ, wz); minZ = Math.min(minZ, wz);
      }
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 4);
    const cxw = (minX + maxX) / 2, czw = (minZ + maxZ) / 2;
    const y = minBase - 0.03;

    const gsize = Math.ceil(span * 3.2);
    const grid = new THREE.GridHelper(gsize, Math.max(10, Math.round(gsize)), 0x2a3a5c, 0x18243c);
    grid.position.set(cxw, y + 0.005, czw);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.userData.qb5dGrid = true;
    state.group.add(grid);

    const geo = new THREE.PlaneGeometry(gsize, gsize);
    geo.rotateX(-Math.PI / 2);
    const plane = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x0c1120, roughness: 1, metalness: 0,
    }));
    plane.position.set(cxw, y, czw);
    plane.receiveShadow = true;
    plane.userData.qb5dTerrain = true;
    state.group.add(plane);
  }

  // =============================================================
  return {
    group: state.group,
    attachScene(scene) { state.scene = scene; },
    restoreScene,

    build(structure, sequence, framing) {
      clear();
      state.sequence = sequence;
      state.scale = framing.scale;
      const { cx, cy, scale: s } = framing;

      applyScene(structure, cx, cy, s);
      addTerrainGrid(structure, cx, cy, s);

      for (const el of structure.elements) {
        const parts = buildElement(el, cx, cy, s);
        if (!parts) continue;
        state.group.add(parts.wrap);
        state.items.push({
          elementId: el.id, layer: el.layer,
          entrance: sequence.entranceOf.get(el.id)?.type || "fade",
          group: parts.wrap, mat: parts.mat, mesh: parts.mesh,
          edgeMat: parts.edgeMat, plasterMat: parts.plasterMat, brickMat: parts.brickMat,
          courses: parts.courses, baseY: parts.baseY,
          maxOpacity: MAX_OPACITY[el.material] ?? 1,
          plastered: false,
        });
      }
      this.seek(0);

      const box = new THREE.Box3().setFromObject(state.group);
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2 || 5;
      return { group: state.group, framing: { center, radius } };
    },

    seek(tMs) {
      state.lastT = tMs;
      const seq = state.sequence;
      if (!seq) return;
      const rebocoOn = tMs >= (seq.rebocoStartMs ?? Infinity);
      for (const it of state.items) {
        const p = seq.progressOf(it.elementId, tMs);
        const e = easeOutCubic(p);
        const g = it.group;
        g.scale.set(1, 1, 1);
        g.position.y = 0;
        const mo = it.maxOpacity ?? 1;

        if (it.entrance === "courses") {
          // sobe fiada a fiada
          const n = Math.max(1, it.courses || 12);
          const done = p >= 1 ? n : Math.floor(easeOutCubic(p) * n + 1e-6);
          g.scale.y = Math.max(0.001, done / n);
          it.mat.opacity = p > 0 ? mo : 0;
        } else if (it.entrance === "rise") {
          g.scale.y = Math.max(0.001, e);
          it.mat.opacity = p > 0 ? mo : 0;
        } else if (it.entrance === "drop") {
          g.position.y = (1 - e) * DROP_M;
          it.mat.opacity = e * mo;
        } else {
          g.scale.setScalar(0.96 + 0.04 * e);
          it.mat.opacity = e * mo;
        }
        it.mat.opacity = Math.max(0, Math.min(1, it.mat.opacity));
        it.mat.depthWrite = it.mat.opacity > 0.98;
        if (it.edgeMat) it.edgeMat.opacity = 0.25 * it.mat.opacity;

        // troca alvenaria -> reboco na fase de acabamento
        if (it.plasterMat) {
          const wantPlaster = rebocoOn && p >= 1;
          if (wantPlaster && !it.plastered) {
            it.mesh.material = it.plasterMat; it.plastered = true;
            if (it.edgeMat) it.edgeMat.opacity = 0;
          } else if (!wantPlaster && it.plastered) {
            it.mesh.material = it.brickMat; it.plastered = false;
          }
        }
      }
    },

    tick(nowMs) {
      if (!state.sequence) return;
      if (state.playing) {
        let dt = nowMs - (state._prev == null ? nowMs : state._prev);
        if (!Number.isFinite(dt) || dt < 0) dt = 0;
        if (dt > 100) dt = 16;
        state.lastT += dt * state.speed;
        if (state.lastT >= state.sequence.totalMs) {
          state.lastT = state.sequence.totalMs;
          state.playing = false;
          state.onEnd && state.onEnd();
        }
        this.seek(state.lastT);
        state.onProgress && state.onProgress(state.lastT);
      }
      state._prev = nowMs;
    },

    play() {
      state.playing = true; state._prev = undefined;
      if (state.sequence && state.lastT >= state.sequence.totalMs) state.lastT = 0;
    },
    pause() { state.playing = false; },
    isPlaying() { return state.playing; },
    setSpeed(x) { state.speed = x || 1; },
    get time() { return state.lastT; },
    get duration() { return state.sequence ? state.sequence.totalMs : 0; },

    goToStage(stageId) {
      const st = state.sequence?.stageById(stageId);
      if (!st) return;
      state.playing = false;
      this.seek(st.startMs + st.durationMs);
    },

    setLayerVisible(layerId, on) {
      state.layerVisible[layerId] = on;
      for (const it of state.items) if (it.layer === layerId) it.group.visible = on;
    },
    getLayers() { return [...new Set(state.items.map((it) => it.layer))]; },

    onEnd(fn) { state.onEnd = fn; },
    onProgress(fn) { state.onProgress = fn; },

    dispose() { clear(); restoreScene(); },
  };
}
