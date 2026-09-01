// =====================================================================
// QB5D — ui.js
// DOM da tela de Estruturação, da timeline 4D no viewer e do quantitativo.
// Cria os elementos dinamicamente reaproveitando as classes de estilo já
// definidas no dashboard (.screen/.topbar/.scroll-area/.mat-field/...).
// =====================================================================

import { BLOCK_PRESETS } from "./params.js";

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};

function injectStyle() {
  if (document.getElementById("qb5d-style")) return;
  document.head.append(el("style", { id: "qb5d-style", html: `
    #screen-structure .qb5d-note{font-size:12px;line-height:1.5;color:var(--text-muted);
      padding:12px 14px;border-radius:12px;border:1px solid var(--panel-border);
      background:rgba(251,191,36,.06);margin-bottom:16px}
    .qb5d-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin:14px 0;
      padding:14px;border-radius:12px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25)}
    .qb5d-summary div{font-size:12px;color:var(--text-muted)}
    .qb5d-summary b{display:block;font-size:15px;color:var(--text);font-weight:700}
    .qb5d-grp{margin-top:14px;border:1px solid var(--panel-border);border-radius:12px;overflow:hidden}
    .qb5d-grp h4{margin:0;padding:10px 13px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;
      color:var(--text-faint);background:rgba(255,255,255,.03)}
    .qb5d-grp .row{display:flex;justify-content:space-between;gap:12px;padding:8px 13px;
      font-size:12.5px;border-top:1px solid var(--panel-border)}
    .qb5d-grp .row .l{color:var(--text-muted)} .qb5d-grp .row .v{text-align:right;font-weight:600}
    .qb5d-grp .row.strong .v,.qb5d-grp .row.strong .l{color:var(--text);font-weight:700}
    .qb5d-btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:600;
      padding:10px 16px;border-radius:9px;border:none;cursor:pointer;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
    .qb5d-btn.ghost{background:rgba(255,255,255,.06);border:1px solid var(--panel-border)}
    .qb5d-btn:disabled{opacity:.5;cursor:default}
    /* timeline */
    #qb5d-timeline{position:fixed;left:16px;right:16px;bottom:16px;z-index:16;
      background:rgba(15,21,38,.9);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1);
      border-radius:14px;padding:10px 12px;color:#fff}
    #qb5d-timeline .tl-top{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap}
    #qb5d-timeline .tl-stage{font-size:12px;font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #qb5d-timeline button{font:inherit;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,.16);
      background:rgba(255,255,255,.06);color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer}
    #qb5d-timeline button:hover{background:rgba(255,255,255,.14)}
    #qb5d-timeline .tl-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;cursor:pointer}
    #qb5d-timeline .tl-fill{height:100%;background:#3b82f6;width:0%}
    #qb5d-timeline .tl-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
    #qb5d-timeline .chip{font-size:10.5px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
      background:rgba(255,255,255,.05);cursor:pointer;white-space:nowrap}
    #qb5d-timeline .chip.done{background:rgba(52,211,153,.18);border-color:rgba(52,211,153,.4)}
    #qb5d-timeline .chip.active{background:#3b82f6;border-color:#3b82f6}
    /* HUD estilo maquete/BIM */
    #qb5d-hud{position:fixed;left:16px;top:64px;z-index:16;display:flex;flex-direction:column;gap:10px;max-width:min(320px,62vw)}
    #qb5d-hud .card{background:rgba(10,14,26,.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px 14px;color:#fff}
    #qb5d-hud .hdr{display:flex;align-items:center;gap:10px}
    #qb5d-hud .hdr .ico{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;
      background:rgba(251,191,36,.16);font-size:15px;flex:none}
    #qb5d-hud .hdr .t1{font-size:13px;font-weight:700}
    #qb5d-hud .hdr .t2{font-size:11px;color:rgba(255,255,255,.62)}
    #qb5d-hud .stage .srow{display:flex;align-items:center;gap:8px}
    #qb5d-hud .stage .dot{width:11px;height:11px;border-radius:50%;flex:none;background:#888}
    #qb5d-hud .stage .sname{font-size:13.5px;font-weight:700}
    #qb5d-hud .stage .sinfo{font-size:11px;color:rgba(255,255,255,.65);margin-top:3px}
    #qb5d-hud .stage .sbar{height:4px;border-radius:2px;background:rgba(255,255,255,.14);margin-top:8px;overflow:hidden}
    #qb5d-hud .stage .sfill{height:100%;width:0%;background:#3b82f6;transition:width .12s linear}
    #qb5d-legend{position:fixed;right:16px;top:64px;z-index:16;background:rgba(10,14,26,.82);backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:8px 10px;color:#fff;
      max-height:calc(100% - 210px);overflow:auto}
    #qb5d-legend .lg{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:8px;font-size:11.5px;
      cursor:pointer;white-space:nowrap;opacity:.42}
    #qb5d-legend .lg .d{width:9px;height:9px;border-radius:50%;flex:none}
    #qb5d-legend .lg.done{opacity:.82}
    #qb5d-legend .lg.active{opacity:1;background:rgba(255,255,255,.12);font-weight:700}
    #qb5d-legend .lg.hidden-layer{text-decoration:line-through;opacity:.28}
    #qb5d-warn{position:fixed;left:16px;bottom:92px;z-index:16;max-width:min(340px,72vw);
      background:rgba(110,72,10,.92);border:1px solid rgba(251,191,36,.42);border-radius:12px;
      padding:10px 13px;color:#fde9c8;font-size:11.5px;line-height:1.45}
    @media(max-width:560px){#qb5d-legend{display:none}#qb5d-hud{max-width:52vw}}
  ` }));
}

