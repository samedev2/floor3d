// =====================================================================
// QB5D — calibration.js
// As plantas do CubiCasa5K não têm escala métrica embutida: as coordenadas
// dos polígonos estão em PIXELS do desenho. Toda a estruturação realista
// (seções em cm, vãos em m, quantitativo) depende de saber quantos metros
// vale um pixel. Este módulo guarda essa relação por planta.
//
// Duas formas de calibrar:
//   1. "metros por 100 unidades de desenho"  -> metersPerPixel = m / 100
//   2. traçar uma cota conhecida (2 pontos + comprimento real)
//      -> metersPerPixel = comprimentoReal_m / distanciaPixels
// =====================================================================

const LS_KEY = "qb5d.calibration.v1";

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* modo privado / storage cheio — segue sem persistir */
  }
}

/** @returns {number|null} metros por pixel para a planta, ou null se não calibrada. */
export function getMetersPerPixel(planKey) {
  const c = loadStore()[planKey];
  return c && Number.isFinite(c.metersPerPixel) && c.metersPerPixel > 0
    ? c.metersPerPixel
    : null;
}

/** @returns {object|null} registro completo { metersPerPixel, method, raw, at }. */
export function getCalibration(planKey) {
  return loadStore()[planKey] || null;
}

export function isCalibrated(planKey) {
  return getMetersPerPixel(planKey) != null;
}

/** Calibração por "m por 100 unidades". */
export function setByScale100(planKey, metersPer100Units) {
  const v = Number(metersPer100Units);
  if (!Number.isFinite(v) || v <= 0) throw new Error("escala inválida");
  const store = loadStore();
  store[planKey] = {
    metersPerPixel: v / 100,
    method: "scale100",
    raw: { metersPer100Units: v },
    at: Date.now(),
  };
  saveStore(store);
  return store[planKey];
}

/** Calibração traçando uma cota: distância em pixels + comprimento real (m). */
export function setByKnownLength(planKey, pixelDistance, realMeters) {
  const d = Number(pixelDistance);
  const m = Number(realMeters);
  if (!Number.isFinite(d) || d <= 0) throw new Error("distância em pixels inválida");
  if (!Number.isFinite(m) || m <= 0) throw new Error("comprimento real inválido");
  const store = loadStore();
  store[planKey] = {
    metersPerPixel: m / d,
    method: "knownLength",
    raw: { pixelDistance: d, realMeters: m },
    at: Date.now(),
  };
  saveStore(store);
  return store[planKey];
}

export function clearCalibration(planKey) {
  const store = loadStore();
  delete store[planKey];
  saveStore(store);
}

/** Chute de escala a partir da área do bbox e um pé-direito plausível — só
 *  para pré-preencher o campo, NUNCA para gerar sem o usuário confirmar. */
export function guessMetersPer100(bboxWidthPx, bboxHeightPx) {
  // assume que a maior dimensão de uma casa desenhada ~ 12 m
  const maxPx = Math.max(bboxWidthPx || 0, bboxHeightPx || 0);
  if (maxPx <= 0) return 4.5;
  const mPerPx = 12 / maxPx;
  return +(mPerPx * 100).toFixed(1);
}
