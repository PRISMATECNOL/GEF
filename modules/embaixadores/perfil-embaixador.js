/**
 * GEF | PAINEL DO EMBAIXADOR / SUPER EMBAIXADOR — extras da v7.
 * Perfil efectivo, bloqueio, idioma/moeda e contacto vêm de fn_ambassador_context() (servidor).
 * Super Embaixador: rede via fn_super_network(); cadastro de embaixadores via fn_super_create_ambassador().
 */
import { openStoreUserModal } from '../../js/components/store-user-modal.js';
import { attachTableSearch } from '../../js/components/table-search.js';
import { db } from '../../js/core/database.js';
import { i18n } from '../../js/core/i18n.js';
import { showToast } from '../../js/components/toast.js';
import { ADMIN_CONTACT } from '../../js/config.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';

const money = (v) => Number(v || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('pt-PT'); };
const waDigits = (p) => String(p || '').replace(/[^\d]/g, '');
const SUB = { ATIVA: ['badge-emerald', 'Activa'], EM_TESTE: ['badge-blue', 'Em teste'], EXPIRADA: ['badge-red', 'Expirada'], BLOQUEADA: ['badge-red', 'Bloqueada'], SEM_LOJA: ['badge-amber', 'Sem loja'] };

export async function loadContext() {
  try { return await db.ambassadorContext(); } catch (e) { console.warn('[GEF] contexto do embaixador:', e); return null; }
}

/** Idioma e moeda definidos pelo Super Administrador aplicam-se ao painel em cada sessão. */
export function applyContextPrefs(ctx) {
  if (!(ctx && ctx.ok && !ctx.blocked)) return;
  i18n.applyStorePrefs(ctx.currency || null, ctx.language || null);
  // Rótulo do menu lateral conforme o perfil efectivo (e dica para os próximos arranques).
  const label = ctx.is_super ? 'Painel do Super Embaixador' : 'Painel do Embaixador';
  try { window.localStorage.setItem('gef_amb_profile', ctx.profile || 'EMBAIXADOR'); } catch (e) { /* ignora */ }
  document.querySelectorAll('#nav-item-embaixadores span').forEach((el) => {
    if (/^\s*Painel do (Super )?Embaixador\s*$/.test(el.textContent)) el.textContent = label;
  });
}

/** Apaga os dados protegidos guardados no navegador (snapshot do painel). */
export function purgeLocalAmbassadorData() {
  try {
    Object.keys(window.localStorage).filter((k) => /amb|gef_.*snap/i.test(k) && !/language|currency/i.test(k)).forEach((k) => window.localStorage.removeItem(k));
  } catch (e) { /* ignora */ }
}

export function renderBlocked(container, reason) {
  container.innerHTML = `<div class="card" data-amb-root style="max-width:600px;margin:40px auto;text-align:center;padding:36px 24px;border-color:#ef4444;">
    <h2 style="font-size:18px;font-weight:800;color:#fca5a5;margin:0 0 8px;">Conta bloqueada</h2>
    ${reason ? `<p style="font-size:13px;color:#e2e8f0;margin:0 0 12px;">Motivo: ${esc(reason)}</p>` : ''}
    <p style="font-size:12px;color:#94a3b8;margin:0 0 12px;">Para esclarecer ou regularizar, contacte a administração:</p>
    <div style="font-size:13px;color:#f8fafc;font-weight:800;">${esc(ADMIN_CONTACT.name || '')}</div>
    <div style="font-size:12px;color:#cbd5e1;">${ADMIN_CONTACT.phone ? `📞 ${esc(ADMIN_CONTACT.phone)}` : ''}${ADMIN_CONTACT.email ? ` · ✉ ${esc(ADMIN_CONTACT.email)}` : ''}</div></div>`;
}

