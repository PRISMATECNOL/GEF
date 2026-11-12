/**
 * GEF | SUPER ADMIN: GESTÃO DE PERFIS (Embaixadores e Super Embaixadores)
 * Todas as regras são validadas no servidor (migracao_super_embaixadores_v7.sql); aqui só há formulários,
 * pré-visualização das consequências e confirmação. Idioma e moeda vêm das listas já existentes (i18n.js).
 */
import { db } from '../../js/core/database.js';
import { showToast } from '../../js/components/toast.js';
import { SUPPORTED_LANGUAGES, SUPPORTED_CURRENCIES } from '../../js/core/i18n.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { normalizeText } from '../../js/components/table-search.js';

const STATUS_BADGE = { ATIVO: 'badge-emerald', BLOQUEADO: 'badge-red', DESATIVADO: 'badge-amber' };
const ACTION_LABEL = {
  CREATED: 'Criação', CREATED_BY_SUPER: 'Criado por Super Embaixador', PROMOTED: 'Promoção', DEMOTED: 'Despromoção',
  AMBASSADOR_TRANSFERRED: 'Transferência de embaixador', STORE_TRANSFERRED: 'Transferência de loja', PROFILE_EDITED: 'Edição',
  RATES_CHANGED: 'Alteração de comissões', BLOCKED: 'Bloqueio', UNBLOCKED: 'Desbloqueio', DELETED: 'Eliminação', FEE_PACKAGE_SAVED: 'Pacote de mensalidade'
};
const langOpts = (sel) => `<option value="">— seleccione —</option>${SUPPORTED_LANGUAGES.map((l) => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}`;
const currOpts = (sel) => `<option value="">— seleccione —</option>${SUPPORTED_CURRENCIES.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.symbol)} · ${esc(c.country)}</option>`).join('')}`;
const val = (root, sel) => (root.querySelector(sel)?.value ?? '').trim();
const fdt = (d) => { const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleString('pt-PT'); };

/** Validação do formulário de criação/edição (a mesma regra existe no servidor). */
export function validateProfileForm(f) {
  const errors = [];
  if (!f.name) errors.push('Nome é obrigatório.');
  if (!f.phone) errors.push('Telefone é obrigatório.');
  if (!SUPPORTED_LANGUAGES.some((l) => l.id === f.language)) errors.push('Seleccione o idioma (obrigatório).');
  if (!SUPPORTED_CURRENCIES.some((c) => c.id === f.currency)) errors.push('Seleccione a moeda (obrigatório).');
  const c = Number(f.commission);
  if (f.commission !== undefined && (!Number.isFinite(c) || c < 0 || c > 100)) errors.push('Comissão inválida (0 a 100).');
  return errors;
}

export async function mountProfileAdmin(container, { onBack } = {}) {
  const S = { list: [], q: '', kind: '', status: '', geo: '' };

  const modal = (title, bodyHtml, { wide = false } = {}) => {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.8);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;';
    m.innerHTML = `<div class="card" style="width:100%;max-width:${wide ? 860 : 620}px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="margin:0;font-size:16px;color:#f8fafc;">${esc(title)}</h3>
      <button class="btn btn-secondary" data-close style="padding:2px 10px;">✕</button></div><div data-body>${bodyHtml}</div></div>`;
    m.querySelector('[data-close]').onclick = () => m.remove();
    document.body.appendChild(m);
    return m;
  };
  const lbl = (t, inner) => `<label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;">${t}${inner}</label>`;
  const inp = (id, ph = '', v = '', type = 'text') => `<input id="${id}" type="${type}" placeholder="${esc(ph)}" value="${esc(v)}" style="width:100%;margin-top:3px;">`;
  const grid = (h) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:10px;">${h}</div>`;
  const supers = () => S.list.filter((a) => a.is_super && a.status === 'ATIVO' && !a.deleted);
  const superOpts = (exclude, sel) => `<option value="">— seleccione —</option>${supers().filter((a) => a.id !== exclude).map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
  const nameOf = (id) => S.list.find((a) => a.id === id)?.name || '—';
  const errBox = (m) => { const e = m.querySelector('[data-err]'); return (t) => { e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; }; };
  const errHtml = '<div data-err style="display:none;color:#fca5a5;font-size:12px;margin:8px 0;"></div>';

  const run = async (btn, fn, okMsg, modalEl, setErr) => {
    btn.disabled = true; setErr && setErr('');
    try { await fn(); showToast(okMsg, 'success'); modalEl.remove(); await load(); }
    catch (e) { setErr ? setErr(e.message) : showToast(e.message, 'error'); btn.disabled = false; }
  };

  // ---------- criar ----------
  const geoFields = (a = {}) => grid(
    lbl('País', inp('f-country', 'Moçambique', a.geo_country || '')) + lbl('Província', inp('f-province', '', a.geo_province || '')) +
    lbl('Distrito', inp('f-district', '', a.geo_district || '')) + lbl('Cidade / Município', inp('f-city', '', a.geo_city || '')) +
    lbl('Bairro / Zona', inp('f-neigh', '', a.geo_neighborhood || '')) + lbl('Descrição da área (opcional)', inp('f-geodesc', '', a.geo_description || '')));

  const openCreate = (superKind) => {
    const m = modal(superKind ? 'Novo Super Embaixador' : 'Novo Embaixador', `
      ${grid(lbl('Nome *', inp('f-name')) + lbl('Telefone *', inp('f-phone')) + lbl('WhatsApp', inp('f-wa')) + lbl('Email de contacto', inp('f-email', '', '', 'email')) + lbl('Dados de pagamento (M-Pesa/Banco)', inp('f-pix')))}
      ${grid(lbl('Idioma *', `<select id="f-lang" style="width:100%;margin-top:3px;">${langOpts('')}</select>`) + lbl('Moeda *', `<select id="f-curr" style="width:100%;margin-top:3px;">${currOpts('')}</select>`))}
      ${grid(lbl(superKind ? 'Comissão pelas lojas directas (%) *' : 'Comissão (%) *', inp('f-comm', '', '10', 'number')) +
        (superKind ? lbl('Comissão pelas lojas da rede (%)', inp('f-ind', '', '0', 'number')) : lbl('Super Embaixador responsável', `<select id="f-parent" style="width:100%;margin-top:3px;">${superOpts(null, '')}</select>`)) +
        lbl('Vigência desde', inp('f-from', '', new Date().toISOString().slice(0, 10), 'date')))}
      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:8px 0 4px;">ÁREA GEOGRÁFICA DE ACTUAÇÃO</div>${geoFields()}
      <div style="font-size:11px;font-weight:800;color:#94a3b8;margin:8px 0 4px;">ACESSO (opcional — pode ser criado depois)</div>
      ${grid(lbl('Telemóvel de acesso', inp('f-lemail', '', '', 'tel')) + lbl('Senha inicial', inp('f-lpass', '', '', 'password')))}
      ${errHtml}<button class="btn btn-primary" data-save>Guardar</button>`, { wide: true });
    const setErr = errBox(m);
    m.querySelector('[data-save]').onclick = (ev) => {
      const f = { name: val(m, '#f-name'), phone: val(m, '#f-phone'), language: val(m, '#f-lang'), currency: val(m, '#f-curr'), commission: val(m, '#f-comm') };
      const errs = validateProfileForm(f);
      if (errs.length) return setErr(errs.join(' '));
      const params = {
        p_kind: superKind ? 'SUPER_EMBAIXADOR' : 'EMBAIXADOR', p_name: f.name, p_phone: f.phone, p_whatsapp: val(m, '#f-wa'), p_email: val(m, '#f-email'), p_pix_mpesa: val(m, '#f-pix'),
        p_language: f.language, p_currency: f.currency, p_commission_rate: Number(f.commission), p_indirect_rate: superKind ? Number(val(m, '#f-ind') || 0) : 0,
        p_effective_from: val(m, '#f-from') || null, p_parent_id: superKind ? null : (val(m, '#f-parent') || null),
        p_country: val(m, '#f-country'), p_province: val(m, '#f-province'), p_district: val(m, '#f-district'), p_city: val(m, '#f-city'),
        p_neighborhood: val(m, '#f-neigh'), p_geo_description: val(m, '#f-geodesc'),
        p_login_email: val(m, '#f-lemail') || null, p_login_password: val(m, '#f-lpass') || null
      };
      run(ev.target, () => db.adminCreateAmbassadorProfile(params), superKind ? 'Super Embaixador criado.' : 'Embaixador criado.', m, setErr);
    };
  };

  // ---------- editar contactos / área / idioma / moeda ----------
  const openEdit = (a) => {
    const m = modal(`Editar ${a.name}`, `
      ${grid(lbl('Nome *', inp('f-name', '', a.name)) + lbl('Telefone *', inp('f-phone', '', a.phone)) + lbl('WhatsApp', inp('f-wa', '', a.whatsapp || '')) + lbl('Email', inp('f-email', '', a.email || '', 'email')))}
      ${grid(lbl('Idioma *', `<select id="f-lang" style="width:100%;margin-top:3px;">${langOpts(a.language)}</select>`) + lbl('Moeda *', `<select id="f-curr" style="width:100%;margin-top:3px;">${currOpts(a.currency)}</select>`))}
      <div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">Idioma/moeda só mudam a apresentação do painel; os valores financeiros já registados não são alterados.</div>
      ${geoFields(a)}${lbl('Motivo da alteração', inp('f-reason'))}${errHtml}<button class="btn btn-primary" data-save style="margin-top:8px;">Guardar</button>`, { wide: true });
    const setErr = errBox(m);
    m.querySelector('[data-save]').onclick = (ev) => {
      const f = { name: val(m, '#f-name'), phone: val(m, '#f-phone'), language: val(m, '#f-lang'), currency: val(m, '#f-curr') };
      const errs = validateProfileForm(f);
      if (errs.length) return setErr(errs.join(' '));
      run(ev.target, () => db.adminSetAmbassadorProfile({ p_ambassador_id: a.id, p_name: f.name, p_phone: f.phone, p_whatsapp: val(m, '#f-wa'), p_email: val(m, '#f-email'),
        p_language: f.language, p_currency: f.currency, p_country: val(m, '#f-country'), p_province: val(m, '#f-province'), p_district: val(m, '#f-district'),
        p_city: val(m, '#f-city'), p_neighborhood: val(m, '#f-neigh'), p_geo_description: val(m, '#f-geodesc'), p_reason: val(m, '#f-reason') || null }), 'Perfil actualizado.', m, setErr);
    };
  };

  // ---------- comissões com vigência ----------
  const openRates = (a) => {
    const m = modal(`Comissões de ${a.name}`, `
      ${grid(lbl(a.is_super ? 'Comissão pelas lojas directas (%)' : 'Comissão do Embaixador (%)', inp('f-comm', '', a.commission_rate, 'number')) +
        (a.is_super ? lbl('Comissão pelas lojas da rede (%)', inp('f-ind', '', a.indirect_commission_rate, 'number')) : '') +
        lbl('Data de vigência', inp('f-from', '', new Date().toISOString().slice(0, 10), 'date')))}
      <div style="font-size:10px;color:#94a3b8;">A nova taxa vale só para pagamentos futuros; comissões já geradas não mudam. ${a.pending_rates ? `Há ${a.pending_rates} alteração(ões) agendada(s).` : ''}</div>
      ${lbl('Motivo', inp('f-reason'))}${errHtml}<button class="btn btn-primary" data-save style="margin-top:8px;">Guardar</button>`);
    const setErr = errBox(m);
    m.querySelector('[data-save]').onclick = (ev) => run(ev.target, () => db.adminScheduleRates(a.id, Number(val(m, '#f-comm')), a.is_super ? Number(val(m, '#f-ind') || 0) : 0, val(m, '#f-from'), val(m, '#f-reason') || null), 'Comissões guardadas.', m, setErr);
  };

  // ---------- operações com pré-visualização (promover / despromover / transferir / eliminar) ----------
  const previewBlock = (p) => `
    <div class="card" style="margin-bottom:10px;font-size:12px;color:#cbd5e1;">
      <div><b>${esc(p.ambassador.name)}</b> · ${p.ambassador.is_super ? 'Super Embaixador' : 'Embaixador'} · comissão pendente ${Number(p.ambassador.pending_commissions).toFixed(2)}</div>
      <div>Super Embaixador actual: ${p.current_parent ? `${esc(p.current_parent.name)} (${esc(p.current_parent.phone || '')})` : '— nenhum —'}</div>
      ${p.target ? `<div>Destino: <b>${esc(p.target.name)}</b></div>` : ''}
      <div>Embaixadores na rede: ${p.network_ambassadors.length}${p.network_ambassadors.length ? ' — ' + p.network_ambassadors.map((c) => `${esc(c.name)} (${c.stores} lojas)`).join(', ') : ''}</div>
      <div>Lojas directas: ${p.direct_stores.length}${p.direct_stores.length ? ' — ' + p.direct_stores.map((s) => esc(s.name)).join(', ') : ''}</div>
      ${p.warnings.map((w) => `<div style="color:#fbbf24;margin-top:4px;">⚠ ${esc(w)}</div>`).join('')}
      ${p.errors.map((w) => `<div style="color:#fca5a5;margin-top:4px;">✕ ${esc(w)}</div>`).join('')}
    </div>`;

  const openOperation = (a, action) => {
    const title = { PROMOTE: 'Promover a Super Embaixador', DEMOTE: 'Despromover a Embaixador', TRANSFER: 'Transferir para outro Super Embaixador', DELETE: 'Eliminar (lógico)' }[action];
    const needsTarget = action === 'TRANSFER' || action === 'DEMOTE' || action === 'DELETE';
    const targetLabel = action === 'TRANSFER' ? 'Super Embaixador de destino *' : action === 'DEMOTE' ? 'Super Embaixador que recebe a rede (se tiver embaixadores)' : 'Destino dos vínculos (se existirem)';
    const m = modal(`${title}: ${a.name}`, `
      ${needsTarget ? lbl(targetLabel, `<select id="f-target" style="width:100%;margin-top:3px;">${action === 'DELETE' ? `<option value="">— nenhum —</option>${S.list.filter((x) => x.id !== a.id && x.status === 'ATIVO' && !x.deleted).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.is_super ? ' (Super)' : ''}</option>`).join('')}` : superOpts(a.id, '')}</select>`) : ''}
      ${action === 'PROMOTE' ? grid(lbl('Comissão pelas lojas da rede (%)', inp('f-ind', '', '0', 'number')) + lbl('Vigência desde', inp('f-from', '', new Date().toISOString().slice(0, 10), 'date'))) : ''}
      ${action === 'DEMOTE' ? lbl('Novo Super Embaixador responsável por ele (opcional)', `<select id="f-newparent" style="width:100%;margin-top:3px;">${superOpts(a.id, '')}</select>`) : ''}
      <div data-preview style="margin-top:10px;font-size:12px;color:#94a3b8;">A carregar consequências…</div>
      ${lbl('Motivo *', inp('f-reason'))}${errHtml}<button class="btn btn-primary" data-save style="margin-top:8px;" disabled>Confirmar</button>`, { wide: true });
    const setErr = errBox(m), saveBtn = m.querySelector('[data-save]'), pv = m.querySelector('[data-preview]');
    const refresh = async () => {
      saveBtn.disabled = true;
      try { const p = await db.adminPreviewAmbassadorChange(a.id, action, val(m, '#f-target') || null); pv.innerHTML = previewBlock(p); saveBtn.disabled = !p.can_proceed; }
      catch (e) { pv.innerHTML = `<span style="color:#fca5a5;">${esc(e.message)}</span>`; }
    };
    m.querySelector('#f-target')?.addEventListener('change', refresh);
    refresh();
    saveBtn.onclick = (ev) => {
      const reason = val(m, '#f-reason'); if (!reason) return setErr('Indique o motivo.');
      const t = val(m, '#f-target') || null;
      const calls = {
        PROMOTE: () => db.adminPromoteAmbassador(a.id, reason, Number(val(m, '#f-ind') || 0), val(m, '#f-from') || null),
        DEMOTE: () => db.adminDemoteAmbassador(a.id, reason, t, val(m, '#f-newparent') || null),
        TRANSFER: () => db.adminTransferAmbassador(a.id, t, reason),
        DELETE: () => db.adminSoftDeleteAmbassador(a.id, reason, t)
      };
      run(ev.target, calls[action], 'Operação concluída e auditada.', m, setErr);
    };
  };

  // ---------- transferir loja ----------
  const openStoreTransfer = async () => {
    const res = await db.requireClient().from('ambassador_referred_stores').select('id,name,ambassador_id').order('name');
    const stores = res.data || [];
    const m = modal('Transferir loja entre Embaixadores', `
      ${lbl('Loja *', `<select id="f-store" style="width:100%;margin-top:3px;"><option value="">— seleccione —</option>${stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(nameOf(s.ambassador_id))}</option>`).join('')}</select>`)}
      ${lbl('Embaixador de destino *', `<select id="f-target" style="width:100%;margin-top:3px;"><option value="">— seleccione —</option>${S.list.filter((x) => x.status === 'ATIVO' && !x.deleted).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.is_super ? ' (Super)' : ''}</option>`).join('')}</select>`)}
      <label style="font-size:12px;color:#cbd5e1;display:block;margin-top:8px;"><input type="checkbox" id="f-newrate" checked> Aplicar, para pagamentos futuros, a comissão do novo responsável</label>
      <div data-preview style="margin-top:10px;font-size:12px;color:#94a3b8;">Seleccione loja e destino para ver as consequências.</div>
      ${lbl('Motivo *', inp('f-reason'))}${errHtml}<button class="btn btn-primary" data-save style="margin-top:8px;" disabled>Confirmar transferência</button>`, { wide: true });
    const setErr = errBox(m), saveBtn = m.querySelector('[data-save]'), pv = m.querySelector('[data-preview]');
    const refresh = async () => {
      const s = val(m, '#f-store'), t = val(m, '#f-target'); saveBtn.disabled = true; if (!s || !t) return;
      try {
        const p = await db.adminPreviewStoreTransfer(s, t);
        pv.innerHTML = `<div class="card" style="font-size:12px;color:#cbd5e1;"><div>Loja: <b>${esc(p.store.name)}</b> (${Number(p.store.monthly_fee).toFixed(2)}/mês, comissão ${p.store.commission_rate}%)</div>
          <div>Origem: ${esc(p.from.name)} → Destino: ${esc(p.to?.name || '—')} ${p.to?.parent_id ? `(rede de ${esc(nameOf(p.to.parent_id))})` : ''}</div>
          <div>Pagamentos históricos: ${p.historical_payments} · comissão histórica ${Number(p.historical_commission).toFixed(2)} (fica com ${esc(p.from.name)})</div>
          ${p.warnings.map((w) => `<div style="color:#fbbf24;">⚠ ${esc(w)}</div>`).join('')}${p.errors.map((w) => `<div style="color:#fca5a5;">✕ ${esc(w)}</div>`).join('')}</div>`;
        saveBtn.disabled = !p.can_proceed;
      } catch (e) { pv.innerHTML = `<span style="color:#fca5a5;">${esc(e.message)}</span>`; }
    };
    m.querySelector('#f-store').onchange = refresh; m.querySelector('#f-target').onchange = refresh;
    saveBtn.onclick = (ev) => { const r = val(m, '#f-reason'); if (!r) return setErr('Indique o motivo.');
      run(ev.target, () => db.adminTransferStore(val(m, '#f-store'), val(m, '#f-target'), r, m.querySelector('#f-newrate').checked), 'Loja transferida.', m, setErr); };
  };

  // ---------- bloquear / desbloquear ----------
  const openBlock = (a) => {
    const blocking = a.status === 'ATIVO';
    const m = modal(`${blocking ? 'Bloquear' : 'Desbloquear'} ${a.name}`, `
      ${blocking ? lbl('Motivo (visível ao utilizador bloqueado) *', inp('f-reason')) : `<div style="font-size:12px;color:#cbd5e1;">Motivo actual: ${esc(a.block_reason || '—')}</div>${lbl('Motivo do desbloqueio', inp('f-reason'))}`}
      ${errHtml}<button class="btn btn-primary" data-save style="margin-top:8px;">Confirmar</button>`);
    const setErr = errBox(m);
    m.querySelector('[data-save]').onclick = (ev) => run(ev.target, () => db.adminBlockAmbassador(a.id, blocking ? 'BLOQUEADO' : 'ATIVO', val(m, '#f-reason')), blocking ? 'Bloqueado.' : 'Desbloqueado.', m, setErr);
  };

  // ---------- pacotes de mensalidade ----------
  const openPackages = async () => {
    const pk = (await db.listFeePackages()) || [];
    const m = modal('Pacotes de mensalidade', `
      <table class="data-table"><thead><tr><th>Nome</th><th>Mensalidade</th><th>Activo</th><th></th></tr></thead><tbody>
      ${pk.map((p) => `<tr data-id="${esc(p.id)}"><td><input class="pk-name" value="${esc(p.name)}"></td><td><input class="pk-fee" type="number" min="0" value="${esc(p.monthly_fee)}" style="width:110px;"></td>
        <td><input class="pk-active" type="checkbox" ${p.active ? 'checked' : ''}></td><td><button class="btn btn-secondary pk-save" style="padding:2px 8px;">Guardar</button></td></tr>`).join('')}
      <tr data-id=""><td><input class="pk-name" placeholder="Novo pacote"></td><td><input class="pk-fee" type="number" min="0" style="width:110px;"></td><td><input class="pk-active" type="checkbox" checked></td><td><button class="btn btn-primary pk-save" style="padding:2px 8px;">Adicionar</button></td></tr>
      </tbody></table>${errHtml}`);
    const setErr = errBox(m);
    m.querySelectorAll('.pk-save').forEach((b) => { b.onclick = async () => {
      const tr = b.closest('tr');
      try { await db.adminSaveFeePackage(tr.dataset.id || null, tr.querySelector('.pk-name').value, Number(tr.querySelector('.pk-fee').value), tr.querySelector('.pk-active').checked); showToast('Pacote guardado.', 'success'); m.remove(); openPackages(); }
      catch (e) { setErr(e.message); } }; });
  };

  // ---------- auditoria ----------
  const openAudit = async (a) => {
    const m = modal(a ? `Auditoria — ${a.name}` : 'Auditoria global', '<div style="color:#94a3b8;font-size:12px;">A carregar…</div>', { wide: true });
    try {
      const rows = (await db.adminAmbassadorAudit(a ? a.id : null)) || [];
      m.querySelector('[data-body]').innerHTML = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Data</th><th>Acção</th><th>Embaixador</th><th>Motivo</th><th>Detalhes</th></tr></thead><tbody>
        ${rows.length ? rows.map((r) => `<tr><td>${fdt(r.created_at)}</td><td>${esc(ACTION_LABEL[r.action] || r.action)}</td><td>${esc(nameOf(r.ambassador_id))}</td><td>${esc(r.reason || '')}</td>
        <td style="font-size:10px;max-width:320px;word-break:break-all;">${esc(JSON.stringify(r.details || {}))}</td></tr>`).join('') : '<tr><td colspan="5">Sem registos.</td></tr>'}</tbody></table></div>`;
    } catch (e) { m.querySelector('[data-body]').innerHTML = `<span style="color:#fca5a5;">${esc(e.message)}</span>`; }
  };

  // ---------- lista ----------
  const area = (a) => [a.geo_neighborhood, a.geo_city, a.geo_district, a.geo_province, a.geo_country].filter(Boolean).join(', ') || '—';
  const draw = () => {
    const q = normalizeText(S.q), g = normalizeText(S.geo);
    const rows = S.list.filter((a) => (!S.kind || (S.kind === 'S') === a.is_super) && (!S.status || a.status === S.status)
      && (!q || normalizeText(`${a.name} ${a.phone} ${a.referral_code} ${nameOf(a.parent_ambassador_id)}`).includes(q)) && (!g || normalizeText(area(a)).includes(g)));
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;">
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div><div style="font-size:11px;font-weight:800;color:#ea580c;text-transform:uppercase;">Governança de redes</div>
        <h2 style="margin:2px 0 0;font-size:18px;color:#f8fafc;">Perfis, promoções e transferências</h2></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary" id="gp-back">Voltar</button><button class="btn btn-secondary" id="gp-audit">Auditoria</button>
          <button class="btn btn-secondary" id="gp-pk">Pacotes de mensalidade</button><button class="btn btn-secondary" id="gp-tstore">Transferir loja</button>
          <button class="btn btn-primary" id="gp-new-amb">+ Embaixador</button><button class="btn btn-primary" id="gp-new-super">+ Super Embaixador</button></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="gp-q" type="search" placeholder="Pesquisar nome, telefone, código…" value="${esc(S.q)}" style="flex:1 1 200px;">
        <input id="gp-geo" type="search" placeholder="Filtrar por área (país, província, cidade…)" value="${esc(S.geo)}" style="flex:1 1 200px;">
        <select id="gp-kind"><option value="">Todos os perfis</option><option value="S" ${S.kind === 'S' ? 'selected' : ''}>Super Embaixadores</option><option value="E" ${S.kind === 'E' ? 'selected' : ''}>Embaixadores</option></select>
        <select id="gp-status"><option value="">Todos os estados</option>${['ATIVO', 'BLOQUEADO', 'DESATIVADO'].map((s) => `<option ${S.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="card" style="padding:0;overflow-x:auto;"><table class="data-table"><thead><tr><th>Nome</th><th>Perfil</th><th>Estado</th><th>Super responsável</th><th>Área</th><th>Idioma / Moeda</th><th>Comissão (dir. / rede)</th><th>Lojas</th><th>Acções</th></tr></thead><tbody>
      ${rows.length ? rows.map((a) => `<tr data-id="${esc(a.id)}"><td><b>${esc(a.name)}</b><div style="font-size:10px;color:#94a3b8;">${esc(a.phone)} · ${esc(a.referral_code)}${a.has_login ? '' : ' · sem login'}</div></td>
        <td>${a.is_super ? 'Super Embaixador' : 'Embaixador'}</td><td><span class="badge ${STATUS_BADGE[a.status] || 'badge-amber'}">${esc(a.status)}</span></td>
        <td>${a.parent_ambassador_id ? esc(nameOf(a.parent_ambassador_id)) : '—'}</td><td style="font-size:11px;">${esc(area(a))}</td>
        <td>${esc(a.language || '—')} / ${esc(a.currency || '—')}${a.language && a.currency ? '' : ' <span style="color:#fbbf24;">⚠ por definir</span>'}</td>
        <td>${a.commission_rate}%${a.is_super ? ` / ${a.indirect_commission_rate}%` : ''}</td><td>${a.stores}</td>
        <td style="white-space:nowrap;"><select class="gp-act" style="font-size:11px;"><option value="">Acção…</option><option value="edit">Editar / área / idioma</option><option value="rates">Comissões</option>
          ${a.is_super ? '<option value="demote">Despromover</option>' : '<option value="promote">Promover a Super</option><option value="transfer">Transferir de Super</option>'}
          <option value="block">${a.status === 'ATIVO' ? 'Bloquear' : 'Desbloquear'}</option><option value="audit">Auditoria</option><option value="delete">Eliminar (lógico)</option></select></td></tr>`).join('')
        : '<tr><td colspan="9" style="padding:16px;color:#94a3b8;">Sem resultados.</td></tr>'}</tbody></table></div></div>`;

    const $ = (s) => container.querySelector(s);
    $('#gp-back').onclick = () => onBack && onBack();
    $('#gp-new-amb').onclick = () => openCreate(false); $('#gp-new-super').onclick = () => openCreate(true);
    $('#gp-pk').onclick = openPackages; $('#gp-tstore').onclick = openStoreTransfer; $('#gp-audit').onclick = () => openAudit(null);
    const re = (id, key, ev = 'input') => { $(id).addEventListener(ev, (e) => { S[key] = e.target.value; const pos = e.target.selectionStart; draw(); const el = $(id); if (ev === 'input') { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* ignora */ } } }); };
    re('#gp-q', 'q'); re('#gp-geo', 'geo'); re('#gp-kind', 'kind', 'change'); re('#gp-status', 'status', 'change');
    container.querySelectorAll('.gp-act').forEach((sel) => { sel.onchange = () => {
      const a = S.list.find((x) => x.id === sel.closest('tr').dataset.id), v = sel.value; sel.value = '';
      ({ edit: () => openEdit(a), rates: () => openRates(a), promote: () => openOperation(a, 'PROMOTE'), demote: () => openOperation(a, 'DEMOTE'),
         transfer: () => openOperation(a, 'TRANSFER'), delete: () => openOperation(a, 'DELETE'), block: () => openBlock(a), audit: () => openAudit(a) })[v]?.();
    }; });
  };

  async function load() {
    container.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:#94a3b8;">A carregar perfis…</div>';
    try { S.list = (await db.adminListAmbassadors(false)) || []; draw(); }
    catch (err) {
      const missing = /could not find the function|schema cache|does not exist/i.test(err.message || '');
      container.innerHTML = `<div class="card" style="max-width:640px;margin:30px auto;padding:24px;text-align:center;border-color:#f59e0b;">
        <h3 style="color:#fde68a;">Não foi possível carregar os perfis</h3>
        <p style="font-size:12px;color:#cbd5e1;">${missing ? 'Falta executar <b>migracao_super_embaixadores_v7.sql</b> no Supabase (SQL Editor).' : esc(err.message)}</p>
        <button class="btn btn-primary" id="gp-retry">Tentar novamente</button> <button class="btn btn-secondary" id="gp-back2">Voltar</button></div>`;
      container.querySelector('#gp-retry').onclick = load; container.querySelector('#gp-back2').onclick = () => onBack && onBack();
    }
  }
  await load();
}
