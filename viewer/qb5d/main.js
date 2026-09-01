// =====================================================================
// QB5D — main.js
// Orquestra o pipeline (calibração -> topologia -> estrutura -> sequência
// -> render 4D -> quantitativo) e integra ao dashboard via window.__QB5D_HOST.
//
// O dashboard (script module inline de index.dashboard.html) publica o HOST
// com scene/camera/helpers e chama host.onPlanLoaded(data,{cx,cy,scale}) ao
// final de loadPlan(), e host.onFrame(now) a cada quadro.
// =====================================================================

import {
  getMetersPerPixel, getCalibration, isCalibrated, setByScale100, guessMetersPer100,
} from "./calibration.js";
import { DEFAULT_PARAMS, DEFAULT_PRICES_BRL } from "./params.js";
import { buildTopology } from "./topology.js";
import { generateStructure } from "./structure.js";
import { buildSequence } from "./sequence.js";
import { createQB5DRenderer } from "./render.js";
import { buildQuantities } from "./quantities.js";
import { mountStructureScreen, mountTimeline } from "./ui.js";

const clone = (o) => JSON.parse(JSON.stringify(o));

function whenHost(cb) {
  if (window.__QB5D_HOST) return cb(window.__QB5D_HOST);
  let tries = 0;
  const iv = setInterval(() => {
    if (window.__QB5D_HOST) { clearInterval(iv); cb(window.__QB5D_HOST); }
    else if (++tries > 240) { clearInterval(iv); console.warn("QB5D: host não apareceu"); }
  }, 25);
}

