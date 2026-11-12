/**
 * GEF/PRUMO v25 — configuração sectorial da loja (tipo de negócio): categorias, unidades, atributos e nomes dos 3 locais de stock.
 * Fonte: RPC fn_store_sector_config. Se a migração v25 ainda não existir ou falhar, devolve os valores de FERRAGENS (comportamento antigo).
 */
import { db } from './database.js';

const DEF_LOC = { LOJA: 'Loja (Balcão)', ARMAZEM: 'Armazém Central', PATIO: 'Pátio de Agregados' };
const DEF_UNITS = [['saco', 'Saco'], ['kg', 'Quilograma (kg)'], ['un', 'Unidade (un)'], ['barra', 'Barra'], ['m', 'Metro Linear (m)'], ['m2', 'Metro Quadrado (m²)'], ['m3', 'Metro Cúbico (m³)'], ['lata', 'Lata'], ['rolo', 'Rolo']];
const DEF_CATS = ['Cimento & Argamassa', 'Aço & Ferro', 'Tubagens & Hidráulica', 'Material Elétrico', 'Tintas & Impermeabilizantes', 'Ferramentas', 'Agregados & Areia'];

let cfg = null, key = '', inflight = null;

export async function loadSectorConfig(force = false) {
  const storeId = db.getCurrentStoreId?.() || '';
  if (!force && cfg && key === storeId) return cfg;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try { cfg = await db.getStoreSectorConfig(storeId); key = storeId; }
    catch (e) { cfg = null; key = storeId; }
    inflight = null; return cfg;
  })();
  return inflight;
}
export function resetSectorConfig() { cfg = null; key = ''; inflight = null; }
export const sectorConfig = () => cfg;
export const businessTypeId = () => cfg?.business_type || 'FERRAGENS';
export const businessTypeName = () => cfg?.business_type_name || 'Ferragens';
export const sectorFlags = () => cfg?.flags || {};

/** Nome de um local (LOJA | ARMAZEM | PATIO) no sector da loja. */
export function locationLabel(code) {
  const l = (cfg?.locations || []).find((x) => x.code === code);
  return l?.label || DEF_LOC[code] || code;
}
/** Locais activos, por ordem, para listas e selects. */
export function locations() {
  const arr = (cfg?.locations || []);
  const out = ['LOJA', 'ARMAZEM', 'PATIO'].map((c) => { const l = arr.find((x) => x.code === c); return { id: c, label: l?.label || DEF_LOC[c], enabled: l ? l.enabled !== false : true }; });
  return out.filter((x) => x.enabled);
}
/** Unidades: do sector/loja + a unidade já usada pelo produto (para nunca a perder ao editar). */
export function unitOptions(current) {
  const list = (cfg?.units || []).filter((u) => u.active !== false).map((u) => [u.code, u.name]);
  const base = list.length ? list : DEF_UNITS;
  const out = [...base];
  if (current && !out.some(([c]) => c === current)) out.push([current, current]);
  return out;
}
/** Categorias da loja (nomes) = predefinidas do sector + as já usadas em produtos. */
export function categoryNames(extra = []) {
  const fromCfg = (cfg?.categories || []).filter((c) => c.active !== false).map((c) => c.name);
  return [...new Set([...(fromCfg.length ? fromCfg : DEF_CATS), ...extra.filter(Boolean)])];
}
export function subcategoriesOf(category) {
  const c = (cfg?.categories || []).find((x) => x.name === category);
  return c ? (c.subs || []) : [];
}
export const attributeDefs = () => (cfg?.attributes || []).filter((a) => a.active !== false);

/** Campo HTML de um atributo (formulário de produto). */
export function attributeFieldHtml(a, value, esc) {
  const id = `inp-attr-${a.key}`, v = value ?? '';
  const lab = `${esc(a.label)}${a.required ? ' *' : ''}`;
  const style = 'width: 100%;';
  let input;
  if (a.type === 'select') input = `<select id="${id}" data-attr="${esc(a.key)}" style="${style}"><option value="">—</option>${(a.options || []).map((o) => `<option value="${esc(o)}" ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (a.type === 'boolean') input = `<label style="display:flex;gap:6px;align-items:center;font-size:12px;"><input type="checkbox" id="${id}" data-attr="${esc(a.key)}" ${v === true || v === 'true' ? 'checked' : ''}> Sim</label>`;
  else input = `<input type="${a.type === 'number' ? 'number' : a.type === 'date' ? 'date' : 'text'}" ${a.type === 'number' ? 'step="any"' : ''} id="${id}" data-attr="${esc(a.key)}" value="${esc(v)}" style="${style}">`;
  return `<div><label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">${lab}</label>${input}</div>`;
}
/** Lê os atributos do formulário. Devolve { values, missing[] } (obrigatórios em falta). */
export function readAttributes(root) {
  const values = {}, missing = [];
  attributeDefs().forEach((a) => {
    const el = root.querySelector(`[data-attr="${a.key}"]`); if (!el) return;
    let v = a.type === 'boolean' ? (el.checked ? true : '') : String(el.value || '').trim();
    if (a.type === 'number' && v !== '') v = Number(v);
    if (v === '' || v === null || Number.isNaN(v)) { if (a.required) missing.push(a.label); return; }
    values[a.key] = v;
  });
  return { values, missing };
}

/** <option> agrupadas (Comércio / Armazéns) dos tipos de negócio, para os formulários de cadastro. */
export function businessTypeOptionsHtml(types, selected, esc) {
  const g = (k) => (types || []).filter((t) => t.kind === k).map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  return `<option value="">— Seleccione o tipo de negócio —</option><optgroup label="Comércio">${g('COMERCIO')}</optgroup><optgroup label="Armazéns">${g('ARMAZEM')}</optgroup>`;
}
