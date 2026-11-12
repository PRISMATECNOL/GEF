/**
 * GEF/PRUMO v25 — «Tipo de negócio e catálogo» (Configurações → ADMIN da loja).
 * Mostra o tipo de negócio (só o Super Admin o corrige) e permite à loja gerir os seus próprios nomes de locais, categorias
 * (com subcategorias), unidades e atributos. Nada se apaga: «desactivar» esconde o item das listas e os produtos mantêm os valores.
 * O servidor valida tudo (fn_store_item_save: só ADMIN, só a própria loja).
 */
import { db } from '../../js/core/database.js';
import { showToast } from '../../js/components/toast.js';
import { loadSectorConfig } from '../../js/core/sector.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = [['text', 'Texto'], ['number', 'Número'], ['select', 'Lista de opções'], ['date', 'Data'], ['boolean', 'Sim / Não']];
const inpStyle = 'width:100%;margin-top:3px;';

export async function mountSectorConfig(root) {
  root.innerHTML = '<div class="card" style="font-size:12px;color:#94a3b8;">A carregar o tipo de negócio…</div>';
  const draw = async () => {
    let cfg;
    try { cfg = await loadSectorConfig(true); } catch (e) { cfg = null; }
    if (!cfg || !cfg.business_type) { root.innerHTML = '<div class="card" style="font-size:12px;color:#94a3b8;">Tipo de negócio indisponível (execute a migração v25).</div>'; return; }
    const row = (kind, it, extra) => `<tr data-kind="${kind}" data-code="${esc(it.code || it.key)}"><td>${esc(it.name || it.label)}</td><td style="font-size:11px;color:#94a3b8;">${extra || ''}</td>
      <td>${it.source === 'CUSTOM' ? '<span class="badge badge-info">Própria</span>' : '<span class="badge">Sector</span>'}</td>
      <td><input type="checkbox" data-act ${it.active !== false ? 'checked' : ''} title="Activo"></td></tr>`;
    const loc = (cfg.locations || []).map((l) => `<div><label style="font-size:11px;font-weight:700;color:#cbd5e1;">${l.code === 'LOJA' ? 'Local 1 (frente / balcão)' : l.code === 'ARMAZEM' ? 'Local 2 (armazém)' : 'Local 3 (reserva / pátio)'}</label>
      <input data-loc="${esc(l.code)}" value="${esc(l.label)}" maxlength="80" style="${inpStyle}"></div>`).join('');
    root.innerHTML = `<div class="card">
      <h3 style="font-size:14px;font-weight:800;color:#f8fafc;margin:0 0 4px;">Tipo de negócio e catálogo</h3>
      <div style="font-size:12px;color:#cbd5e1;margin-bottom:10px;">Tipo: <b>${esc(cfg.business_type_name)}</b> ${cfg.kind === 'ARMAZEM' ? '(armazém)' : ''} · só o Super Admin pode corrigir o tipo. ${cfg.configured ? '' : '<span style="color:#fbbf24;">Ainda a usar os predefinidos do sector (sem personalização). Ao guardar o primeiro item, a configuração do sector é carregada na loja.</span>'}
        ${cfg.flags?.batch_required || cfg.flags?.expiry_required ? `<br><span style="color:#fbbf24;">Este sector exige ${cfg.flags.batch_required ? 'lote' : ''}${cfg.flags.batch_required && cfg.flags.expiry_required ? ' e ' : ''}${cfg.flags.expiry_required ? 'validade' : ''} nas entradas de mercadoria.</span>` : ''}</div>

      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:8px 0 4px;">NOMES DOS LOCAIS DE STOCK</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">${loc}</div>
      <button class="btn btn-secondary" data-save-loc style="margin-top:8px;">Guardar nomes dos locais</button>

      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:16px 0 4px;">CATEGORIAS</div>
      <div style="overflow-x:auto;max-height:260px;overflow-y:auto;"><table class="data-table"><thead><tr><th>Categoria</th><th>Subcategorias</th><th>Origem</th><th>Activa</th></tr></thead><tbody>
        ${(cfg.categories || []).map((c) => row('CATEGORY', c, esc((c.subs || []).join(', ')))).join('') || '<tr><td colspan="4" style="color:#94a3b8;">Sem categorias.</td></tr>'}</tbody></table></div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-top:6px;">
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Nova categoria<input id="sc-cat" maxlength="80" style="${inpStyle}"></label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Subcategorias (separadas por vírgula)<input id="sc-subs" style="${inpStyle}"></label>
        <button class="btn btn-primary" data-add-cat>Adicionar</button></div>

      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:16px 0 4px;">UNIDADES</div>
      <div style="overflow-x:auto;max-height:220px;overflow-y:auto;"><table class="data-table"><thead><tr><th>Unidade</th><th>Código</th><th>Origem</th><th>Activa</th></tr></thead><tbody>
        ${(cfg.units || []).map((u) => row('UNIT', u, `${esc(u.code)}${u.fractional ? ' · fraccionável' : ''}`)).join('')}</tbody></table></div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:end;margin-top:6px;">
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Nova unidade (nome)<input id="sc-unit" maxlength="40" style="${inpStyle}"></label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Código (opcional)<input id="sc-unit-code" maxlength="12" style="${inpStyle}"></label>
        <label style="font-size:11px;"><input type="checkbox" id="sc-unit-frac"> Fraccionável</label>
        <button class="btn btn-primary" data-add-unit>Adicionar</button></div>
      <div style="font-size:10px;color:#94a3b8;margin-top:4px;">As conversões (ex.: 1 caixa = 12 un) definem-se em cada produto, em «Conversões».</div>

      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:16px 0 4px;">ATRIBUTOS DOS PRODUTOS</div>
      <div style="overflow-x:auto;max-height:260px;overflow-y:auto;"><table class="data-table"><thead><tr><th>Atributo</th><th>Tipo</th><th>Origem</th><th>Activo</th></tr></thead><tbody>
        ${(cfg.attributes || []).map((a) => row('ATTRIBUTE', a, `${esc((TYPES.find((t) => t[0] === a.type) || [0, a.type])[1])}${a.required ? ' · obrigatório' : ''}`)).join('') || '<tr><td colspan="4" style="color:#94a3b8;">Sem atributos.</td></tr>'}</tbody></table></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;align-items:end;margin-top:6px;">
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Novo atributo<input id="sc-attr" maxlength="60" style="${inpStyle}"></label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Tipo<select id="sc-attr-type" style="${inpStyle}">${TYPES.map((t) => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select></label>
        <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Opções (se lista; vírgulas)<input id="sc-attr-opts" style="${inpStyle}"></label>
        <label style="font-size:11px;"><input type="checkbox" id="sc-attr-req"> Obrigatório</label>
        <button class="btn btn-primary" data-add-attr>Adicionar</button></div>
      <div data-err style="display:none;color:#fca5a5;font-size:12px;margin-top:8px;"></div>
    </div>`;
    const err = (t) => { const e = root.querySelector('[data-err]'); e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; };
    const save = async (p, okMsg) => { try { err(''); await db.saveStoreSectorItem(p); showToast(okMsg || 'Guardado.', 'success'); await draw(); } catch (e) { err(e.message); } };
    const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

    root.querySelector('[data-save-loc]').onclick = async () => {
      try { err(''); for (const l of cfg.locations) { const v = root.querySelector(`[data-loc="${l.code}"]`).value.trim(); if (v && v !== l.label) await db.saveStoreSectorItem({ p_kind: 'LOCATION', p_code: l.code, p_label: v, p_data: {}, p_active: true }); }
        showToast('Nomes dos locais guardados.', 'success'); await draw(); } catch (e) { err(e.message); }
    };
    root.querySelector('[data-add-cat]').onclick = () => { const n = root.querySelector('#sc-cat').value.trim(); if (!n) return err('Indique o nome da categoria.');
      save({ p_kind: 'CATEGORY', p_code: null, p_label: n, p_data: { subs: list(root.querySelector('#sc-subs').value) }, p_active: true }, 'Categoria guardada.'); };
    root.querySelector('[data-add-unit]').onclick = () => { const n = root.querySelector('#sc-unit').value.trim(); if (!n) return err('Indique o nome da unidade.');
      save({ p_kind: 'UNIT', p_code: root.querySelector('#sc-unit-code').value.trim() || null, p_label: n, p_data: { fractional: root.querySelector('#sc-unit-frac').checked }, p_active: true }, 'Unidade guardada.'); };
    root.querySelector('[data-add-attr]').onclick = () => { const n = root.querySelector('#sc-attr').value.trim(); if (!n) return err('Indique o nome do atributo.');
      save({ p_kind: 'ATTRIBUTE', p_code: null, p_label: n, p_data: { type: root.querySelector('#sc-attr-type').value, options: list(root.querySelector('#sc-attr-opts').value), required: root.querySelector('#sc-attr-req').checked }, p_active: true }, 'Atributo guardado.'); };
    // activar / desactivar (nunca apaga)
    root.querySelectorAll('[data-act]').forEach((c) => { c.onchange = () => {
      const tr = c.closest('tr'), kind = tr.dataset.kind, code = tr.dataset.code;
      const src = kind === 'CATEGORY' ? cfg.categories.find((x) => x.code === code) : kind === 'UNIT' ? cfg.units.find((x) => x.code === code) : cfg.attributes.find((x) => x.key === code);
      const data = kind === 'CATEGORY' ? { subs: src.subs || [] } : kind === 'UNIT' ? { fractional: !!src.fractional } : { type: src.type, options: src.options || [], required: !!src.required };
      save({ p_kind: kind, p_code: code, p_label: src.name || src.label, p_data: data, p_active: c.checked }, c.checked ? 'Activado.' : 'Desactivado (os produtos existentes não mudam).');
    }; });
  };
  await draw();
}
