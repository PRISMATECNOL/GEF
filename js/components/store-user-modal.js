/**
 * GEF/PRUMO v25 — criar utilizador de uma loja (SUPER ADMIN, SUPER EMBAIXADOR, EMBAIXADOR) pela Edge Function create-store-user.
 * O servidor valida o âmbito (lojas permitidas a quem cria) e o perfil; aqui só se apresenta o formulário.
 */
import { db } from '../core/database.js';
import { showToast } from './toast.js';

const ROLE_OPTS = [['ADMIN', 'Admin da loja'], ['GERENTE', 'Gerente'], ['CASHIER', 'Caixa (CASHIER)'], ['ESTOQUISTA', 'Estoquista'], ['LOGISTA', 'Logista (Logística)'], ['MARKETING', 'Marketing & Vendas']];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function openStoreUserModal({ storeId, storeName, onDone }) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML = `<div class="card" style="width:100%;max-width:460px;max-height:92vh;overflow:auto;">
    <h3 style="margin:0 0 4px;font-size:15px;color:#f8fafc;">Novo utilizador · ${esc(storeName || '')}</h3>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Só pode criar perfis internos desta loja, dentro do seu âmbito. O acesso é com telemóvel (ou email) e palavra-passe.</div>
    <div style="display:grid;gap:8px;">
      <div><label style="font-size:11px;font-weight:700;color:#cbd5e1;">Nome completo *</label><input id="su-name" style="width:100%;" autocomplete="off"></div>
      <div><label style="font-size:11px;font-weight:700;color:#cbd5e1;">Telemóvel de acesso *</label><input id="su-login" type="tel" inputmode="tel" style="width:100%;" autocomplete="off"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><label style="font-size:11px;font-weight:700;color:#cbd5e1;">Palavra-passe * (mín. 8)</label><input id="su-pass" type="text" style="width:100%;" autocomplete="off"></div>
        <div><label style="font-size:11px;font-weight:700;color:#cbd5e1;">Perfil *</label><select id="su-role" style="width:100%;">${ROLE_OPTS.map(([v, l]) => `<option value="${v}" ${v === 'CASHIER' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div><label style="font-size:11px;font-weight:700;color:#cbd5e1;">Email de contacto (opcional)</label><input id="su-mail" type="email" style="width:100%;" autocomplete="off"></div>
      <div id="su-err" style="display:none;font-size:11px;color:#fca5a5;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" id="su-save">Criar utilizador</button></div>
    </div></div>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  const err = (t) => { const e = $('#su-err'); e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; };
  ov.querySelector('[data-close]').onclick = () => ov.remove();
  $('#su-save').onclick = async (ev) => {
    const fullName = $('#su-name').value.trim(), login = $('#su-login').value.trim(), password = $('#su-pass').value, role = $('#su-role').value, contactEmail = $('#su-mail').value.trim();
    if (fullName.length < 2 || !login || password.length < 8) { err('Preencha o nome, o telemóvel e uma palavra-passe de pelo menos 8 caracteres.'); return; }
    ev.target.disabled = true; err('');
    try {
      await db.createStoreUserSecure({ storeId, role, fullName, login, password, contactEmail });
      showToast(`Utilizador criado (${ROLE_OPTS.find((r) => r[0] === role)?.[1] || role}).`, 'success');
      ov.remove(); onDone && onDone();
    } catch (e) {
      const missing = /Failed to send|FunctionsFetch|not found|404/i.test(e.message);
      err(missing ? 'Função create-store-user não disponível. Faça o deploy da Edge Function (ver LEIA-ME v25).' : e.message);
      ev.target.disabled = false;
    }
  };
  return ov;
}
