/**
 * GEF | PRODUTO NA LOJA VIRTUAL (administração)
 * Publicação, detalhes comerciais, promoção com validade, destaque, fotografias (limite no servidor), cores e link partilhável.
 * Tudo é gravado por funções do servidor que validam loja, papel, limites e preços (migracao_loja_virtual_v10.sql).
 */
import { db } from '../../js/core/database.js';
import { showToast } from '../../js/components/toast.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { uploadProductImage, removeStoredImages, publicImageUrl } from '../../js/core/image-utils.js';
import { productUrl, bindShareButtons } from '../../js/components/share-link.js';
import { colorNameFromHex } from '../../js/core/color-names.js';

const inp = 'width:100%;margin-top:3px;';
const lbl = (t, h) => `<label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;">${t}${h}</label>`;
const grid = (h) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:10px;">${h}</div>`;
const title = (t) => `<div style="font-size:11px;font-weight:800;color:#ea580c;text-transform:uppercase;margin:14px 0 6px;">${t}</div>`;
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** Link do produto (só existe depois de a loja virtual ter endereço). */
export async function getProductLink(productId) {
  const info = await db.rpcV7('fn_vstore_my_info');
  return info && info.slug ? productUrl(info.slug, productId) : null;
}

export async function openProductShopModal(product, { onDone } = {}) {
  const client = db.requireClient();
  let info, data;
  try { [info, data] = await Promise.all([db.rpcV7('fn_vstore_my_info'), db.rpcV7('fn_product_shop_get', { p_product_id: product.id })]); }
  catch (e) { showToast(/could not find the function|schema cache/i.test(e.message) ? 'Falta executar migracao_loja_virtual_v10.sql no Supabase.' : e.message, 'error'); return; }

  const MAX = info.max_images || 5;
  let images = data.images || [];
  let colors = (data.colors || []).map((c) => ({ ...c }));
  const m = document.createElement('div');
  m.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
  document.body.appendChild(m);
  const $ = (s) => m.querySelector(s);

  const link = () => (info.slug ? productUrl(info.slug, data.id) : '');
  const photosHtml = () => `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;">
      ${images.map((im, i) => `<div style="border:1px solid ${im.main ? '#f97316' : '#334155'};border-radius:8px;padding:4px;background:#0f172a;">
        <img src="${esc(publicImageUrl(im.thumb || im.path))}" alt="" loading="lazy" decoding="async" width="100" height="100" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px;">
        <div style="display:flex;gap:2px;flex-wrap:wrap;margin-top:4px;">
          <button class="btn btn-secondary" data-ph="main" data-i="${i}" title="Definir como principal" style="padding:2px 5px;font-size:10px;">${im.main ? '★ Principal' : '☆'}</button>
          <button class="btn btn-secondary" data-ph="left" data-i="${i}" title="Mover para trás" style="padding:2px 6px;font-size:10px;" ${i === 0 ? 'disabled' : ''}>◀</button>
          <button class="btn btn-secondary" data-ph="right" data-i="${i}" title="Mover para a frente" style="padding:2px 6px;font-size:10px;" ${i === images.length - 1 ? 'disabled' : ''}>▶</button>
          <label class="btn btn-secondary" style="padding:2px 6px;font-size:10px;margin:0;cursor:pointer;" title="Substituir">↻<input type="file" accept="image/jpeg,image/png,image/webp" data-ph="replace" data-i="${i}" hidden></label>
          <button class="btn btn-secondary" data-ph="del" data-i="${i}" title="Remover" style="padding:2px 6px;font-size:10px;">🗑</button></div></div>`).join('')}
      ${images.length < MAX ? `<label style="border:2px dashed #475569;border-radius:8px;display:grid;place-items:center;text-align:center;min-height:132px;cursor:pointer;color:#94a3b8;font-size:11px;padding:6px;">
        <span>＋ Adicionar fotografias<br>(${images.length}/${MAX})</span><input type="file" id="ph-add" accept="image/jpeg,image/png,image/webp" multiple hidden></label>` : ''}
    </div><div id="ph-status" style="font-size:11px;color:#94a3b8;margin-top:6px;">Máximo ${MAX} fotografias. São reduzidas e comprimidas automaticamente.</div>`;

  const colorsHtml = () => colors.map((c, i) => `
    <div data-ci="${i}" style="display:grid;grid-template-columns:44px minmax(110px,1.4fr) minmax(80px,.7fr) minmax(110px,1fr) auto auto;gap:6px;align-items:end;margin-bottom:6px;">
      <label style="font-size:10px;color:#94a3b8;">Amostra<input type="color" data-c="hex" value="${esc(c.hex || '#cccccc')}" style="width:100%;height:34px;padding:0;margin-top:2px;"></label>
      <label style="font-size:10px;color:#94a3b8;">Nome da cor * <span style="color:#34d399;">(automático ao escolher a cor)</span><input data-c="name" value="${esc(c.name || '')}" maxlength="40" placeholder="Escolha a cor ao lado" style="${inp}"></label>
      <label style="font-size:10px;color:#94a3b8;">Stock (vazio = sem controlo)<input data-c="stock" type="number" min="0" step="1" value="${c.stock_qty ?? ''}" style="${inp}"></label>
      <label style="font-size:10px;color:#94a3b8;">Fotografia<select data-c="img" style="${inp}"><option value="">—</option>${images.map((im, k) => `<option value="${esc(im.id)}" ${c.image_id === im.id ? 'selected' : ''}>Foto ${k + 1}${im.main ? ' (principal)' : ''}</option>`).join('')}</select></label>
      <label style="font-size:11px;color:#cbd5e1;white-space:nowrap;"><input type="checkbox" data-c="av" ${c.available !== false ? 'checked' : ''}> Disponível</label>
      <button class="btn btn-secondary" data-c="del" style="padding:4px 8px;">✕</button></div>`).join('');

  const paintPhotos = () => { $('#photos').innerHTML = photosHtml(); wirePhotos(); paintColors(); };
  const paintColors = () => { $('#colors').innerHTML = colorsHtml(); wireColors(); };
  const readColors = () => { m.querySelectorAll('[data-ci]').forEach((row) => { const c = colors[Number(row.dataset.ci)]; if (!c) return;
    c.hex = row.querySelector('[data-c=hex]').value; c.name = row.querySelector('[data-c=name]').value; const st = row.querySelector('[data-c=stock]').value; c.stock_qty = st === '' ? null : Number(st);
    c.image_id = row.querySelector('[data-c=img]').value || null; c.available = row.querySelector('[data-c=av]').checked; }); };

  const setStatus = (t, bad) => { const s = $('#ph-status'); if (s) { s.textContent = t; s.style.color = bad ? '#fca5a5' : '#94a3b8'; } };
  const reload = async () => { const d = await db.rpcV7('fn_product_shop_get', { p_product_id: data.id }); images = d.images || []; };

  async function addFiles(files) {
    let lastError = '';
    for (const file of Array.from(files)) {
      if (images.length >= MAX) { setStatus(`Limite de ${MAX} fotografias atingido.`, true); break; }
      setStatus(`A processar ${file.name}…`);
      let up = null;
      try {
        up = await uploadProductImage(client, info.store_id, data.id, file);
        await db.rpcV7('fn_product_image_add', { p_product_id: data.id, p_path: up.path, p_thumb: up.thumb, p_size: up.size });
        await reload();
      } catch (e) { if (up) await removeStoredImages(client, [up.path, up.thumb]).catch(() => {}); lastError = e.message; setStatus(e.message, true); showToast(e.message, 'error'); }
    }
    readColors(); paintPhotos();
    if (lastError) setStatus(lastError, true); // o repaint repõe a mensagem por omissão: mantém o erro visível
  }

  function wirePhotos() {
    const add = $('#ph-add'); if (add) add.onchange = () => { addFiles(add.files); add.value = ''; };
    m.querySelectorAll('[data-ph]').forEach((el) => {
      const i = Number(el.dataset.i), im = images[i], kind = el.dataset.ph;
      const act = async (fn) => { try { await fn(); await reload(); readColors(); paintPhotos(); } catch (e) { showToast(e.message, 'error'); } };
      if (kind === 'replace') el.onchange = () => act(async () => {
        const up = await uploadProductImage(client, info.store_id, data.id, el.files[0]);
        try { const r = await db.rpcV7('fn_product_image_replace', { p_image_id: im.id, p_path: up.path, p_thumb: up.thumb, p_size: up.size }); await removeStoredImages(client, [r.old_path, r.old_thumb]); }
        catch (e) { await removeStoredImages(client, [up.path, up.thumb]).catch(() => {}); throw e; } });
      else el.onclick = () => act(async () => {
        if (kind === 'del') { if (!window.confirm('Remover esta fotografia?')) return; const r = await db.rpcV7('fn_product_image_delete', { p_image_id: im.id }); await removeStoredImages(client, [r.old_path, r.old_thumb]); return; }
        const ids = images.map((x) => x.id); let main = images.find((x) => x.main)?.id;
        if (kind === 'main') main = im.id;
        if (kind === 'left' && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
        if (kind === 'right' && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
        await db.rpcV7('fn_product_image_order', { p_product_id: data.id, p_ids: ids, p_main: main });
      });
    });
  }
  // Nome automático: ao escolher a cor, o sistema escreve o nome (ex.: "Azul-marinho"). O utilizador pode corrigir à mão.
  const uniqueColorName = (base, idx) => {
    if (!base) return '';
    const taken = new Set(colors.filter((_, k) => k !== idx).map((x) => (x.name || '').trim().toLowerCase()));
    let n = base, k = 2; while (taken.has(n.toLowerCase())) { n = `${base} ${k++}`; } return n;
  };
  function wireColors() {
    m.querySelectorAll('[data-ci]').forEach((row) => {
      const idx = Number(row.dataset.ci); const hexEl = row.querySelector('[data-c=hex]'); const nameEl = row.querySelector('[data-c=name]');
      hexEl.addEventListener('input', () => {
        const c = colors[idx]; if (!c) return;
        if (!(nameEl.value.trim() === '' || c.autoName)) return; // não apaga um nome escrito à mão
        c.name = uniqueColorName(colorNameFromHex(hexEl.value), idx); c.autoName = true; nameEl.value = c.name;
      });
      nameEl.addEventListener('input', () => { const c = colors[idx]; if (c) c.autoName = nameEl.value.trim() === ''; });
    });
    m.querySelectorAll('[data-ci] [data-c=del]').forEach((b) => { b.onclick = () => { readColors(); colors.splice(Number(b.closest('[data-ci]').dataset.ci), 1); paintColors(); }; });
  }

  m.innerHTML = `<div class="card" style="width:100%;max-width:900px;padding:18px;margin:auto;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;"><h3 style="margin:0;font-size:16px;color:#f8fafc;">Loja virtual — ${esc(data.name)}</h3><button class="btn btn-secondary" id="sp-close" style="padding:2px 10px;">✕</button></div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Preço de venda base: <b>${esc(data.sale_price)}</b> (nunca é alterado por promoções). Campos opcionais: preencha só o que quiser mostrar.</div>
    <div id="sp-link" style="margin-bottom:6px;"></div>
    ${title('Publicação')}
    ${grid(`<label style="font-size:12px;color:#f8fafc;"><input type="checkbox" id="sp-pub" ${data.published ? 'checked' : ''}> Publicar na loja virtual</label>
            <label style="font-size:12px;color:#f8fafc;"><input type="checkbox" id="sp-feat" ${data.featured ? 'checked' : ''}> Produto em destaque</label>
            ${lbl('Ordem do destaque (1 = primeiro)', `<input id="sp-fo" type="number" min="1" value="${data.featured_order ?? ''}" style="${inp}">`)}`)}
    ${!info.enabled ? '<div style="font-size:11px;color:#fbbf24;">A loja virtual está desactivada pelo Super Administrador: o produto fica pronto, mas só aparece quando for activada.</div>' : ''}
    ${title('Detalhes')}
    ${grid(lbl('Marca', `<input id="sp-brand" value="${esc(data.brand || '')}" style="${inp}">`) + lbl('Modelo', `<input id="sp-model" value="${esc(data.model || '')}" style="${inp}">`) + lbl('Unidade de venda (opcional)', `<input id="sp-unit" value="${esc(data.sale_unit || '')}" placeholder="Ex.: saco 50 kg" style="${inp}">`))}
    ${lbl('Descrição', `<textarea id="sp-desc" rows="3" maxlength="4000" style="${inp}">${esc(data.description || '')}</textarea>`)}
    ${grid(lbl('Detalhes técnicos', `<textarea id="sp-det" rows="3" maxlength="4000" style="${inp}">${esc(data.details || '')}</textarea>`) + lbl('Notas adicionais', `<textarea id="sp-notes" rows="3" maxlength="2000" style="${inp}">${esc(data.notes || '')}</textarea>`))}
    ${title('Promoção')}
    ${grid(lbl('Preço promocional', `<input id="sp-pp" type="number" min="0" step="0.01" value="${data.promo_price ?? ''}" style="${inp}">`) + lbl('Começa em', `<input id="sp-ps" type="datetime-local" value="${toLocal(data.promo_start)}" style="${inp}">`) + lbl('Termina em', `<input id="sp-pe" type="datetime-local" value="${toLocal(data.promo_end)}" style="${inp}">`) +
            `<label style="font-size:12px;color:#f8fafc;align-self:end;"><input type="checkbox" id="sp-pa" ${data.promo_active ? 'checked' : ''}> Promoção activa</label>`)}
    ${title(`Fotografias (até ${MAX})`)}<div id="photos"></div>
    ${title('Cores')}
    <label style="font-size:12px;color:#f8fafc;"><input type="checkbox" id="sp-hc" ${data.has_colors ? 'checked' : ''}> Este produto tem variações de cor</label>
    <div id="sp-colbox" ${data.has_colors ? '' : 'hidden'}><label style="font-size:12px;color:#cbd5e1;display:block;margin:6px 0;"><input type="checkbox" id="sp-cr" ${data.color_required !== false ? 'checked' : ''}> O cliente tem de escolher a cor para encomendar</label>
      <div id="colors"></div><button class="btn btn-secondary" id="sp-addcolor" style="padding:4px 10px;">＋ Adicionar cor</button>
      <div style="font-size:10px;color:#94a3b8;margin-top:4px;">As encomendas já feitas guardam a cor tal como foi pedida, mesmo que edite ou remova cores depois.</div></div>
    <div id="sp-err" style="display:none;color:#fca5a5;font-size:12px;margin:10px 0;"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;"><button class="btn btn-primary" id="sp-save">Guardar</button><button class="btn btn-secondary" id="sp-cancel">Fechar</button></div></div>`;

  const paintLink = () => {
    const u = link(); const box = $('#sp-link');
    box.innerHTML = u ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:6px 8px;">
        <span style="font-size:11px;color:#94a3b8;">Link do produto${data.published ? '' : ' (só funciona depois de publicado)'}:</span>
        <input readonly value="${esc(u)}" style="flex:1 1 220px;font-size:11px;" onfocus="this.select()">
        <button class="btn btn-secondary" data-copy-url="${esc(u)}" style="padding:3px 8px;">Copiar</button>
        <button class="btn btn-secondary" data-share-url="${esc(u)}" data-share-title="${esc(data.name)}" style="padding:3px 8px;">Partilhar</button></div>` : '<div style="font-size:11px;color:#94a3b8;">O link aparece quando a loja tiver endereço.</div>';
    bindShareButtons(box);
  };
  paintLink(); paintPhotos();

  const close = () => m.remove();
  $('#sp-close').onclick = close; $('#sp-cancel').onclick = close;
  $('#sp-hc').onchange = (e) => { $('#sp-colbox').hidden = !e.target.checked; };
  $('#sp-addcolor').onclick = () => { readColors(); if (colors.length >= 30) return; colors.push({ name: uniqueColorName(colorNameFromHex('#808080'), colors.length), autoName: true, hex: '#808080', available: true, stock_qty: null, image_id: null }); paintColors(); };

  $('#sp-save').onclick = async (ev) => {
    const err = $('#sp-err'); err.style.display = 'none';
    const fail = (t) => { err.textContent = t; err.style.display = 'block'; };
    readColors();
    const hasColors = $('#sp-hc').checked;
    const pp = $('#sp-pp').value;
    if (pp !== '' && Number(pp) >= Number(data.sale_price)) return fail('O preço promocional deve ser inferior ao preço de venda.');
    if ($('#sp-ps').value && $('#sp-pe').value && $('#sp-pe').value < $('#sp-ps').value) return fail('A promoção termina antes de começar.');
    if (hasColors) {
      const names = colors.map((c) => (c.name || '').trim().toLowerCase());
      if (names.some((n) => !n)) return fail('Cada cor precisa de um nome.');
      if (new Set(names).size !== names.length) return fail('Há nomes de cor repetidos.');
    }
    const payload = {
      published: $('#sp-pub').checked, featured: $('#sp-feat').checked, featured_order: $('#sp-fo').value || null,
      brand: $('#sp-brand').value, model: $('#sp-model').value, sale_unit: $('#sp-unit').value, description: $('#sp-desc').value, details: $('#sp-det').value, notes: $('#sp-notes').value,
      promo_price: pp === '' ? null : Number(pp), promo_start: toIso($('#sp-ps').value), promo_end: toIso($('#sp-pe').value), promo_active: $('#sp-pa').checked,
      has_colors: hasColors, color_required: $('#sp-cr').checked
    };
    ev.target.disabled = true;
    try {
      await db.rpcV7('fn_product_shop_save', { p_product_id: data.id, p_data: payload,
        p_colors: hasColors ? colors.map((c) => ({ id: c.id || null, name: c.name, hex: c.hex, available: c.available !== false, stock_qty: c.stock_qty, image_id: c.image_id })) : null });
      showToast('Produto da loja virtual guardado.', 'success'); data.published = payload.published; close(); onDone && onDone();
    } catch (e) { fail(e.message); ev.target.disabled = false; }
  };
  if (hasColorsInit()) paintColors();
  function hasColorsInit() { return !!data.has_colors; }
}
