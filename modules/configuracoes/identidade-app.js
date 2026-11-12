/**
 * GEF | CONFIGURAÇÕES → «Identidade da Aplicação» (nome, nome curto, logótipo, ícone, cores, pré-visualização)
 *
 * - Super Admin: escolhe qualquer loja e decide se o Administrador dessa loja pode editar.
 * - Administrador: só a sua loja, e só se o Super Admin não retirou essa autorização.
 * - Tudo é decidido e validado no servidor (fn_app_identity_get / fn_app_identity_save / fn_app_identity_set_admin_edit,
 *   migracao_identidade_pwa_v12.sql). Aqui só se valida a experiência (tipo/tamanho do ficheiro) e se geram os ícones PNG.
 * - Os ícones PNG (192, 512, maskable 512, Apple 180) são gerados NO NAVEGADOR a partir do logótipo/ícone carregado,
 *   sem deformar (a imagem é encaixada num quadrado) e enviados para o Storage em <loja>/identity/.
 */
import { db } from '../../js/core/database.js';
import { showToast } from '../../js/components/toast.js';
import { appIdentity } from '../../js/core/app-identity.js';
import { BUCKET, publicImageUrl, validateImageFile, decode, removeStoredImages } from '../../js/core/image-utils.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MAX_PNG = 1.9 * 1024 * 1024; // o bucket aceita 2 MB por ficheiro

const canvasBlob = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));

