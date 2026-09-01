// =====================================================================
// QB5D — store.js
// Persistência das plantas no Supabase (PostgREST + REST puro, sem SDK).
// - salva planta traçada / SVG detectado
// - recarrega as plantas salvas no boot -> entram em __DEMOS__ e aparecem
//   na Biblioteca, no Visualizador 360 e no QB5D
// - atualiza a calibração métrica quando o usuário calibra no QB5D
//
// Tudo é "best effort": se o Supabase estiver fora do ar ou a tabela não
// existir ainda, o app segue normal só com as 3 plantas de exemplo.
// Expõe window.__PLAN_STORE.
// =====================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, PLANS_TABLE } from "./supabase-config.js";
import { setByScale100, getMetersPerPixel } from "./calibration.js";

const REST = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/${PLANS_TABLE}` : null;
const headers = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
});

export function isEnabled() {
  return !!REST && !!SUPABASE_ANON_KEY;
}

let _reach = null;
async function reachable() {
  if (!isEnabled()) return false;
  if (_reach !== null) return _reach;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SUPABASE_ANON_KEY } });
    _reach = r.ok;
  } catch { _reach = false; }
  return _reach;
}

export async function listPlans() {
  if (!isEnabled()) return [];
  const r = await fetch(`${REST}?select=*&order=created_at.asc`, { headers: headers() });
  if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return r.json();
}

let _tableMissing = false;

export async function savePlan({ id, name, source, meters_per_pixel, data }) {
  if (!isEnabled() || _tableMissing) return false;
  let r;
  try {
    r = await fetch(REST, {
      method: "POST",
      headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id, name: name || id, source: source || "trace",
        meters_per_pixel: meters_per_pixel ?? null, data,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("[QB5D store] save (rede):", e.message);
    return false;
  }
  if (r.ok) return true;
  const body = (await r.text().catch(() => "")).slice(0, 200);
  if (r.status === 404 || body.includes("PGRST205")) {
    _tableMissing = true;                     // avisa 1x, depois só console
    console.warn("[QB5D store] tabela qb5d_plans ausente — plantas não serão salvas");
    return false;
  }
  console.warn(`[QB5D store] save ${r.status}: ${body}`);
  return false;
}

export async function updateCal(id, mpp) {
  if (!isEnabled() || !mpp) return false;
  const r = await fetch(`${REST}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify({ meters_per_pixel: mpp, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

export async function deletePlan(id) {
  if (!isEnabled()) return false;
  const r = await fetch(`${REST}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE", headers: headers(),
  });
  return r.ok;
}

/** Preenche demos/meta/order com o que está salvo no Supabase. */
export async function hydrateInto({ demos, meta, order }) {
  if (!isEnabled() || !(await reachable())) return { count: 0, offline: true };
  let rows;
  try { rows = await listPlans(); }
  catch (e) { console.warn("[QB5D store] hydrate falhou:", e.message); return { count: 0, error: e.message }; }
  let n = 0;
  for (const row of rows) {
    if (!row || !row.id || !row.data || demos[row.id]) continue;
    demos[row.id] = row.data;
    meta[row.id] = { name: row.name || row.id, tag: row.source === "svg" ? "Salva" : "Traçada" };
    order.push(row.id);
    if (row.meters_per_pixel && getMetersPerPixel(row.id) == null) {
      try { setByScale100(row.id, row.meters_per_pixel * 100); } catch { /* storage off */ }
    }
    n++;
  }
  return { count: n };
}

window.__PLAN_STORE = { isEnabled, listPlans, savePlan, updateCal, deletePlan, hydrateInto };

// Auto-hidratação no boot: espera o host do dashboard e recarrega as plantas.
(async () => {
  if (!isEnabled()) return;
  for (let i = 0; i < 240 && !window.__QB5D_HOST; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const host = window.__QB5D_HOST;
  if (!host || !host.demos) return;
  const res = await hydrateInto({ demos: host.demos, meta: host.planMeta, order: host.planOrder });
  if (res.count) {
    try { window.renderLibrary && window.renderLibrary(); } catch {}
    try { window.updateHomeBanner && window.updateHomeBanner(); } catch {}
    console.info(`[QB5D store] ${res.count} planta(s) recarregada(s) do Supabase`);
  } else if (res.error) {
    try {
      window.showToast && window.showToast(
        "Supabase: não consegui ler as plantas salvas (a tabela qb5d_plans existe?).", 5000);
    } catch {}
  }
})();
