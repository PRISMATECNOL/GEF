/**
 * GEF | SUPER ADMIN: criar lojas, editar lojas e gerir utilizadores de cada loja.
 * As regras e permissões são validadas no servidor (migracao_angola_lojas_v9.sql).
 */
import { db } from '../../js/core/database.js';
import { displayLogin } from '../../js/core/login-id.js';
import { showToast } from '../../js/components/toast.js';
import { SUPPORTED_LANGUAGES, SUPPORTED_CURRENCIES } from '../../js/core/i18n.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { businessTypeOptionsHtml } from '../../js/core/sector.js';
import { openStoreUserModal } from '../../js/components/store-user-modal.js';

const ROLES = [['ADMIN', 'Admin da loja'], ['GERENTE', 'Gerente'], ['CASHIER', 'Caixa'], ['ESTOQUISTA', 'Estoquista'], ['MARKETING', 'Marketing & Vendas'], ['LOGISTA', 'Logista']];
const roleName = (r) => (ROLES.find((x) => x[0] === r) || [r, r])[1];
const val = (root, sel) => (root.querySelector(sel)?.value ?? '').trim();
const lbl = (t, inner) => `<label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;">${t}${inner}</label>`;
const inp = (id, v = '', type = 'text', ph = '') => `<input id="${id}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off" style="width:100%;margin-top:3px;">`;
const grid = (h) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:10px;">${h}</div>`;
const langSel = (sel) => `<select id="s-lang" style="width:100%;margin-top:3px;">${SUPPORTED_LANGUAGES.map((l) => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
const currSel = (sel) => `<select id="s-curr" style="width:100%;margin-top:3px;">${SUPPORTED_CURRENCIES.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.symbol)} · ${esc(c.country)}</option>`).join('')}</select>`;
const errHtml = '<div data-err style="display:none;color:#fca5a5;font-size:12px;margin:8px 0;"></div>';

function modal(title, bodyHtml, wide = false) {
  const m = document.createElement('div');
  m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.8);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;';
  m.innerHTML = `<div class="card" style="width:100%;max-width:${wide ? 860 : 640}px;padding:20px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="margin:0;font-size:16px;color:#f8fafc;">${esc(title)}</h3>
    <button class="btn btn-secondary" data-close style="padding:2px 10px;">✕</button></div><div data-body>${bodyHtml}</div></div>`;
  m.querySelector('[data-close]').onclick = () => m.remove();
  document.body.appendChild(m);
  const err = m.querySelector('[data-err]');
  m.setErr = (t) => { if (err) { err.textContent = t || ''; err.style.display = t ? 'block' : 'none'; } };
  return m;
}

/** Validação do formulário de nova loja (a mesma regra existe no servidor). */
export function validateStoreForm(f) {
  const errors = [];
  if (!f.name) errors.push('Nome da loja é obrigatório.');
  if (!f.phone) errors.push('Telefone é obrigatório.');
  if (!f.city) errors.push('Cidade é obrigatória.');
  if (!SUPPORTED_CURRENCIES.some((c) => c.id === f.currency)) errors.push('Seleccione a moeda.');
  if (!SUPPORTED_LANGUAGES.some((l) => l.id === f.language)) errors.push('Seleccione o idioma.');
  if (!f.adminEmail || (f.adminEmail.replace(/[^0-9]/g, '').length < 7 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.adminEmail))) errors.push('Telemóvel do administrador inválido.');
  if (!f.adminPassword || f.adminPassword.length < 8) errors.push('A palavra-passe deve ter pelo menos 8 caracteres.');
  if (Number(f.fee) < 0 || !Number.isFinite(Number(f.fee))) errors.push('Mensalidade inválida.');
  if (!f.businessType) errors.push('Seleccione o tipo de negócio (obrigatório).');
  return errors;
}