/** Desenha `src` encaixado (sem deformar) num quadrado `size`, com `scale` da área útil e fundo opcional. */
async function squarePng(src, size, { bg = null, scale = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  const k = Math.min((size * scale) / src.width, (size * scale) / src.height);
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  ctx.drawImage(src, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  const blob = await canvasBlob(c);
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return blob;
}

/** Gera todas as imagens necessárias. `logoFile` serve de logótipo (cabeçalho); `iconFile` (opcional) serve de base aos ícones. */
export async function buildIdentityImages(logoFile, iconFile, bg) {
  const out = {};
  const logoSrc = logoFile ? await (async () => { await validateImageFile(logoFile); return decode(logoFile); })() : null;
  const iconSrc = iconFile ? await (async () => { await validateImageFile(iconFile); return decode(iconFile); })() : logoSrc;
  if (!iconSrc) return out;
  if (Math.min(iconSrc.width, iconSrc.height) < 192) throw new Error('A imagem do ícone tem de ter pelo menos 192×192 px (recomendado 512×512).');
  if (logoSrc) {
    const k = Math.min(1, 256 / Math.max(logoSrc.width, logoSrc.height));
    // a miniatura do cabeçalho mantém a proporção e a transparência
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(logoSrc.width * k)); c.height = Math.max(1, Math.round(logoSrc.height * k));
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(logoSrc, 0, 0, c.width, c.height);
    out.logo = await canvasBlob(c);
  }
  out.icon192 = await squarePng(iconSrc, 192);
  out.icon512 = await squarePng(iconSrc, 512);
  out.maskable = await squarePng(iconSrc, 512, { bg, scale: 0.7 });  // zona segura: o sistema pode recortar em círculo
  out.apple = await squarePng(iconSrc, 180, { bg, scale: 0.86 });    // iOS pinta transparência de preto: fundo sólido
  for (const [k, b] of Object.entries(out)) if (b && b.size > MAX_PNG) throw new Error(`A imagem gerada (${k}) excede 2 MB. Use uma imagem mais simples ou mais pequena.`);
  return out;
}

export async function mountIdentityCard(root, { user }) {
  const role = String(user?.role || '').toUpperCase();
  const isSuper = role === 'SUPERADMIN';
  if (!isSuper && role !== 'ADMIN') { root.innerHTML = ''; return; }

  const client = db.requireClient();
  let storeId = isSuper ? null : undefined; // Super Admin escolhe; os outros: o servidor usa a loja do perfil
  let stores = [];
  let cur = null;                 // identidade guardada (resposta do servidor)
  const files = { logo: null, icon: null }; // ficheiros novos escolhidos
  const previewUrls = { logo: null, icon: null };

  const card = (inner) => `<div class="card"><h3 style="font-size:14px;font-weight:800;color:#f8fafc;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 18h.01"/></svg>
    Identidade da Aplicação (PWA)</h3>${inner}</div>`;

  async function load() {
    try {
      if (isSuper && !stores.length) stores = (await db.getStores()).filter((s) => s.id && s.id !== 'ALL');
      if (isSuper && !storeId) storeId = stores[0]?.id || null;
      cur = isSuper && !storeId ? null : await db.rpcV7('fn_app_identity_get', { p_store_id: isSuper ? storeId : null });
    } catch (e) {
      const missing = /could not find the function|schema cache|does not exist/i.test(e.message);
      root.innerHTML = card(`<div style="font-size:12px;color:#fca5a5;">${missing ? 'Falta executar <b>migracao_identidade_pwa_v12.sql</b> no Supabase (SQL Editor).' : esc(e.message)}</div>`);
      return false;
    }
    return true;
  }

  const revoke = () => { Object.keys(previewUrls).forEach((k) => { if (previewUrls[k]) { URL.revokeObjectURL(previewUrls[k]); previewUrls[k] = null; } }); };

  function paint() {
    const editable = !!cur && cur.can_edit && !!cur.store_id;
    const name = cur?.app_name || '';
    const short = cur?.short_name || '';
    const theme = cur?.theme_color || '#020617';
    const bgc = cur?.background_color || '#020617';
    const lock = 'disabled';
    const dis = editable ? '' : lock;

    root.innerHTML = card(`
      <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Nome, logótipo e ícone que a loja vê no cabeçalho, no convite de instalação e na aplicação instalada. Sem configuração usa-se o padrão GEF.</div>
      ${isSuper ? `<div style="margin-bottom:10px;"><label style="font-size:11px;font-weight:700;color:#cbd5e1;display:block;margin-bottom:4px;">Loja a configurar:</label>
        <select id="id-store" style="width:100%;max-width:360px;">${stores.map((s) => `<option value="${esc(s.id)}" ${s.id === storeId ? 'selected' : ''}>${esc(s.tradeName || s.name)}</option>`).join('')}</select>
        ${cur ? `<label style="display:block;font-size:12px;color:#f8fafc;margin-top:8px;"><input type="checkbox" id="id-admin-edit" ${cur.admin_can_edit ? 'checked' : ''}> Permitir que o Administrador desta loja altere a identidade</label>` : ''}</div>` : ''}
      ${!cur || !cur.store_id ? '<div style="font-size:12px;color:#fbbf24;">Seleccione uma loja.</div>'
        : !cur.can_edit ? '<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);border-radius:6px;padding:10px 14px;font-size:11px;color:#fca5a5;font-weight:700;">🔒 O Super Administrador não autorizou esta loja a alterar a identidade da aplicação. Pode apenas ver a actual.</div>' : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:10px;">
        <div style="display:flex;flex-direction:column;gap:10px;">
          <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Nome da aplicação (até 40)
            <input id="id-name" maxlength="40" value="${esc(name)}" placeholder="Ex.: Loja Silva" ${dis} style="width:100%;margin-top:3px;"></label>
          <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Nome curto (até 12, aparece sob o ícone)
            <input id="id-short" maxlength="12" value="${esc(short)}" placeholder="Ex.: Silva" ${dis} style="width:100%;margin-top:3px;"></label>
          <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Logótipo (cabeçalho e base dos ícones)
            <input id="id-logo" type="file" accept="image/jpeg,image/png,image/webp" ${dis} style="width:100%;margin-top:3px;"></label>
          <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Ícone (opcional, quadrado; se vazio usa-se o logótipo)
            <input id="id-icon" type="file" accept="image/jpeg,image/png,image/webp" ${dis} style="width:100%;margin-top:3px;"></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Cor da barra
              <input id="id-theme" type="color" value="${esc(theme)}" ${dis} style="width:100%;height:34px;padding:0;margin-top:3px;"></label>
            <label style="font-size:11px;font-weight:700;color:#cbd5e1;">Cor de fundo do ícone
              <input id="id-bg" type="color" value="${esc(bgc)}" ${dis} style="width:100%;height:34px;padding:0;margin-top:3px;"></label>
          </div>
          <div id="id-msg" style="font-size:11px;color:#94a3b8;">JPG, PNG ou WebP até 12 MB; mínimo 192×192 px (ideal 512×512). SVG não é aceite.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="id-save" ${dis}>Guardar identidade</button>
            <button class="btn btn-secondary" id="id-reset" ${dis}>Repor padrão GEF</button>
          </div>
        </div>
        <div id="id-preview"></div>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-top:12px;line-height:1.5;">
        ℹ️ Quem já instalou a aplicação não vê o novo nome/ícone automaticamente: no <b>Android</b> o sistema actualiza-o sozinho ao fim de algum tempo;
        no <b>iPhone/iPad</b> é preciso remover o ícone do ecrã principal e voltar a «Adicionar ao ecrã principal»; em <b>computador</b> reinstale a aplicação.</div>`);
    wire();
    paintPreview();
  }

  const previewSrc = (kind, fallback) => previewUrls[kind] || fallback || '';

  function paintPreview() {
    const box = root.querySelector('#id-preview'); if (!box) return;
    const name = (root.querySelector('#id-name')?.value || '').trim() || cur?.store_name || 'Nome da loja';
    const short = (root.querySelector('#id-short')?.value || '').trim() || name.slice(0, 12);
    const theme = root.querySelector('#id-theme')?.value || '#020617';
    const bg = root.querySelector('#id-bg')?.value || '#020617';
    const stored = (p) => (p ? publicImageUrl(p) : '');
    const logo = previewSrc('logo', stored(cur?.logo_path) || stored(cur?.icon_192_path));
    const icon = previewSrc('icon', '') || previewSrc('logo', stored(cur?.icon_512_path) || stored(cur?.logo_path));
    const iconUrl = icon || 'assets/icons/pwa-192x192.png';
    const logoUrl = logo || 'assets/icons/icon.svg';
    box.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#cbd5e1;margin-bottom:6px;">Pré-visualização</div>
      <div style="background:${esc(theme)};border:1px solid #334155;border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <img src="${esc(logoUrl)}" alt="" style="height:32px;width:32px;object-fit:contain;border-radius:6px;">
        <div style="min-width:0;"><div style="font-weight:900;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Cabeçalho</div></div></div>
      <div style="display:flex;gap:16px;align-items:flex-end;margin-bottom:10px;">
        <div style="text-align:center;width:72px;"><div style="width:60px;height:60px;border-radius:14px;background:${esc(bg)};display:grid;place-items:center;margin:0 auto;overflow:hidden;">
          <img src="${esc(iconUrl)}" alt="" style="width:100%;height:100%;object-fit:contain;"></div>
          <div style="font-size:10px;color:#e2e8f0;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(short)}</div></div>
        <div style="text-align:center;width:72px;"><div style="width:60px;height:60px;border-radius:50%;background:${esc(bg)};display:grid;place-items:center;margin:0 auto;overflow:hidden;">
          <img src="${esc(iconUrl)}" alt="" style="width:70%;height:70%;object-fit:contain;"></div>
          <div style="font-size:10px;color:#94a3b8;margin-top:4px;">Android (círculo)</div></div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:center;">
        <img src="${esc(iconUrl)}" alt="" style="width:40px;height:40px;border-radius:9px;object-fit:contain;background:#0f172a;">
        <div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:12px;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
        <div style="font-size:10px;color:#94a3b8;">Convite de instalação</div></div>
        <span style="background:#ea580c;color:#fff;border-radius:8px;padding:5px 9px;font-size:10px;font-weight:700;">Instalar aplicação</span></div>`;
  }

  function wire() {
    const q = (s) => root.querySelector(s);
    const msg = (t, bad) => { const m = q('#id-msg'); if (m) { m.textContent = t; m.style.color = bad ? '#fca5a5' : '#94a3b8'; } };

    const sel = q('#id-store');
    if (sel) sel.onchange = async () => { storeId = sel.value; files.logo = files.icon = null; revoke(); if (await load()) paint(); };

    const adm = q('#id-admin-edit');
    if (adm) adm.onchange = async () => {
      try { await db.rpcV7('fn_app_identity_set_admin_edit', { p_store_id: storeId, p_allowed: adm.checked }); showToast(adm.checked ? 'O Administrador da loja pode editar a identidade.' : 'O Administrador da loja deixou de poder editar a identidade.', 'success'); }
      catch (e) { adm.checked = !adm.checked; showToast(e.message, 'error'); }
    };

    ['#id-name', '#id-short', '#id-theme', '#id-bg'].forEach((s) => { const el = q(s); if (el) el.addEventListener('input', paintPreview); });

    ['logo', 'icon'].forEach((kind) => {
      const el = q('#id-' + kind); if (!el) return;
      el.onchange = async () => {
        const f = el.files[0]; if (!f) return;
        try {
          await validateImageFile(f);
          const bmp = await decode(f);
          if (kind === 'icon' && Math.min(bmp.width, bmp.height) < 192) throw new Error('O ícone tem de ter pelo menos 192×192 px.');
          if (kind === 'logo' && Math.min(bmp.width, bmp.height) < 192 && !files.icon) throw new Error('O logótipo tem de ter pelo menos 192×192 px (ou carregue também um ícone maior).');
          if (bmp.close) bmp.close();
          if (previewUrls[kind]) URL.revokeObjectURL(previewUrls[kind]);
          files[kind] = f; previewUrls[kind] = URL.createObjectURL(f);
          msg(`${kind === 'logo' ? 'Logótipo' : 'Ícone'} seleccionado: ${f.name}`);
        } catch (e) { el.value = ''; files[kind] = null; msg(e.message, true); showToast(e.message, 'error'); }
        paintPreview();
      };
    });

    const save = q('#id-save');
    if (save) save.onclick = async () => {
      const name = q('#id-name').value.trim(), short = q('#id-short').value.trim();
      const theme = q('#id-theme').value, bg = q('#id-bg').value;
      if (!name || name.length > 40) return msg('Indique o nome da aplicação (até 40 caracteres).', true);
      if (!short || short.length > 12) return msg('Indique o nome curto (até 12 caracteres).', true);
      if (!HEX.test(theme) || !HEX.test(bg)) return msg('Cor inválida.', true);
      const hasNewImage = !!(files.logo || files.icon);
      if (!hasNewImage && !(cur?.icon_192_path && cur?.icon_512_path)) return msg('Carregue um logótipo ou um ícone.', true);

      save.disabled = true; msg('A processar imagens…');
      const uploaded = [];
      try {
        const paths = {
          logo_path: cur?.logo_path || null, icon_192_path: cur?.icon_192_path || null, icon_512_path: cur?.icon_512_path || null,
          icon_maskable_path: cur?.icon_maskable_path || null, apple_icon_path: cur?.apple_icon_path || null
        };
        // Sem imagem nova mas cor de fundo alterada: o maskable/Apple têm a cor «cozida»; pede-se imagem nova para os regenerar.
        const bgChanged = cur && (cur.background_color || '#020617').toLowerCase() !== bg.toLowerCase();
        if (!hasNewImage && bgChanged && (cur.icon_maskable_path || cur.apple_icon_path)) {
          save.disabled = false;
          return msg('Para mudar a cor de fundo do ícone, volte a seleccionar o logótipo/ícone (os ícones são gerados com essa cor).', true);
        }
        if (hasNewImage) {
          const imgs = await buildIdentityImages(files.logo, files.icon, bg);
          if (!imgs.icon192) throw new Error('Carregue um logótipo ou um ícone.');
          const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
          const sid = cur.store_id;
          const up = async (kind, blob) => {
            if (!blob) return null;
            const path = `${sid}/identity/${id}_${kind}.png`;
            msg(`A enviar ${kind}…`);
            const r = await client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
            if (r.error) throw new Error(r.error.message || 'Falha no envio da imagem.');
            uploaded.push(path); return path;
          };
          if (imgs.logo) paths.logo_path = await up('logo', imgs.logo);
          paths.icon_192_path = await up('icon192', imgs.icon192);
          paths.icon_512_path = await up('icon512', imgs.icon512);
          paths.icon_maskable_path = await up('maskable', imgs.maskable);
          paths.apple_icon_path = await up('apple', imgs.apple);
        }
        msg('A guardar…');
        const res = await db.rpcV7('fn_app_identity_save', { p_store_id: isSuper ? cur.store_id : null,
          p_data: { app_name: name, short_name: short, theme_color: theme, background_color: bg, ...paths } });
        if (res?.old_paths?.length) await removeStoredImages(client, res.old_paths).catch(() => {});
        showToast('Identidade da aplicação guardada.', 'success');
        files.logo = files.icon = null; revoke();
        if (!(await load())) return;
        paint();
        if (!isSuper || cur.store_id === user.storeId) appIdentity.refresh(); // actualiza já o cabeçalho e o manifesto
      } catch (e) {
        if (uploaded.length) await removeStoredImages(client, uploaded).catch(() => {}); // não deixa ficheiros órfãos
        msg(e.message, true); showToast(e.message, 'error'); save.disabled = false;
      }
    };

    const reset = q('#id-reset');
    if (reset) reset.onclick = async () => {
      if (!window.confirm('Repor o nome e o ícone padrão do GEF para esta loja?')) return;
      try {
        const res = await db.rpcV7('fn_app_identity_save', { p_store_id: isSuper ? cur.store_id : null, p_data: { reset: true } });
        if (res?.old_paths?.length) await removeStoredImages(client, res.old_paths).catch(() => {});
        showToast('Identidade reposta para o padrão GEF.', 'success');
        files.logo = files.icon = null; revoke();
        if (await load()) paint();
        if (!isSuper) appIdentity.refresh();
      } catch (e) { showToast(e.message, 'error'); }
    };
  }

  if (await load()) paint();
}
