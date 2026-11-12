/**
 * GEF | PROMOÇÕES PROGRAMADAS (separador do módulo Loja virtual). Toda a validação e o cálculo de preços
 * ficam no Supabase (migracao_promocoes_v16.sql); aqui só há formulário e listagem.
 */
import { showToast } from '../../js/components/toast.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';

const STATE = { AGENDADA: ['badge-blue', 'Agendada'], ATIVA: ['badge-emerald', 'Ativa'], EXPIRADA: ['badge-amber', 'Expirada'], CANCELADA: ['badge-red', 'Cancelada'] };
const fmt = (d) => new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
const toLocalInput = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
/** Regra da BD (promotions_name_check): 2 a 80 caracteres após aparar. Contamos pontos de código (como o Postgres), não unidades UTF-16. */
export function normalizePromoName(raw) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const len = Array.from(value).length;
  if (len < 2) return { ok: false, value, error: 'O nome da promoção deve ter pelo menos 2 caracteres.' };
  if (len > 80) return { ok: false, value, error: `O nome da promoção pode ter no máximo 80 caracteres (tem ${len}).` };
  return { ok: true, value, error: '' };
}
const UNIT_MS = { m: 60000, h: 3600000, d: 86400000 };

export async function drawPromocoes(body, { rpc, friendly, canEdit }) {
  let list = [];
  const money = (n) => Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function load() {
    try { list = await rpc('fn_promo_list'); } catch (e) { body.innerHTML = `<div class="card" style="padding:16px;color:#fde68a;">${esc(/could not find the function|schema cache/i.test(e.message) ? 'Falta executar migracao_promocoes_v16.sql no Supabase.' : friendly(e))}</div>`; return; }
    draw();
  }

  function draw() {
    const rows = list.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="mono">${p.discount_type === 'PERCENT' ? esc(p.discount_value) + ' %' : '− ' + money(p.discount_value)}</td>
      <td>${esc(fmt(p.starts_at))}<br>${esc(fmt(p.ends_at))}</td><td class="mono">${esc(p.products)}</td><td class="mono">${esc(p.orders)}</td>
      <td><span class="badge ${STATE[p.state][0]}">${STATE[p.state][1]}</span></td>
      <td>${canEdit && (p.state === 'ATIVA' || p.state === 'AGENDADA') ? `<button class="btn btn-secondary" data-cancel="${esc(p.id)}" style="padding:2px 8px;font-size:11px;">Cancelar</button>` : ''}
          ${canEdit && p.state === 'AGENDADA' ? `<button class="btn btn-secondary" data-edit="${esc(p.id)}" style="padding:2px 8px;font-size:11px;">Editar</button>` : ''}</td></tr>`).join('');
    body.innerHTML = `<div class="card" style="padding:16px;"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
      <h3 style="margin:0;font-size:15px;color:#f8fafc;">Promoções programadas</h3>${canEdit ? '<button class="btn btn-primary" id="pr-new">+ Nova promoção</button>' : ''}</div>
      <div style="font-size:10px;color:#94a3b8;margin:6px 0 10px;">Terminam sozinhas à hora exacta (calculado no servidor). Vários descontos no mesmo produto não se somam: aplica-se o menor preço final. Compras já feitas nunca mudam.</div>
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Nome</th><th>Desconto</th><th>Início / Fim</th><th>Produtos</th><th>Encomendas</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="padding:16px;color:#94a3b8;">Sem promoções.</td></tr>'}</tbody></table></div></div>`;
    const nb = body.querySelector('#pr-new'); if (nb) nb.onclick = () => openForm(null);
    body.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openForm(list.find((x) => x.id === b.dataset.edit)); });
    body.querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Cancelar esta promoção? O preço normal volta de imediato. Compras já feitas não mudam.')) return;
        try { await rpc('fn_promo_cancel', { p_id: b.dataset.cancel }); showToast('Promoção cancelada.', 'success'); load(); } catch (e) { showToast(friendly(e), 'error'); }
      };
    });
  }

  async function openForm(edit) {
    let products; try { products = await rpc('fn_promo_products', { p_q: null, p_category: null }); } catch (e) { return showToast(friendly(e), 'error'); }
    const sel = new Set(edit ? edit.product_ids : []);
    const now = new Date(); const start0 = edit ? new Date(edit.starts_at) : new Date(now.getTime() + 60000);
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    m.innerHTML = `<div class="card" style="padding:16px;max-width:760px;width:100%;"><h3 style="margin:0 0 10px;color:#f8fafc;">${edit ? 'Editar' : 'Nova'} promoção</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
        <label style="grid-column:1/-1;font-size:11px;">Nome<input id="pf-name" maxlength="80" placeholder="Ex.: Black Friday – Eletrónicos" value="${esc(edit?.name || '')}" style="width:100%;margin-top:3px;"></label>
        <label style="font-size:11px;">Tipo<select id="pf-type" style="width:100%;margin-top:3px;"><option value="PERCENT" ${edit?.discount_type === 'AMOUNT' ? '' : 'selected'}>Percentagem (%)</option><option value="AMOUNT" ${edit?.discount_type === 'AMOUNT' ? 'selected' : ''}>Valor fixo por unidade</option></select></label>
        <label style="font-size:11px;">Desconto<input id="pf-val" type="number" min="0.01" step="0.01" value="${esc(edit?.discount_value ?? '')}" style="width:100%;margin-top:3px;"></label>
        <label style="font-size:11px;">Início<input id="pf-start" type="datetime-local" value="${toLocalInput(start0)}" style="width:100%;margin-top:3px;"></label>
        <label style="font-size:11px;">Duração<div style="display:flex;gap:4px;margin-top:3px;"><input id="pf-dur" type="number" min="1" step="1" style="width:70px;"><select id="pf-unit"><option value="m">minutos</option><option value="h">horas</option><option value="d" selected>dias</option></select></div></label>
        <label style="font-size:11px;">Fim (editável)<input id="pf-end" type="datetime-local" value="${edit ? toLocalInput(new Date(edit.ends_at)) : ''}" style="width:100%;margin-top:3px;"></label></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 6px;align-items:center;"><input id="pf-q" placeholder="Pesquisar produto…" style="flex:1 1 180px;">
        <select id="pf-cat"><option value="">Todas as categorias</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <button class="btn btn-secondary" id="pf-all" style="font-size:11px;">Seleccionar visíveis</button><button class="btn btn-secondary" id="pf-none" style="font-size:11px;">Limpar</button></div>
      <div id="pf-list" style="max-height:280px;overflow:auto;border:1px solid #334155;border-radius:8px;"></div><div id="pf-count" style="font-size:11px;color:#94a3b8;margin:6px 0;"></div>
      <div id="pf-err" style="color:#fca5a5;font-size:12px;min-height:16px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" id="pf-x">Fechar</button><button class="btn btn-primary" id="pf-save">Guardar e lançar</button></div></div>`;
    document.body.appendChild(m);
    const $ = (s) => m.querySelector(s);
    const price = (p) => { const v = Number($('#pf-val').value); if (!(v > 0)) return null; return Math.max(0, $('#pf-type').value === 'PERCENT' ? p.price * (1 - v / 100) : p.price - v); };
    const visible = () => { const q = $('#pf-q').value.trim().toLowerCase(), c = $('#pf-cat').value; return products.filter((p) => (!c || p.category === c) && (!q || `${p.name} ${p.code || ''}`.toLowerCase().includes(q))); };
    const paint = () => {
      $('#pf-list').innerHTML = visible().map((p) => { const np = price(p); return `<label style="display:flex;gap:8px;align-items:center;padding:5px 8px;border-bottom:1px solid #1e293b;font-size:12px;"><input type="checkbox" data-id="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}>
        <span style="flex:1;">${esc(p.name)} <small style="color:#94a3b8;">${esc(p.code || '')}</small></span><span class="mono">${np != null && np < p.price ? `<s style="color:#94a3b8;">${money(p.price)}</s> <b style="color:#34d399;">${money(np)}</b>` : money(p.price)}</span></label>`; }).join('') || '<div style="padding:12px;color:#94a3b8;">Sem produtos.</div>';
      $('#pf-count').textContent = `${sel.size} produto(s) seleccionado(s)`;
    };
    const fromDuration = () => { const d = Number($('#pf-dur').value), s = new Date($('#pf-start').value); if (d > 0 && !isNaN(s)) $('#pf-end').value = toLocalInput(new Date(s.getTime() + d * UNIT_MS[$('#pf-unit').value])); };
    $('#pf-list').onchange = (e) => { const id = e.target.dataset.id; if (!id) return; e.target.checked ? sel.add(id) : sel.delete(id); $('#pf-count').textContent = `${sel.size} produto(s) seleccionado(s)`; };
    ['#pf-q', '#pf-cat'].forEach((s) => { $(s).oninput = paint; });
    ['#pf-val', '#pf-type'].forEach((s) => { $(s).oninput = paint; });
    ['#pf-dur', '#pf-unit', '#pf-start'].forEach((s) => { $(s).oninput = fromDuration; });
    $('#pf-all').onclick = () => { visible().forEach((p) => sel.add(p.id)); paint(); };
    $('#pf-none').onclick = () => { sel.clear(); paint(); };
    $('#pf-x').onclick = () => m.remove();
    $('#pf-save').onclick = async () => {
      const btn = $('#pf-save'); btn.disabled = true; $('#pf-err').textContent = '';
      const s = new Date($('#pf-start').value), e = new Date($('#pf-end').value);
      try {
        const nm = normalizePromoName($('#pf-name').value); if (!nm.ok) throw new Error(nm.error);
        if (isNaN(s) || isNaN(e)) throw new Error('Indique início e fim (ou a duração).');
        const r = await rpc('fn_promo_save', { p_id: edit?.id || null, p_name: nm.value, p_type: $('#pf-type').value, p_value: Number($('#pf-val').value), p_starts: s.toISOString(), p_ends: e.toISOString(), p_product_ids: [...sel] });
        showToast(r.conflicts?.length ? `Guardada. ${r.conflicts.length} produto(s) já estão noutra promoção no mesmo período: vale o menor preço.` : 'Promoção guardada.', 'success');
        m.remove(); load();
      } catch (er) { $('#pf-err').textContent = friendly(er); btn.disabled = false; }
    };
    paint();
  }
  await load();
}
