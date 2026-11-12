/**
 * GEF | PROMOÇÕES E NOTIFICAÇÕES (separador da Loja virtual): criar, EDITAR, pré-visualizar, confirmar, enviar e acompanhar campanhas.
 * Canais: PWA (Web Push), WhatsApp Business Platform (Cloud API) e Email (função «send-email-campaign»). Equipa de Marketing & Vendas também pode criar e enviar. O envio é REAL e corre na Edge Function «send-campaign»
 * (credenciais só nos Secrets do Supabase). Só recebe quem autorizou o canal; o servidor volta a validar o consentimento ao enviar.
 */
import { showToast } from '../../js/components/toast.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { supabase } from '../../js/core/supabase.js';

const KINDS = [['all', 'Todos os que autorizaram'], ['frequent', 'Clientes frequentes (≥ N compras)'], ['inactive', 'Inativos (sem comprar há N dias)'], ['buyers', 'Já compraram'], ['never', 'Nunca compraram'], ['new', 'Novos (registados há ≤ N dias)']];
const ST = { QUEUED: ['badge-blue', 'Pronta a enviar'], SENDING: ['badge-amber', 'A enviar'], DONE: ['badge-emerald', 'Concluída'], CANCELLED: ['badge-red', 'Cancelada'] };
const CH = { PUSH: '🔔 PWA', WHATSAPP: '💬 WhatsApp', EMAIL: '✉️ Email' };
const fmt = (d) => (d ? new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const aud = (a) => { const k = (a && a.kind) || 'all'; const n = k === 'frequent' ? a.min_orders : a.days; return (KINDS.find((x) => x[0] === k) || KINDS[0])[1].replace('N', n ?? ''); };

export async function drawCampanhas(body, { rpc, friendly, canEdit, isAdmin, info, storeUrl, productUrl }) {
  let list = [];
  async function load() {
    try { list = await rpc('fn_campaign_list'); } catch (e) { body.innerHTML = `<div class="card" style="padding:16px;color:#fde68a;">${esc(/could not find|schema cache/i.test(e.message) ? 'Falta executar migracao_clientes_campanhas_v18.sql no Supabase.' : friendly(e))}</div>`; return; }
    draw();
  }
  function draw() {
    const rows = list.map((c) => `<tr><td>${esc(fmt(c.created_at))}</td><td>${CH[c.channel] || c.channel}</td><td><b>${esc(c.title)}</b><div style="color:#94a3b8;font-size:11px;">${esc(aud(c.audience))}</div></td>
      <td><span class="badge ${ST[c.status][0]}">${ST[c.status][1]}</span></td><td class="mono">${c.total}</td><td class="mono">${c.sent}</td><td class="mono">${c.channel === 'WHATSAPP' ? `${c.delivered} / ${c.read}` : '—'}</td>
      <td class="mono" style="color:${c.failed ? '#fca5a5' : 'inherit'}">${c.failed}</td><td class="mono">${c.skipped}</td><td class="mono">${c.pending}</td>
      <td style="white-space:nowrap;">${canEdit && c.status === 'QUEUED' ? `<button class="btn btn-primary" data-send="${esc(c.id)}" style="padding:2px 8px;font-size:11px;">Enviar</button> <button class="btn btn-secondary" data-edit="${esc(c.id)}" style="padding:2px 8px;font-size:11px;">Editar</button> ` : ''}
        ${canEdit && c.status === 'SENDING' ? `<button class="btn btn-primary" data-send="${esc(c.id)}" style="padding:2px 8px;font-size:11px;">Continuar envio</button> ` : ''}
        ${canEdit && (c.status === 'QUEUED' || c.status === 'SENDING') ? `<button class="btn btn-secondary" data-cancel="${esc(c.id)}" style="padding:2px 8px;font-size:11px;">Cancelar</button> ` : ''}
        <button class="btn btn-secondary" data-det="${esc(c.id)}" style="padding:2px 8px;font-size:11px;">Detalhes</button></td></tr>`).join('');
    body.innerHTML = `<div class="card" style="padding:16px;"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;"><h3 style="margin:0;font-size:15px;color:#f8fafc;">Promoções e notificações</h3>
      <span>${isAdmin ? '<button class="btn btn-secondary" id="cp-int">Integração WhatsApp</button> ' : ''}${canEdit ? '<button class="btn btn-primary" id="cp-new">+ Nova campanha</button>' : ''}</span></div>
      <div style="font-size:10px;color:#94a3b8;margin:6px 0 10px;">Só recebem clientes que autorizaram o canal (instalar a app não conta como autorização). Notificações PWA não têm recibo de entrega; WhatsApp mostra entregues/lidas.</div>
      <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Data</th><th>Canal</th><th>Campanha</th><th>Estado</th><th>Destinat.</th><th>Enviadas</th><th>Entreg./Lidas</th><th>Falhas</th><th>Ignor.</th><th>Pend.</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="11" style="padding:16px;color:#94a3b8;">Sem campanhas.</td></tr>'}</tbody></table></div></div>`;
    const $ = (s) => body.querySelector(s);
    if ($('#cp-new')) $('#cp-new').onclick = () => form(null);
    if ($('#cp-int')) $('#cp-int').onclick = integration;
    body.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => form(list.find((x) => x.id === b.dataset.edit)); });
    body.querySelectorAll('[data-send]').forEach((b) => { b.onclick = () => send(b.dataset.send, b); });
    body.querySelectorAll('[data-det]').forEach((b) => { b.onclick = () => details(list.find((x) => x.id === b.dataset.det)); });
    body.querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = async () => { if (!confirm('Cancelar esta campanha? As mensagens pendentes não serão enviadas.')) return; try { await rpc('fn_campaign_cancel', { p_id: b.dataset.cancel }); showToast('Campanha cancelada.', 'success'); load(); } catch (e) { showToast(friendly(e), 'error'); } }; });
  }

  async function send(id, btn) {
    const c = list.find((x) => x.id === id); if (!confirm(`Enviar «${c.title}» agora a ${c.pending || c.total} cliente(s) por ${{ PUSH: 'notificação PWA', WHATSAPP: 'WhatsApp', EMAIL: 'email' }[c.channel]}? Esta ação não pode ser anulada.`)) return;
    if (btn) { btn.disabled = true; btn.textContent = 'A enviar…'; }
    try {
      if (c.channel === 'PUSH') { const r = await rpc('fn_campaign_deliver_inapp', { p_id: id }); showToast(`Notificação entregue a ${r.sent} cliente(s).`, 'success'); load(); return; }
      for (let i = 0; i < 200; i++) {                                   // a função envia por lotes dentro de um limite de tempo; repete até acabar
        const { data, error } = await supabase.functions.invoke(c.channel === 'EMAIL' ? 'send-email-campaign' : 'send-campaign', { body: { campaign_id: id } });
        if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) { /* mantém */ } throw new Error(msg); }
        if (data && data.error) throw new Error(data.error);
        if (!data || !data.remaining) break;
      }
      showToast('Envio concluído. Veja os resultados na tabela.', 'success');
    } catch (e) { showToast(`Envio interrompido: ${e.message}`, 'error'); }
    load();
  }

  async function details(c) {
    const m = document.createElement('div'); m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    m.innerHTML = `<div class="card" style="padding:16px;max-width:720px;width:100%;margin:auto;"><div style="display:flex;justify-content:space-between;"><h3 style="margin:0;color:#f8fafc;">${esc(c.title)}</h3><button class="btn btn-secondary" data-x>✕</button></div>
      <p style="font-size:12px;color:#cbd5e1;">${esc(c.body)}${c.url ? `<br><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>` : ''}</p>
      <div style="font-size:12px;color:#94a3b8;">Destinatários ${c.total} · enviadas ${c.sent} · falhas ${c.failed} · ignoradas ${c.skipped} · pendentes ${c.pending}${c.channel === 'WHATSAPP' ? ` · entregues ${c.delivered} · lidas ${c.read}` : ''}</div>
      <div style="margin:8px 0;"><select id="dt-st"><option value="FAILED">Falhas</option><option value="SKIPPED">Ignoradas</option><option value="PENDING">Pendentes</option><option value="SENT">Enviadas</option><option value="READ">Lidas</option></select></div><div id="dt-l" style="overflow-x:auto;font-size:12px;color:#94a3b8;"></div></div>`;
    document.body.appendChild(m); m.querySelector('[data-x]').onclick = () => m.remove();
    const fill = async () => {
      const l = m.querySelector('#dt-l'); l.textContent = 'A carregar…';
      try { const r = await rpc('fn_campaign_recipients', { p_id: c.id, p_status: m.querySelector('#dt-st').value });
        l.innerHTML = r.length ? `<table class="data-table"><thead><tr><th>Cliente</th><th>Contacto</th><th>Estado</th><th>Erro / motivo</th></tr></thead><tbody>${r.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(c.channel === 'WHATSAPP' ? (x.whatsapp ? '+' + x.whatsapp : '') : x.email || '')}</td><td>${esc(x.status)}</td><td>${esc(x.error || '')}</td></tr>`).join('')}</tbody></table>` : 'Nenhum registo.'; }
      catch (e) { l.textContent = friendly(e); }
    };
    m.querySelector('#dt-st').onchange = fill; fill();
  }

  async function integration() {
    let cfg = {}; try { cfg = await rpc('fn_integration_get'); } catch (e) { return showToast(friendly(e), 'error'); }
    const m = document.createElement('div'); m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    m.innerHTML = `<div class="card" style="padding:16px;max-width:640px;width:100%;margin:auto;"><h3 style="margin:0 0 8px;color:#f8fafc;">Integração WhatsApp Business (API oficial)</h3>
      <div style="font-size:11px;color:#94a3b8;line-height:1.6;margin-bottom:10px;">1) Conta WhatsApp Business Platform (Meta) com número verificado. 2) Modelo de <b>marketing</b> aprovado pela Meta com <b>3 variáveis</b> no corpo: {{1}} nome do cliente, {{2}} mensagem, {{3}} link — e a frase «Responda PARAR para deixar de receber». 3) Token no Supabase (<code>supabase secrets set WHATSAPP_TOKEN=…</code>) — nunca aqui. 4) Cada conversa de marketing tem custo da Meta e o número tem limite diário por nível de qualidade.</div>
      <label style="font-size:11px;">Phone Number ID (Meta)<input id="in-pid" value="${esc(cfg.wa_phone_number_id || '')}" inputmode="numeric" style="width:100%;margin-top:3px;"></label>
      <label style="font-size:11px;">Nome do modelo aprovado<input id="in-tpl" value="${esc(cfg.wa_template_name || '')}" placeholder="promocao_loja" style="width:100%;margin-top:3px;"></label>
      <label style="font-size:11px;">Idioma do modelo<input id="in-lang" value="${esc(cfg.wa_template_lang || 'pt_PT')}" style="width:100%;margin-top:3px;"></label>
      <div id="in-err" style="color:#fca5a5;font-size:12px;min-height:16px;margin-top:6px;"></div><div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" data-x>Fechar</button><button class="btn btn-primary" id="in-save">Guardar</button></div></div>`;
    document.body.appendChild(m); m.querySelector('[data-x]').onclick = () => m.remove();
    m.querySelector('#in-save').onclick = async () => { try { await rpc('fn_integration_save', { p_phone_number_id: m.querySelector('#in-pid').value.trim(), p_template: m.querySelector('#in-tpl').value.trim(), p_lang: m.querySelector('#in-lang').value.trim() }); showToast('Integração guardada.', 'success'); m.remove(); } catch (e) { m.querySelector('#in-err').textContent = friendly(e); } };
  }

  async function form(edit) {
    let products = []; try { products = await rpc('fn_promo_products', { p_q: null, p_category: null }); } catch (e) { /* o link manual continua possível */ }
    const idem = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
    const a0 = (edit && edit.audience) || { kind: 'all' };
    const m = document.createElement('div'); m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    m.innerHTML = `<div class="card" style="padding:16px;max-width:760px;width:100%;margin:auto;"><h3 style="margin:0 0 10px;color:#f8fafc;">${edit ? 'Editar' : 'Nova'} campanha</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
        <label style="font-size:11px;">Canal<select id="cf-ch" ${edit ? 'disabled' : ''} style="width:100%;margin-top:3px;"><option value="PUSH">🔔 Notificação PWA</option><option value="WHATSAPP">💬 WhatsApp</option><option value="EMAIL">✉️ Email</option></select></label>
        <label style="font-size:11px;">Grupo de clientes<select id="cf-kind" style="width:100%;margin-top:3px;">${KINDS.map(([k, l]) => `<option value="${k}" ${a0.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label style="font-size:11px;" id="cf-nw">N (compras/dias)<input id="cf-n" type="number" min="1" value="${esc(a0.min_orders ?? a0.days ?? 90)}" style="width:100%;margin-top:3px;"></label>
        <label style="grid-column:1/-1;font-size:11px;">Título <span id="cf-tc" style="color:#94a3b8;"></span><input id="cf-title" maxlength="60" value="${esc(edit ? edit.title : '')}" placeholder="Ex.: Black Friday: até 30% de desconto" style="width:100%;margin-top:3px;"></label>
        <label style="grid-column:1/-1;font-size:11px;">Mensagem <span id="cf-bc" style="color:#94a3b8;"></span><textarea id="cf-body" rows="3" style="width:100%;margin-top:3px;" placeholder="Descontos, produtos em destaque, prazo da promoção…">${esc(edit ? edit.body : '')}</textarea></label>
        <label style="grid-column:1/-1;font-size:11px;">Link (https://…)<div style="display:flex;gap:6px;margin-top:3px;"><input id="cf-url" value="${esc(edit && edit.url || '')}" placeholder="https://…" style="flex:1;"><select id="cf-prod" style="max-width:220px;"><option value="">Produto…</option><option value="__store">Link da loja</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div></label></div>
      <div id="cf-prev" style="margin:12px 0;"></div><div id="cf-err" style="color:#fca5a5;font-size:12px;min-height:16px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;"><button class="btn btn-secondary" data-x>Fechar</button><button class="btn btn-secondary" id="cf-pv">Pré-visualizar</button><button class="btn btn-secondary" id="cf-save">Guardar</button><button class="btn btn-primary" id="cf-go">Guardar e enviar</button></div></div>`;
    document.body.appendChild(m); const $ = (s) => m.querySelector(s);
    if (edit) $('#cf-ch').value = edit.channel;
    const audience = () => { const k = $('#cf-kind').value, n = Math.max(1, Number($('#cf-n').value) || 1); return k === 'frequent' ? { kind: k, min_orders: n } : (k === 'inactive' || k === 'new') ? { kind: k, days: n } : { kind: k }; };
    const lim = () => ($('#cf-ch').value === 'PUSH' ? 240 : 500);
    const counters = () => { $('#cf-tc').textContent = `${$('#cf-title').value.length}/60`; $('#cf-bc').textContent = `${$('#cf-body').value.length}/${lim()}`; $('#cf-body').maxLength = lim(); $('#cf-nw').style.display = ['frequent', 'inactive', 'new'].includes($('#cf-kind').value) ? '' : 'none'; };
    ['#cf-title', '#cf-body', '#cf-kind', '#cf-ch'].forEach((s) => { $(s).oninput = counters; }); counters();
    $('#cf-prod').onchange = (e) => { const v = e.target.value; if (!v) return; $('#cf-url').value = v === '__store' ? storeUrl(info.slug) : productUrl(info.slug, v); e.target.value = ''; };
    m.querySelector('[data-x]').onclick = () => m.remove();
    async function preview() {
      const r = await rpc('fn_campaign_preview', { p_channel: $('#cf-ch').value, p_aud: audience() });
      const wa = $('#cf-ch').value === 'WHATSAPP';
      $('#cf-prev').innerHTML = `<div style="border:1px solid #334155;border-radius:10px;padding:10px;background:#0f172a;"><div style="font-size:11px;color:#94a3b8;">Pré-visualização ${wa ? '(o texto vai nas variáveis do modelo aprovado)' : 'da notificação'}</div>
        <div style="font-weight:800;color:#f8fafc;margin-top:4px;">${esc($('#cf-title').value || 'Título')}</div><div style="color:#cbd5e1;font-size:13px;">${esc($('#cf-body').value || 'Mensagem')}</div>${$('#cf-url').value ? `<div style="font-size:12px;color:#60a5fa;">${esc($('#cf-url').value)}</div>` : ''}</div>
        <div style="font-size:12px;color:#cbd5e1;margin-top:8px;">Receberão <b>${r.eligible}</b> cliente(s) (de ${r.with_consent} que autorizaram este canal, em ${r.accounts} contas). Limite por campanha: ${$('#cf-ch').value === 'PUSH' ? r.limits.max_push : r.limits.max_whatsapp}; ${r.limits.per_day} campanhas/dia.
        ${wa ? `<br>${r.wa_configured ? '' : '<b style="color:#fca5a5;">Integração WhatsApp por configurar.</b> '}Cada mensagem de marketing tem custo cobrado pela Meta e depende do modelo aprovado.` : ''}</div>`;
      return r;
    }
    $('#cf-pv').onclick = async () => { $('#cf-err').textContent = ''; try { await preview(); } catch (e) { $('#cf-err').textContent = friendly(e); } };
    async function save(thenSend) {
      const btns = m.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; }); $('#cf-err').textContent = '';
      try {
        const r = await preview(); if (!r.eligible) throw new Error('Nenhum cliente elegível: só recebem os que autorizaram este canal.');
        if (thenSend && !confirm(`Confirmar: enviar a ${r.eligible} cliente(s)?`)) { btns.forEach((b) => { b.disabled = false; }); return; }
        const p = { p_title: $('#cf-title').value, p_body: $('#cf-body').value, p_url: $('#cf-url').value, p_aud: audience() };
        const res = edit ? await rpc('fn_campaign_update', { p_id: edit.id, ...p }) : await rpc('fn_campaign_create', { p_channel: $('#cf-ch').value, ...p, p_idem: idem });
        showToast(res.duplicate ? 'Campanha já registada (sem duplicar).' : 'Campanha guardada.', 'success'); m.remove(); await load();
        if (thenSend) { const c = list.find((x) => x.id === res.id); if (c) send(c.id, null); }
      } catch (e) { $('#cf-err').textContent = friendly(e); btns.forEach((b) => { b.disabled = false; }); }
    }
    $('#cf-save').onclick = () => save(false); $('#cf-go').onclick = () => save(true);
  }
  await load();
}