whenHost((host) => {
  const THREE = host.THREE;
  const renderer = createQB5DRenderer({ THREE });
  renderer.attachScene(host.scene);
  host.scene.add(renderer.group);
  renderer.group.visible = false;

  const demos = host.demos;
  const planMeta = host.planMeta;

  let params = clone(DEFAULT_PARAMS);
  let pendingPlanKey = null;
  let qb5dActive = false;
  let timeline = null;
  let lastStructure = null;
  let lastQuant = null;

  function bboxOf(key) {
    const d = demos[key];
    if (!d) return { w: 0, h: 0 };
    const bb = host.polygonsBBox(d.polygons);
    return { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY };
  }

  const structUI = mountStructureScreen({
    planMeta,
    getCalibrationInfo(key) {
      const mpp = getMetersPerPixel(key);
      const cal = getCalibration(key);
      const bb = bboxOf(key);
      return {
        calibrated: mpp != null,
        metersPerPixel: mpp || 0,
        metersPer100: cal?.raw?.metersPer100Units,
        method: cal?.method || "",
        guess: guessMetersPer100(bb.w, bb.h),
      };
    },
    onOpenViewer() { window.showScreen && window.showScreen("screen-viewer"); },
  });

  structUI.onPlanChange(() => structUI.refreshCalibration());
  structUI.onCalibrate((key, val) => {
    try {
      const cal = setByScale100(key, val);
      window.__PLAN_STORE?.isEnabled() && window.__PLAN_STORE.updateCal(key, cal.metersPerPixel).catch(() => {});
    } catch (e) { /* valor inválido */ }
    structUI.refreshCalibration();
  });

  structUI.onGenerateClick(() => {
    const key = structUI.planKey;
    if (!isCalibrated(key)) return;
    const p = structUI.readParams();
    params = clone(DEFAULT_PARAMS);
    params.peDireito_m = p.peDireito_m;
    params.pilar.espacamentoMax_m = p.pilarEspacamentoMax_m;
    params.alvenaria.presetPadrao = p.blockPreset;
    params.fundacao.modo = p.fundacaoModo;

    pendingPlanKey = key;
    qb5dActive = true;
    structUI.busy(true);
    window.showScreen && window.showScreen("screen-viewer");
    host.loadDemo(key); // dispara host.onPlanLoaded()
  });

  // Ponte para o editor de traçado: registra a nova planta no dropdown do
  // QB5D e já a seleciona (a calibração vem pronta do editor).
  window.__QB5D_selectPlan = (key) => {
    structUI.setPlans(Object.keys(planMeta));
    const sel = document.getElementById("qb5d-plan");
    if (sel && [...sel.options].some((o) => o.value === key)) sel.value = key;
    structUI.refreshCalibration();
  };

  // Card na home (reaproveita o antigo "Blockout Preciso")
  const card = document.getElementById("card-structure");
  if (card) {
    card.addEventListener("click", () => {
      window.showScreen && window.showScreen("screen-structure");
      structUI.setPlans(Object.keys(planMeta));
      structUI.refreshCalibration();
    });
  }

  host.onFrame = (now) => { if (qb5dActive) renderer.tick(now); };

  host.onPlanLoaded = (data, framing) => {
    if (!qb5dActive) { renderer.group.visible = false; restoreDashboard(); return; }
    const key = pendingPlanKey || host.currentPlanKey;
    const mpp = getMetersPerPixel(key);
    if (mpp == null) { qb5dActive = false; structUI.busy(false); return; }
    try {
      const topo = buildTopology(data);
      lastStructure = generateStructure(topo, params, mpp);
      const seq = buildSequence(lastStructure);
      lastQuant = buildQuantities(lastStructure, { ...DEFAULT_PRICES_BRL });

      const built = renderer.build(lastStructure, seq, {
        cx: framing.cx, cy: framing.cy, scale: framing.scale,
      });
      renderer.group.visible = true;
      hideDashboard();
      host.frameModel(built.framing.center, built.framing.radius);
      if (!Number.isFinite(host.camera.position.x)) {
        // fallback se o frame do dashboard entrou com aspect/tamanho inválido
        const c = built.framing.center, rad = built.framing.radius || 8;
        host.camera.position.set(c.x + rad * 0.9, c.y + rad, c.z + rad * 1.3);
        host.controls.target.copy(c);
        host.controls.update();
      }

      if (timeline) timeline.remove();
      timeline = mountTimeline({ renderer, sequence: seq, structure: lastStructure });
      // Abre já mostrando a ESTRUTURA PRÉ-CONCLUÍDA (concreto + alvenaria +
      // vãos + contrapiso colocados, antes do acabamento). A animação da
      // obra fica disponível no botão ▶ / "Do zero".
      renderer.pause();
      renderer.seek(seq.structuralCompleteMs);
      timeline.refresh();

      structUI.showResult(lastStructure, lastQuant);
      structUI.busy(false);
      const st = document.getElementById("status");
      if (st) st.textContent =
        `QB5D · ${lastStructure.summary.area_construida_m2} m² · fundação ${lastStructure.summary.fundacao_tipo} · ${lastStructure.summary.n_pilares} pilares`;
    } catch (e) {
      console.error("QB5D falhou:", e);
      qb5dActive = false;
      structUI.busy(false);
      renderer.group.visible = false;
      restoreDashboard();
      const st = document.getElementById("status");
      if (st) st.textContent = "QB5D não pôde gerar: " + e.message;
    }
  };

  function hideDashboard() {
    if (host.floor) host.floor.visible = false;
    for (const c of host.planGroup.children) c.visible = false; // inclui a planta 2D
    const vp = document.querySelector("#screen-viewer .viewer-panel");
    if (vp) vp.style.display = "none";
  }
  function restoreDashboard() {
    if (host.floor) host.floor.visible = true;
    for (const c of host.planGroup.children) c.visible = true;
    const vp = document.querySelector("#screen-viewer .viewer-panel");
    if (vp) vp.style.display = "";
    renderer.restoreScene();
  }

  // Sair do viewer (back p/ home/lib) encerra o "takeover" do QB5D.
  document.querySelectorAll("[data-back-to]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.backTo !== "screen-viewer") {
        qb5dActive = false;
        renderer.pause();
        renderer.group.visible = false;
        restoreDashboard();
        if (timeline) { timeline.remove(); timeline = null; }
      }
    });
  });

  window.__QB5D = {
    renderer,
    get structure() { return lastStructure; },
    get quant() { return lastQuant; },
    get timeline() { return timeline; },
  };
});