// ---------------------------------------------------------------------
// Tela de Estruturação
// ---------------------------------------------------------------------
let STRUCT_UI_SINGLETON = null;

export function mountStructureScreen({ planMeta, getCalibrationInfo, onGenerate, onOpenViewer }) {
  injectStyle();
  if (STRUCT_UI_SINGLETON) return STRUCT_UI_SINGLETON;

  const planSel = el("select", { id: "qb5d-plan", class: "" });
  const calInput = el("input", { type: "number", id: "qb5d-cal", min: "0", step: "any", placeholder: "ex: 450" });
  const calStatus = el("div", { class: "mat-hint", id: "qb5d-cal-status" }, "Não calibrada.");
  const pdInput = el("input", { type: "number", id: "qb5d-pd", value: "2.8", min: "2", step: "0.05" });
  const spanInput = el("input", { type: "number", id: "qb5d-span", value: "4.5", min: "2", step: "0.1" });
  const blockSel = el("select", { id: "qb5d-block" });
  for (const [k, p] of Object.entries(BLOCK_PRESETS))
    blockSel.append(el("option", { value: k }, p.label));
  blockSel.value = "ceramico9";
  const fundSel = el("select", { id: "qb5d-fund" });
  for (const [v, t] of [
    ["auto", "Automática (pelo porte)"], ["radier", "Radier"], ["sapata_corrida", "Sapata corrida"],
    ["sapata_isolada", "Sapata isolada"], ["estaca", "Estaca + bloco"],
  ]) fundSel.append(el("option", { value: v }, t));

  const genBtn = el("button", { class: "qb5d-btn", disabled: "" }, "Gerar estrutura QB5D");
  const out = el("div", { id: "qb5d-out" });

  const field = (labelText, control, hint) =>
    el("div", { class: "mat-field" },
      el("label", {}, labelText), control,
      hint ? el("div", { class: "mat-hint" }, hint) : null);

  const screen = el("div", { class: "screen", id: "screen-structure" },
    el("div", { class: "topbar" },
      el("button", { class: "back-btn", "data-back-to": "screen-home" },
        (() => { const s = document.createElement("span"); s.innerHTML = "&#8592;"; return s; })()),
      el("div", { class: "topbar-titles" },
        el("div", { class: "t1" }, "Estruturação QB5D"),
        el("div", { class: "t2" }, "Concreto armado + alvenaria de vedação · ABNT/NBR"))),
    el("div", { class: "scroll-area" },
      el("div", { class: "qb5d-note", html:
        "Gera um <b>anteprojeto / pré-dimensionamento</b> por regras NBR (tabelas editáveis) " +
        "para coordenar geometria, sequência construtiva e quantitativo. <b>Não substitui o " +
        "cálculo estrutural</b> de um engenheiro. Depende da escala informada abaixo estar correta." }),
      field("Planta", planSel),
      field("Escala — metros reais por 100 unidades do desenho", calInput,
        "Sem escala métrica embutida na planta. Informe uma cota conhecida convertida para “m por 100 unidades”."),
      calStatus,
      field("Pé-direito (m)", pdInput),
      field("Espaçamento máx. entre pilares (m)", spanInput, "NBR 6118 — vão econômico p/ laje maciça ~4–5 m."),
      field("Bloco de vedação", blockSel),
      field("Fundação", fundSel, "Automática escolhe radier / sapata / estaca pela área construída e maior vão."),
      genBtn,
      out));
  document.body.append(screen);

  // back button precisa do handler do dashboard — replica aqui
  screen.querySelector(".back-btn").addEventListener("click", () => {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-home"));
  });

  const api = {
    setPlans(keys) {
      planSel.innerHTML = "";
      for (const k of keys) planSel.append(el("option", { value: k }, planMeta[k]?.name || k));
    },
    get planKey() { return planSel.value; },
    refreshCalibration() {
      const info = getCalibrationInfo(planSel.value);
      if (info.calibrated) {
        calInput.value = info.metersPer100 ?? "";
        calStatus.textContent = `Calibrada: 1 px ≈ ${info.metersPerPixel.toFixed(4)} m (${info.method}).`;
        calStatus.style.color = "var(--green)";
        genBtn.disabled = false;
      } else {
        if (info.guess) calInput.placeholder = `sugestão: ${info.guess}`;
        calStatus.textContent = "Não calibrada — informe a escala para liberar a geração.";
        calStatus.style.color = "";
        genBtn.disabled = true;
      }
    },
    showResult(structure, quantities) {
      const s = structure.summary;
      out.innerHTML = "";
      out.append(el("div", { class: "qb5d-summary" },
        el("div", { html: `<b>${s.area_construida_m2} m²</b>área construída` }),
        el("div", { html: `<b>${s.perimetro_m} m</b>perímetro` }),
        el("div", { html: `<b>${s.max_vao_m} m</b>maior vão` }),
        el("div", { html: `<b>${fundLabel(s.fundacao_tipo)}</b>fundação (auto)` }),
        el("div", { html: `<b>${s.n_pilares}</b>pilares` }),
        el("div", { html: `<b>${s.n_comodos}</b>cômodos · ${s.n_vigas} panos` })));

      for (const g of quantities.groups) {
        const box = el("div", { class: "qb5d-grp" }, el("h4", {}, g.label));
        for (const row of g.rows)
          box.append(el("div", { class: "row" + (row.strong ? " strong" : "") },
            el("span", { class: "l" }, row.label), el("span", { class: "v" }, row.value)));
        out.append(box);
      }
      if (quantities.cost) {
        const box = el("div", { class: "qb5d-grp" }, el("h4", {}, "Custo estimado (5D)"));
        for (const l of quantities.cost.lines)
          box.append(el("div", { class: "row" },
            el("span", { class: "l" }, `${l.label} · ${l.qty} ${l.unit} × ${quantities.cost.brl(l.unitPrice)}`),
            el("span", { class: "v" }, quantities.cost.brl(l.subtotal))));
        box.append(el("div", { class: "row strong" },
          el("span", { class: "l" }, "TOTAL"), el("span", { class: "v" }, quantities.cost.brl(quantities.cost.total))));
        out.append(box);
      }

      const dl = (name, text, mime) => () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: mime }));
        a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      out.append(el("div", { style: "display:flex;gap:8px;margin-top:16px;flex-wrap:wrap" },
        el("button", { class: "qb5d-btn", onclick: () => onOpenViewer() }, "▶ Ver animação da construção"),
        el("button", { class: "qb5d-btn ghost", onclick: dl(`qb5d-${planSel.value}.json`, quantities.json(), "application/json") }, "Exportar JSON"),
        el("button", { class: "qb5d-btn ghost", onclick: dl(`qb5d-${planSel.value}.csv`, quantities.csv(), "text/csv") }, "Exportar CSV")));
    },
    readParams() {
      return {
        peDireito_m: +pdInput.value || 2.8,
        pilarEspacamentoMax_m: +spanInput.value || 4.5,
        blockPreset: blockSel.value,
        fundacaoModo: fundSel.value,
      };
    },
    onGenerateClick(fn) { genBtn.addEventListener("click", fn); },
    onPlanChange(fn) { planSel.addEventListener("change", fn); },
    onCalibrate(fn) {
      calInput.addEventListener("change", () => fn(planSel.value, calInput.value));
    },
    busy(on) { genBtn.disabled = on; genBtn.textContent = on ? "Gerando…" : "Gerar estrutura QB5D"; },
  };
  api.setPlans(Object.keys(planMeta));
  api.refreshCalibration();
  STRUCT_UI_SINGLETON = api;
  return api;
}