const contactCard = (c) => {
  if (!c) return `<div class="card"><div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Super Embaixador responsável</div>
    <div style="font-size:13px;color:#cbd5e1;margin-top:4px;">Sem Super Embaixador associado.</div></div>`;
  const wa = c.whatsapp || c.phone;
  return `<div class="card"><div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Super Embaixador responsável</div>
    <div style="font-size:15px;font-weight:800;color:#f8fafc;margin-top:4px;">${esc(c.name)}</div>
    <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">${c.phone ? `📞 ${esc(c.phone)}` : ''}${c.whatsapp ? ` · WhatsApp ${esc(c.whatsapp)}` : ''}</div>
    ${waDigits(wa) ? `<a class="btn btn-secondary" style="margin-top:8px;display:inline-block;" target="_blank" rel="noopener" href="https://wa.me/${waDigits(wa)}">Contactar no WhatsApp</a>` : ''}</div>`;
};

async function networkSection(slot) {
  slot.insertAdjacentHTML('beforeend', '<div class="card" data-net style="color:#94a3b8;font-size:12px;">A carregar a minha rede…</div>');
  const box = slot.querySelector('[data-net]');
  const draw = async () => {
    let n;
    try { n = await db.superNetwork(); } catch (e) { box.innerHTML = `<span style="color:#fca5a5;">${esc(e.message)}</span>`; return; }
    const ambs = n.ambassadors || [], stores = n.stores || [];
    box.style.color = ''; box.style.fontSize = '';
    box.innerHTML = `<h3 style="margin:0 0 10px;font-size:15px;color:#f8fafc;">A minha rede (Super Embaixador)</h3>
      <div class="metrics-grid">
        <div class="card"><div style="font-size:11px;color:#94a3b8;">Embaixadores</div><div style="font-size:20px;font-weight:900;color:#f8fafc;">${ambs.length}</div></div>
        <div class="card"><div style="font-size:11px;color:#94a3b8;">Lojas (directas + rede)</div><div style="font-size:20px;font-weight:900;color:#60a5fa;">${stores.length}</div></div>
        <div class="card"><div style="font-size:11px;color:#94a3b8;">Mensalidades recebidas</div><div style="font-size:20px;font-weight:900;color:#34d399;">${money(n.network_revenue)}</div></div>
        <div class="card"><div style="font-size:11px;color:#94a3b8;">Comissão directa / rede</div><div style="font-size:16px;font-weight:900;color:#f8fafc;">${money(n.commission_direct)} / ${money(n.commission_indirect)}</div></div>
        <div class="card"><div style="font-size:11px;color:#94a3b8;">Pendente / Paga</div><div style="font-size:16px;font-weight:900;color:#fbbf24;">${money(n.commission_pending)} / ${money(n.commission_paid)}</div></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px;"><b style="color:#f8fafc;font-size:13px;">Embaixadores da rede</b>
        <button class="btn btn-primary" data-new style="padding:4px 12px;">+ Embaixador</button></div>
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Nome</th><th>Contacto</th><th>Área</th><th>Estado</th><th>Lojas</th></tr></thead><tbody>
        ${ambs.length ? ambs.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.phone)}${a.whatsapp ? ` · WA ${esc(a.whatsapp)}` : ''}</td><td style="font-size:11px;">${esc(a.area || '—')}</td><td>${esc(a.status)}</td><td>${a.stores}</td></tr>`).join('') : '<tr><td colspan="5" style="color:#94a3b8;">Ainda sem embaixadores na rede.</td></tr>'}</tbody></table></div>
      <b style="display:block;margin:14px 0 6px;color:#f8fafc;font-size:13px;">Lojas e subscrições</b>
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Loja</th><th>Origem</th><th>Embaixador</th><th>Mensalidade</th><th>Subscrição</th><th>Estado</th><th></th></tr></thead><tbody>
        ${stores.length ? stores.map((s) => { const b = SUB[s.status] || SUB.SEM_LOJA; return `<tr><td>${esc(s.name)}<div style="font-size:10px;color:#94a3b8;">${esc(s.city || '')}</div></td><td>${esc(s.origin)}</td><td>${esc(s.ambassador_name)}</td>
          <td class="mono">${money(s.monthly_fee)}</td><td>${fdate(s.subscription_end)}</td><td><span class="badge ${b[0]}">${b[1]}</span></td><td><button class="btn btn-secondary" data-su="${esc(s.id)}" data-sn="${esc(s.name)}" style="padding:2px 8px;font-size:11px;">Utilizadores</button></td></tr>`; }).join('') : '<tr><td colspan="7" style="color:#94a3b8;">Sem lojas.</td></tr>'}</tbody></table></div>`;
    box.querySelectorAll('table.data-table').forEach((t, i) => attachTableSearch(t, { placeholder: i === 0 ? 'Pesquisar embaixador da rede…' : 'Pesquisar loja, embaixador, estado…' }));
    box.querySelector('[data-new]').onclick = openNew;
    box.querySelectorAll('[data-su]').forEach((b) => { b.onclick = () => openStoreUserModal({ storeId: b.dataset.su, storeName: b.dataset.sn }); });   // v25: loja da rede (âmbito validado no servidor)
  };
  const openNew = () => {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.8);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;';
    const f = (id, l, t = 'text') => `<label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;">${l}<input id="${id}" type="${t}" style="width:100%;margin-top:3px;"></label>`;
    m.innerHTML = `<div class="card" style="width:100%;max-width:560px;padding:20px;"><h3 style="margin:0 0 12px;color:#f8fafc;font-size:16px;">Novo Embaixador na minha rede</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">${f('n-name', 'Nome *')}${f('n-phone', 'Telefone *')}${f('n-wa', 'WhatsApp')}${f('n-email', 'Email de contacto', 'email')}${f('n-pix', 'Dados de pagamento')}${f('n-lemail', 'Telemóvel de acesso', 'tel')}${f('n-lpass', 'Senha inicial', 'password')}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:8px;">A comissão é definida pelo Super Administrador. O idioma e a moeda são herdados do seu perfil.</div>
      <div data-err style="display:none;color:#fca5a5;font-size:12px;margin:8px 0;"></div>
      <div style="display:flex;gap:8px;margin-top:10px;"><button class="btn btn-primary" data-save>Guardar</button><button class="btn btn-secondary" data-close>Cancelar</button></div></div>`;
    document.body.appendChild(m);
    const g = (id) => m.querySelector(id).value.trim();
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.querySelector('[data-save]').onclick = async (ev) => {
      const err = m.querySelector('[data-err]');
      if (!g('#n-name') || !g('#n-phone')) { err.textContent = 'Nome e telefone são obrigatórios.'; err.style.display = 'block'; return; }
      ev.target.disabled = true;
      try {
        await db.superCreateAmbassador({ p_name: g('#n-name'), p_phone: g('#n-phone'), p_whatsapp: g('#n-wa'), p_email: g('#n-email'), p_pix_mpesa: g('#n-pix'),
          p_login_email: g('#n-lemail') || null, p_login_password: m.querySelector('#n-lpass').value || null });
        showToast('Embaixador adicionado à sua rede.', 'success'); m.remove(); draw();
      } catch (e) { err.textContent = e.message; err.style.display = 'block'; ev.target.disabled = false; }
    };
  };
  await draw();
}

/** Acrescenta ao fim do painel: contacto do Super Embaixador (embaixador normal) ou a rede (Super Embaixador). */
export async function mountAmbassadorExtras(container, ctx) {
  container.querySelector('[data-amb-extras]')?.remove();
  if (!ctx || !ctx.ok || ctx.blocked) return;
  const slot = document.createElement('div');
  slot.setAttribute('data-amb-extras', '');
  slot.style.cssText = 'display:flex;flex-direction:column;gap:14px;margin-top:16px;';
  container.appendChild(slot);
  if (ctx.is_super) await networkSection(slot);
  else slot.insertAdjacentHTML('beforeend', contactCard(ctx.super_contact));
}