export async function openCreateStoreModal({ onDone } = {}) {
  let ambs = [];
  try { ambs = ((await db.adminListAmbassadors(false)) || []).filter((a) => a.status === 'ATIVO'); } catch (e) { /* sem v7: sem lista */ }
  const packages = ((await db.listFeePackages().catch(() => null)) || []).filter((p) => p.active);
  const bTypes = await db.getBusinessTypes().catch(() => []);
  const m = modal('Nova loja', `
    ${grid(lbl('Tipo de negócio *', `<select id="s-bt" style="width:100%;margin-top:3px;">${businessTypeOptionsHtml(bTypes, '', esc)}</select>`))}
    ${grid(lbl('Nome da loja *', inp('s-name')) + lbl('Nome comercial', inp('s-trade')) + lbl('Responsável (dono)', inp('s-owner')) + lbl('Telefone *', inp('s-phone')) + lbl('NUIT / NIF', inp('s-nif')) + lbl('Email da loja', inp('s-email', '', 'email')))}
    ${grid(lbl('Cidade *', inp('s-city')) + lbl('Província', inp('s-prov')) + lbl('Morada', inp('s-addr')))}
    ${grid(lbl('Moeda *', currSel('MT')) + lbl('Idioma *', langSel('pt')))}
    <div style="font-size:10px;color:#94a3b8;margin:-4px 0 10px;">Loja em Angola: escolha Kz — as formas de pagamento angolanas (Numerário, Multicaixa Express, TPA/POS, Transferência IBAN, Referência Multicaixa, Carteira móvel) ficam activas automaticamente.</div>
    ${grid(lbl('Mensalidade', packages.length
        ? `<select id="s-fee" style="width:100%;margin-top:3px;">${packages.map((p) => `<option value="${esc(p.monthly_fee)}" ${Number(p.monthly_fee) === 3500 ? 'selected' : ''}>${esc(p.name)} – ${esc(p.monthly_fee)}</option>`).join('')}</select>`
        : inp('s-fee', '3500', 'number')) + lbl('Dias de teste inicial', inp('s-trial', '30', 'number')) +
      lbl('Embaixador (opcional)', `<select id="s-amb" style="width:100%;margin-top:3px;"><option value="">— sem embaixador —</option>${ambs.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.is_super ? ' (Super)' : ''}</option>`).join('')}</select>`))}
    <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:8px 0 4px;">ADMINISTRADOR DA LOJA</div>
    ${grid(lbl('Nome *', inp('s-aname')) + lbl('Telemóvel de acesso *', inp('s-aemail', '', 'tel')) + lbl('Palavra-passe inicial * (mín. 8)', inp('s-apass', '', 'text')))}
    ${errHtml}<button class="btn btn-primary" data-save>Criar loja e administrador</button>`, true);
  m.querySelector('[data-save]').onclick = async (ev) => {
    const f = { name: val(m, '#s-name'), phone: val(m, '#s-phone'), city: val(m, '#s-city'), currency: val(m, '#s-curr'), language: val(m, '#s-lang'),
      adminEmail: val(m, '#s-aemail'), adminPassword: m.querySelector('#s-apass').value, fee: val(m, '#s-fee') || 0, businessType: val(m, '#s-bt') };
    const errs = validateStoreForm(f);
    if (errs.length) return m.setErr(errs.join(' '));
    ev.target.disabled = true; m.setErr('');
    try {
      await db.adminCreateStore({
        p_name: f.name, p_trade_name: val(m, '#s-trade'), p_owner_name: val(m, '#s-owner'), p_phone: f.phone, p_city: f.city, p_province: val(m, '#s-prov'),
        p_address: val(m, '#s-addr'), p_nuit_nif: val(m, '#s-nif'), p_email: val(m, '#s-email'), p_currency: f.currency, p_language: f.language,
        p_monthly_fee: Number(f.fee), p_trial_days: Number(val(m, '#s-trial') || 30), p_admin_email: f.adminEmail, p_admin_password: f.adminPassword,
        p_admin_name: val(m, '#s-aname') || val(m, '#s-owner') || f.name, p_ambassador_id: val(m, '#s-amb') || null, p_contract_months: 12, p_business_type: f.businessType
      });
      db.invalidateStoresCache?.();
      showToast('Loja criada com administrador.', 'success'); m.remove(); onDone && onDone();
    } catch (e) { m.setErr(e.message); ev.target.disabled = false; }
  };
}

export function openEditStoreModal(store, { onDone } = {}) {
  const m = modal(`Editar loja — ${store.name}`, `
    ${grid(lbl('Nome da loja *', inp('s-name', store.name)) + lbl('Nome comercial', inp('s-trade', store.tradeName || '')) + lbl('Telefone', inp('s-phone', store.phone || '')) +
      lbl('NUIT / NIF', inp('s-nif', store.cnpjNif || '')) + lbl('Email', inp('s-email', store.email || '', 'email')))}
    ${grid(lbl('Cidade', inp('s-city', store.city || '')) + lbl('Província', inp('s-prov', store.province || '')) + lbl('Morada', inp('s-addr', store.address || '')))}
    ${grid(lbl('Moeda *', currSel(store.currency || 'MT')) + lbl('Idioma *', langSel(store.language || 'pt')))}
    <div id="s-bt-box" style="margin-bottom:10px;font-size:11px;color:#94a3b8;">A carregar tipo de negócio…</div>
    <div style="font-size:10px;color:#fbbf24;margin-bottom:8px;">Mudar a moeda altera só a apresentação e as formas de pagamento daqui para a frente; vendas e valores já registados não são recalculados.</div>
    ${errHtml}<button class="btn btn-primary" data-save>Guardar</button>`, true);
  let curBt = null;
  (async () => {
    try {
      const [types, cfg] = await Promise.all([db.getBusinessTypes(), db.getStoreSectorConfig(store.id)]);
      curBt = cfg?.business_type || null;
      m.querySelector('#s-bt-box').innerHTML = lbl('Tipo de negócio (só o Super Admin corrige)', `<select id="s-bt" style="width:100%;margin-top:3px;">${businessTypeOptionsHtml(types, curBt, esc)}</select>`) +
        `<label style="display:flex;gap:6px;align-items:center;margin-top:6px;font-size:11px;"><input type="checkbox" id="s-bt-load" checked> Carregar os predefinidos do novo sector (acrescenta; nunca apaga produtos nem categorias já usadas)</label>`;
    } catch (e) { m.querySelector('#s-bt-box').textContent = 'Tipo de negócio indisponível (execute a migração v25).'; }
  })();
  m.querySelector('[data-save]').onclick = async (ev) => {
    if (!val(m, '#s-name')) return m.setErr('Nome da loja é obrigatório.');
    ev.target.disabled = true; m.setErr('');
    try {
      const newBt = val(m, '#s-bt');
      if (curBt && newBt && newBt !== curBt) await db.adminSetStoreBusinessType(store.id, newBt, !!m.querySelector('#s-bt-load')?.checked);
      await db.adminUpdateStore({ p_store_id: store.id, p_name: val(m, '#s-name'), p_trade_name: val(m, '#s-trade'), p_nuit_nif: val(m, '#s-nif'), p_city: val(m, '#s-city'),
        p_province: val(m, '#s-prov'), p_address: val(m, '#s-addr'), p_phone: val(m, '#s-phone'), p_email: val(m, '#s-email'), p_currency: val(m, '#s-curr'), p_language: val(m, '#s-lang') });
      db.invalidateStoresCache?.();
      showToast('Loja actualizada.', 'success'); m.remove(); onDone && onDone();
    } catch (e) { m.setErr(e.message); ev.target.disabled = false; }
  };
}

export async function openStoreUsersModal(store) {
  const m = modal(`Utilizadores — ${store.name}`, '<div style="color:#94a3b8;font-size:12px;">A carregar…</div>', true);
  const roleOpts = (sel) => ROLES.map((r) => `<option value="${r[0]}" ${r[0] === sel ? 'selected' : ''}>${r[1]}</option>`).join('');
  const draw = async () => {
    let users = [];
    try { users = (await db.adminListStoreUsers(store.id)) || []; } catch (e) { m.querySelector('[data-body]').innerHTML = `<span style="color:#fca5a5;">${esc(e.message)}</span>`; return; }
    m.querySelector('[data-body]').innerHTML = `
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Nome</th><th>Acesso</th><th>Função</th><th>Activo</th><th></th></tr></thead><tbody>
      ${users.length ? users.map((u) => `<tr data-id="${esc(u.id)}"><td><input class="u-name" value="${esc(u.full_name)}"></td><td style="font-size:11px;">${esc(displayLogin(u.email))}</td>
        <td><select class="u-role">${roleOpts(u.role)}</select></td><td><input class="u-active" type="checkbox" ${u.active ? 'checked' : ''}></td>
        <td style="white-space:nowrap;"><button class="btn btn-secondary u-save" style="padding:2px 8px;">Guardar</button> <button class="btn btn-secondary u-pass" style="padding:2px 8px;">Nova palavra-passe</button></td></tr>`).join('')
        : '<tr><td colspan="5" style="color:#94a3b8;">Esta loja ainda não tem utilizadores.</td></tr>'}</tbody></table></div>
      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:14px 0 4px;">NOVO UTILIZADOR</div>
      ${grid(lbl('Nome *', inp('n-name')) + lbl('Telemóvel de acesso *', inp('n-email', '', 'tel')) + lbl('Palavra-passe * (mín. 8)', inp('n-pass')) + lbl('Função *', `<select id="n-role" style="width:100%;margin-top:3px;">${roleOpts('CASHIER')}</select>`))}
      ${errHtml}<button class="btn btn-primary" data-add>Criar utilizador</button>`;
    const body = m.querySelector('[data-body]');
    m.setErr = (t) => { const e = body.querySelector('[data-err]'); if (e) { e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; } };
    body.querySelectorAll('.u-save').forEach((b) => { b.onclick = async () => {
      const tr = b.closest('tr');
      try { await db.adminUpdateStoreUser({ p_user_id: tr.dataset.id, p_full_name: tr.querySelector('.u-name').value.trim(), p_role: tr.querySelector('.u-role').value, p_active: tr.querySelector('.u-active').checked });
        showToast('Utilizador actualizado.', 'success'); draw(); } catch (e) { m.setErr(e.message); } }; });
    body.querySelectorAll('.u-pass').forEach((b) => { b.onclick = async () => {
      const tr = b.closest('tr'); const pw = window.prompt('Nova palavra-passe (mín. 8 caracteres):');
      if (pw === null) return;
      try { await db.adminResetStoreUserPassword(tr.dataset.id, pw); showToast('Palavra-passe alterada.', 'success'); } catch (e) { m.setErr(e.message); } }; });
    body.querySelector('[data-add]').onclick = async (ev) => {
      const f = { name: val(body, '#n-name'), email: val(body, '#n-email'), pass: body.querySelector('#n-pass').value, role: val(body, '#n-role') };
      if (!f.name || (f.email.replace(/[^0-9]/g, '').length < 7 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) || f.pass.length < 8) return m.setErr('Preencha nome, um telemóvel válido e uma palavra-passe de pelo menos 8 caracteres.');
      ev.target.disabled = true;
      try { await db.createStoreUserSecure({ storeId: store.id, role: f.role, fullName: f.name, login: f.email, password: f.pass }); showToast(`Utilizador criado como ${roleName(f.role)}.`, 'success'); draw(); }
      catch (e) { m.setErr(e.message); ev.target.disabled = false; }
    };
  };
  await draw();
}

/* ---------- v10: loja virtual (Super Admin) ---------- */
import { storeUrl, bindShareButtons } from '../../js/components/share-link.js';

/** Activar/desactivar a loja virtual de UMA loja (independente do estado da loja no sistema) e ajustar o endereço. */
export function openVstoreModal(store, ov, { onDone } = {}) {
  const slug = (ov && ov.slug) || store.slug || '';
  const enabled = !!(ov && ov.vstore_enabled);
  const m = modal(`Loja virtual — ${store.name}`, `
    <div style="font-size:12px;color:#cbd5e1;margin-bottom:8px;">Estado da loja no sistema: <b>${ov && ov.store_active === false ? 'SUSPENSA' : 'ACTIVA'}</b> (gerido em «Gestão de Filiais»). O estado da loja virtual é independente.
      Se for desactivada, o endereço público deixa de aceitar encomendas e pedidos de cotação; o histórico fica preservado.</div>
    ${lbl('Endereço da loja (letras minúsculas, números e hífens)', inp('v-slug', slug))}
    <div style="font-size:11px;color:#94a3b8;margin:4px 0 8px;" id="v-url">${esc(slug ? storeUrl(slug) : '')}</div>
    <label style="font-size:13px;color:#f8fafc;display:block;margin:10px 0;"><input type="checkbox" id="v-on" ${enabled ? 'checked' : ''}> Loja virtual activada</label>
    ${ov ? `<div style="font-size:11px;color:#94a3b8;">Produtos: ${ov.products} (publicados: ${ov.published}) · Encomendas online (30 dias): ${ov.web_orders_30d} · Vendas (30 dias): ${ov.sales_30d} · Utilizadores: ${ov.users}</div>` : ''}
    <div style="font-size:10px;color:#fbbf24;margin-top:6px;">Alterar o endereço invalida os links já partilhados.</div>
    ${errHtml}<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><button class="btn btn-primary" data-save>Guardar</button>
    ${slug ? `<button class="btn btn-secondary" data-copy-url="${esc(storeUrl(slug))}">Copiar link</button><button class="btn btn-secondary" data-share-url="${esc(storeUrl(slug))}" data-share-title="${esc(store.name)}">Partilhar</button>` : ''}</div>`);
  bindShareButtons(m);
  m.querySelector('[data-save]').onclick = async (ev) => {
    ev.target.disabled = true; m.setErr('');
    try {
      const want = val(m, '#v-slug');
      await db.rpcV7('fn_admin_set_vstore', { p_store_id: store.id, p_enabled: m.querySelector('#v-on').checked, p_slug: want && want !== slug ? want : null });
      showToast('Loja virtual actualizada.', 'success'); m.remove(); onDone && onDone();
    } catch (e) { m.setErr(e.message); ev.target.disabled = false; }
  };
}

/**
 * v24 - TEMA da loja (SÓ Super Admin): atribui o «Tema Padrão» (actual) ou um tema restrito (ex.: Liquid Glass Premium).
 * Atribuir NÃO altera a loja online: o Administrador da loja aplica o tema em «Loja virtual → Personalização».
 * Os temas listados vêm da base de dados (vstore_themes.restricted), por isso um tema novo aparece aqui sem alterar código.
 * O servidor volta a validar tudo (fn_admin_set_store_theme só aceita o SUPERADMIN).
 */
export async function openStoreThemeModal(store, { onDone } = {}) {
  const m = modal(`Tema — ${store.name}`, '<div style="color:#94a3b8;font-size:12px;">A carregar…</div>');
  let info;
  try { info = await db.rpcV7('fn_admin_store_theme_info', { p_store_id: store.id }); }
  catch (e) {
    const missing = /could not find the function|schema cache/i.test(e.message);
    m.querySelector('[data-body]').innerHTML = `<span style="color:#fca5a5;">${esc(missing ? 'Falta executar migracao_temas_pagamentos_v24.sql no Supabase.' : e.message)}</span>`;
    return;
  }
  const current = info.grant || 'padrao';
  const opt = (id, name, desc) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin:6px 0;border:1px solid ${id === current ? '#ea580c' : '#334155'};border-radius:10px;cursor:pointer;">
      <input type="radio" name="st-theme" value="${esc(id)}" ${id === current ? 'checked' : ''} style="margin-top:3px;">
      <span><b style="color:#f8fafc;font-size:13px;">${esc(name)}</b><br><span style="font-size:11px;color:#94a3b8;">${esc(desc || '')}</span></span></label>`;
  m.querySelector('[data-body]').innerHTML = `
    <div style="font-size:12px;color:#cbd5e1;margin-bottom:8px;">Tema visível agora na loja online: <b>${esc(info.active)}</b>.</div>
    ${opt('padrao', 'Tema Padrão (actual)', 'Sem atribuição especial. A loja usa os temas normais, como sempre.')}
    ${(info.themes || []).map((t) => opt(t.id, t.name, t.description)).join('')}
    <div style="font-size:11px;color:#fbbf24;margin:8px 0;">Atribuir um tema NÃO o aplica automaticamente: fica disponível para o Administrador da loja, que o aplica em «Loja virtual → Personalização». Voltar ao Padrão ou trocar de tema premium repõe o tema padrão na loja online de imediato.</div>
    ${errHtml}<button class="btn btn-primary" data-save>Guardar atribuição</button>`;
  const body = m.querySelector('[data-body]');
  m.setErr = (t) => { const e = body.querySelector('[data-err]'); if (e) { e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; } };
  body.querySelector('[data-save]').onclick = async (ev) => {
    const chosen = body.querySelector('input[name="st-theme"]:checked')?.value || 'padrao';
    if (chosen === current) { m.remove(); return; }
    ev.target.disabled = true; m.setErr('');
    try {
      const r = await db.rpcV7('fn_admin_set_store_theme', { p_store_id: store.id, p_theme: chosen === 'padrao' ? null : chosen });
      showToast(chosen === 'padrao' ? `Tema Padrão atribuído.${r.active_reverted ? ' A loja online voltou ao tema padrão.' : ''}` : 'Tema atribuído. O Administrador da loja pode aplicá-lo na Personalização.', 'success');
      m.remove(); onDone && onDone();
    } catch (e) { m.setErr(e.message); ev.target.disabled = false; }
  };
}