function fundLabel(t) {
  return ({
    radier: "Radier", sapata_corrida: "Sapata corrida", sapata_isolada: "Sapata isolada",
    estaca: "Estaca + bloco", auto: "—",
  })[t] || t;
}

// ---------------------------------------------------------------------
// HUD 4D dentro do #screen-viewer:
//   - barra inferior slim (play / restart / velocidade / scrub)
//   - cartão superior-esquerdo (obra + estágio atual + fiada)
//   - legenda lateral direita (estágios, com dot colorido)
//   - aviso de consumo de concreto
// ---------------------------------------------------------------------
const hex6 = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

const STAGE_LAYER = {
  locacao: "lastro", fundacao: "fundacao", pilar: "pilar", viga: "viga",
  laje_cob: "laje_cob", alvenaria: "alvenaria", verga: "verga",
  contrapiso: "laje_piso", reboco: "alvenaria", esquadria: "esquadria",
  instalacoes: "instalacoes",
};

export function mountTimeline({ renderer, sequence, structure }) {
  injectStyle();
  for (const id of ["qb5d-timeline", "qb5d-hud", "qb5d-legend", "qb5d-warn"])
    document.getElementById(id)?.remove();
  const viewer = document.getElementById("screen-viewer");
  if (!viewer) return null;

  // ---- barra inferior ----
  const stageName = el("div", { class: "tl-stage" }, "—");
  const playBtn = el("button", { title: "tocar / pausar a obra" }, "▶");
  const restartBtn = el("button", { title: "animar a obra do zero" }, "⏮ Do zero");
  const brutaBtn = el("button", { title: "pular para a estrutura pré-concluída" }, "Estrutura");
  const acabBtn = el("button", { title: "pular para a obra acabada (com reboco)" }, "Acabada");
  const speedBtn = el("button", { title: "velocidade" }, "1×");
  const fill = el("div", { class: "tl-fill" });
  const bar = el("div", { class: "tl-bar" }, fill);
  const bardom = el("div", { id: "qb5d-timeline" },
    el("div", { class: "tl-top" }, playBtn, restartBtn, brutaBtn, acabBtn, stageName, speedBtn), bar);
  viewer.append(bardom);

  // ---- cartão superior-esquerdo ----
  const s = structure.summary;
  const dot = el("div", { class: "dot" });
  const sname = el("div", { class: "sname" }, "—");
  const sinfo = el("div", { class: "sinfo" }, "");
  const sfill = el("div", { class: "sfill" });
  const hud = el("div", { id: "qb5d-hud" },
    el("div", { class: "card" },
      el("div", { class: "hdr" },
        el("div", { class: "ico" }, "👷"),
        el("div", {},
          el("div", { class: "t1" }, "Estrutura Real · QB5D"),
          el("div", { class: "t2" },
            `${structure.elements.length} elementos · ${fundLabel(s.fundacao_tipo)} · ${s.area_construida_m2} m²`)))),
    el("div", { class: "card stage" },
      el("div", { class: "srow" }, dot, sname), sinfo,
      el("div", { class: "sbar" }, sfill)));
  viewer.append(hud);

  // ---- legenda lateral (estágios) ----
  const legendDom = el("div", { id: "qb5d-legend" });
  const legendRows = new Map();
  const layerHidden = {};
  for (const st of sequence.stages) {
    const d = el("div", { class: "d" });
    d.style.background = hex6(st.color);
    const row = el("div", { class: "lg", title: "clique: ir ao estágio · botão direito: ocultar camada" },
      d, el("span", {}, st.label));
    row.addEventListener("click", () => { renderer.goToStage(st.id); refresh(); });
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const lid = STAGE_LAYER[st.id];
      if (!lid) return;
      layerHidden[lid] = !layerHidden[lid];
      renderer.setLayerVisible(lid, !layerHidden[lid]);
      row.classList.toggle("hidden-layer", layerHidden[lid]);
    });
    legendRows.set(st.id, row);
    legendDom.append(row);
  }
  viewer.append(legendDom);

  // ---- aviso de consumo de concreto ----
  const ratio = s.area_construida_m2 > 0
    ? structure.totals.concreto_m3 / s.area_construida_m2 : 0;
  if (ratio > 0.20) {
    viewer.append(el("div", { id: "qb5d-warn" },
      `⚠ Consumo de concreto ${ratio.toFixed(2)} m³/m² parece alto — revisar seções.`));
  }

  // ---- controles ----
  const speeds = [1, 2, 4, 0.5];
  let si = 0;
  speedBtn.addEventListener("click", () => {
    si = (si + 1) % speeds.length;
    renderer.setSpeed(speeds[si]);
    speedBtn.textContent = speeds[si] + "×";
  });
  playBtn.addEventListener("click", () => {
    renderer.isPlaying() ? renderer.pause() : renderer.play();
    refresh();
  });
  restartBtn.addEventListener("click", () => { renderer.seek(0); renderer.play(); refresh(); });
  brutaBtn.addEventListener("click", () => {
    renderer.pause();
    renderer.seek(sequence.structuralCompleteMs ?? renderer.duration);
    refresh();
  });
  acabBtn.addEventListener("click", () => {
    renderer.pause();
    renderer.seek(renderer.duration);
    refresh();
  });
  bar.addEventListener("click", (e) => {
    const r = bar.getBoundingClientRect();
    renderer.pause();
    renderer.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * renderer.duration);
    refresh();
  });

  const totalFiadas = (structure.elements.find((x) => x.type === "alvenaria" && x.courses) || {}).courses || 14;

  function refresh() {
    const t = renderer.time, dur = renderer.duration || 1;
    const pctObra = Math.round(100 * t / dur);
    fill.style.width = (100 * t / dur).toFixed(1) + "%";
    playBtn.textContent = renderer.isPlaying() ? "⏸" : "▶";

    const active = sequence.stageAt(t);
    const sp = sequence.stageProgress(t);
    const scMs = sequence.structuralCompleteMs ?? dur;
    const paused = !renderer.isPlaying();

    // rótulos de "marco" quando parado num ponto-chave
    let label, col, info;
    if (paused && t >= dur - 1) {
      label = "Obra acabada"; col = "#e5e7eb"; info = "100% · com reboco e esquadrias";
    } else if (paused && t >= scMs && t < (sequence.rebocoStartMs ?? Infinity)) {
      label = "Estrutura pré-concluída"; col = "#f97316";
      info = `${pctObra}% · concreto + alvenaria + vãos colocados`;
    } else {
      label = active ? active.label : "—";
      col = active ? hex6(active.color) : "#888";
      info = `${pctObra}% da obra`;
      if (active && active.id === "alvenaria") {
        const fi = Math.max(1, Math.min(totalFiadas, Math.ceil(sp * totalFiadas)));
        info += ` · fiada ${fi}/${totalFiadas}`;
      }
    }
    stageName.textContent = label;
    sname.textContent = label;
    dot.style.background = col;
    sfill.style.background = col;
    sfill.style.width = (sp * 100).toFixed(0) + "%";
    sinfo.textContent = info;

    for (const st of sequence.stages) {
      const row = legendRows.get(st.id);
      row.classList.toggle("active", active && st.id === active.id);
      row.classList.toggle("done", t >= st.startMs + st.durationMs);
    }
  }
  renderer.onProgress(refresh);
  renderer.onEnd(refresh);
  refresh();

  return {
    refresh,
    remove() {
      for (const n of [bardom, hud, legendDom]) n.remove();
      document.getElementById("qb5d-warn")?.remove();
    },
  };
}