/** O Super Admin controla os temas que as lojas podem escolher. */
export async function openThemesModal() {
  const res = await db.requireClient().from('vstore_themes').select('id,name,enabled,restricted').order('sort_order');
  const themes = res.data || [];
  const m = modal('Temas da loja virtual', `<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">As lojas só podem escolher os temas activos.</div>
    ${themes.map((t) => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;color:#f8fafc;margin:6px 0;"><input type="checkbox" data-theme="${esc(t.id)}" ${t.enabled ? 'checked' : ''}> ${esc(t.name)}${t.restricted ? ' <span style="font-size:10px;color:#fbbf24;">(premium: só por atribuição, botão TEMA de cada loja)</span>' : ''}</label>`).join('') || '<div style="color:#fca5a5;">Sem temas (execute a migração v10).</div>'}${errHtml}`);
  m.querySelectorAll('[data-theme]').forEach((cb) => { cb.onchange = async () => {
    try { await db.rpcV7('fn_admin_set_theme_enabled', { p_theme: cb.dataset.theme, p_enabled: cb.checked }); showToast('Tema actualizado.', 'success'); }
    catch (e) { cb.checked = !cb.checked; m.setErr(e.message); } }; });
}


/* ---------- v25: tipos de negócio (Super Admin): ver, criar (clonando) e activar/desactivar ---------- */
export async function openBusinessTypesModal() {
  const m = modal('Tipos de negócio', '<div style="color:#94a3b8;font-size:12px;">A carregar…</div>', true);
  const draw = async () => {
    let rows = [];
    try { rows = ((await db.requireClient().from('business_types').select('id,name,kind,description,active,is_system').order('sort_order')).data) || []; }
    catch (e) { m.querySelector('[data-body]').innerHTML = `<span style="color:#fca5a5;">${esc(e.message)}</span>`; return; }
    const body = m.querySelector('[data-body]');
    body.innerHTML = `<div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Cada sector traz categorias, unidades, atributos e nomes dos locais. Um sector desactivado deixa de aparecer no cadastro; as lojas que já o usam não são afectadas.</div>
      <div style="overflow-x:auto;max-height:46vh;overflow-y:auto;"><table class="data-table"><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Activo</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td style="font-size:11px;">${esc(r.id)}</td><td>${esc(r.name)}</td><td>${r.kind === 'ARMAZEM' ? 'Armazém' : 'Comércio'}</td><td><input type="checkbox" data-bt="${esc(r.id)}" ${r.active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>
      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:12px 0 4px;">NOVO SECTOR</div>
      ${grid(lbl('Nome *', inp('nb-name')) + lbl('Código (opcional)', inp('nb-id', '', 'text', 'ex.: OPTICA')) +
        lbl('Tipo', '<select id="nb-kind" style="width:100%;margin-top:3px;"><option value="COMERCIO">Comércio</option><option value="ARMAZEM">Armazém</option></select>') +
        lbl('Copiar predefinidos de', `<select id="nb-clone" style="width:100%;margin-top:3px;"><option value="">— nenhum (mínimo) —</option>${rows.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`))}
      ${errHtml}<button class="btn btn-primary" data-add>Criar sector</button>`;
    m.setErr = (t) => { const e = body.querySelector('[data-err]'); if (e) { e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; } };
    body.querySelectorAll('[data-bt]').forEach((c) => { c.onchange = async () => {
      const r = rows.find((x) => x.id === c.dataset.bt);
      try { await db.adminSaveBusinessType({ p_id: r.id, p_name: r.name, p_kind: r.kind, p_description: r.description, p_clone_from: null, p_active: c.checked }); showToast('Sector actualizado.', 'success'); }
      catch (e) { c.checked = !c.checked; m.setErr(e.message); } }; });
    body.querySelector('[data-add]').onclick = async (ev) => {
      const name = val(body, '#nb-name'); if (!name) return m.setErr('Indique o nome do sector.');
      const id = val(body, '#nb-id') || name;
      ev.target.disabled = true;
      try { await db.adminSaveBusinessType({ p_id: id, p_name: name, p_kind: val(body, '#nb-kind'), p_description: null, p_clone_from: val(body, '#nb-clone') || null, p_active: true }); showToast('Sector criado.', 'success'); draw(); }
      catch (e) { m.setErr(e.message); ev.target.disabled = false; }
    };
  };
  await draw();
}
