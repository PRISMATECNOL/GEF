/**
 * GEF | CADASTRO DE PRODUTO — secção OPCIONAL «Loja virtual».
 * Permite, no próprio cadastro, escolher fotografias e preencher marca, modelo, descrição, etc., para não ter de
 * voltar ao produto depois. Tudo é opcional: sem preencher nada, o cadastro funciona exactamente como antes.
 *
 * Reutiliza as mesmas funções do servidor da janela «Loja virtual» do produto (migracao_loja_virtual_v10.sql):
 * fn_vstore_my_info, fn_product_image_add, fn_product_shop_save, e o mesmo envio/compressão de imagens.
 * O produto é gravado primeiro (db.saveProduct); só depois se enviam fotos e dados. Se esta 2.ª fase falhar,
 * o produto fica gravado e o utilizador é avisado (pode completar em «Loja virtual» do produto).
 */
import { db } from '../../js/core/database.js';
import { escapeHtml as esc } from '../../js/core/ambassador-view.js';
import { uploadProductImage, removeStoredImages, validateImageFile } from '../../js/core/image-utils.js';

const inp = 'width:100%;margin-top:3px;';
const lbl = (t, h) => `<label style="display:block;font-size:11px;font-weight:700;color:#cbd5e1;">${t}${h}</label>`;

export const emptyShopExtras = () => ({
  open: false, photos: [], published: true,
  brand: '', model: '', sale_unit: '', description: '', details: '', notes: ''
});

/** Informação da loja virtual (limite de fotos, loja). Devolve null se não estiver disponível (ex.: Super Admin, v10 não executada). */
export async function loadShopInfo() {
  try {
    const info = await db.rpcV7('fn_vstore_my_info');
    return info && info.store_id ? info : null;
  } catch (e) { return null; }
}

export function hasShopExtras(s) {
  return !!(s && (s.photos.length || s.brand.trim() || s.model.trim() || s.sale_unit.trim() || s.description.trim() || s.details.trim() || s.notes.trim() || s.published === false));
}

export function releaseShopExtras(s) { (s?.photos || []).forEach((p) => { try { URL.revokeObjectURL(p.url); } catch (e) { /* nada */ } }); }

export function shopExtrasHtml(s, info) {
  if (!info) {
    return `<div style="background:#1e293b;padding:10px;border-radius:8px;border:1px solid #334155;font-size:11px;color:#94a3b8;">
      🛒 <b>Loja virtual (opcional):</b> fotografias e descrição ficam disponíveis ao cadastrar dentro de uma loja com a loja virtual instalada.</div>`;
  }
  const MAX = info.max_images || 5;
  const photos = s.photos.map((p, i) => `
    <div style="border:1px solid ${i === 0 ? '#f97316' : '#334155'};border-radius:8px;padding:4px;background:#0f172a;">
      <img src="${esc(p.url)}" alt="" width="100" height="100" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px;">
      <div style="display:flex;gap:2px;margin-top:4px;align-items:center;">
        <span style="font-size:10px;color:#fbbf24;flex:1;">${i === 0 ? '★ Principal' : ''}</span>
        <button type="button" class="btn btn-secondary" data-sx-ph="left" data-i="${i}" style="padding:2px 6px;font-size:10px;" ${i === 0 ? 'disabled' : ''}>◀</button>
        <button type="button" class="btn btn-secondary" data-sx-ph="right" data-i="${i}" style="padding:2px 6px;font-size:10px;" ${i === s.photos.length - 1 ? 'disabled' : ''}>▶</button>
        <button type="button" class="btn btn-secondary" data-sx-ph="del" data-i="${i}" style="padding:2px 6px;font-size:10px;">🗑</button>
      </div></div>`).join('');
  return `
    <div style="background:#1e293b;border-radius:8px;border:1px solid #334155;">
      <button type="button" id="sx-toggle" style="width:100%;display:flex;justify-content:space-between;align-items:center;background:transparent;border:0;color:#ea580c;padding:10px 12px;cursor:pointer;font-size:10px;font-weight:700;text-transform:uppercase;">
        <span>🛒 Loja virtual — fotografias e informações (opcional)${hasShopExtras(s) ? ' ✓' : ''}</span><span>${s.open ? '▲' : '▼'}</span></button>
      <div id="sx-body" ${s.open ? '' : 'hidden'} style="padding:0 12px 12px;">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Preencha agora o que já tiver à mão; o resto pode ficar vazio e completar mais tarde em «Loja virtual» do produto. Nada aqui é obrigatório.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;">
          ${photos}
          ${s.photos.length < MAX ? `<label style="border:2px dashed #475569;border-radius:8px;display:grid;place-items:center;text-align:center;min-height:116px;cursor:pointer;color:#94a3b8;font-size:11px;padding:6px;">
            <span>＋ Adicionar fotografias<br>(${s.photos.length}/${MAX})</span><input type="file" id="sx-add" accept="image/jpeg,image/png,image/webp" multiple hidden></label>` : ''}
        </div>
        <div id="sx-status" style="font-size:11px;color:#94a3b8;margin:6px 0 10px;">Até ${MAX} fotografias (JPG, PNG ou WebP). A primeira é a principal; são reduzidas e comprimidas automaticamente.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:10px;">
          ${lbl('Marca', `<input data-sx="brand" maxlength="80" value="${esc(s.brand)}" style="${inp}">`)}
          ${lbl('Modelo', `<input data-sx="model" maxlength="80" value="${esc(s.model)}" style="${inp}">`)}
          ${lbl('Unidade de venda', `<input data-sx="sale_unit" maxlength="30" value="${esc(s.sale_unit)}" placeholder="Ex.: saco 50 kg" style="${inp}">`)}
        </div>
        ${lbl('Descrição', `<textarea data-sx="description" rows="3" maxlength="4000" style="${inp}">${esc(s.description)}</textarea>`)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px;">
          ${lbl('Detalhes técnicos', `<textarea data-sx="details" rows="3" maxlength="4000" style="${inp}">${esc(s.details)}</textarea>`)}
          ${lbl('Notas adicionais', `<textarea data-sx="notes" rows="3" maxlength="2000" style="${inp}">${esc(s.notes)}</textarea>`)}
        </div>
        <label style="display:block;font-size:12px;color:#f8fafc;margin-top:10px;"><input type="checkbox" id="sx-pub" ${s.published ? 'checked' : ''}> Publicar na loja virtual</label>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px;">Promoções, cores e destaque configuram-se depois no botão «Loja virtual» do produto.</div>
      </div>
    </div>`;
}

/** Liga os eventos da secção. `rerender` repinta a janela inteira (o estado `s` é preservado). */
export function bindShopExtras(root, s, info, { rerender, toast }) {
  if (!info) return;
  const MAX = info.max_images || 5;
  const status = (t, bad) => { const el = root.querySelector('#sx-status'); if (el) { el.textContent = t; el.style.color = bad ? '#fca5a5' : '#94a3b8'; } };

  root.querySelector('#sx-toggle').onclick = () => { s.open = !s.open; root.querySelector('#sx-body').hidden = !s.open; rerender(); };
  root.querySelectorAll('[data-sx]').forEach((el) => { el.oninput = () => { s[el.dataset.sx] = el.value; }; });
  const pub = root.querySelector('#sx-pub'); if (pub) pub.onchange = () => { s.published = pub.checked; };

  const add = root.querySelector('#sx-add');
  if (add) add.onchange = async () => {
    const errors = [];
    for (const file of Array.from(add.files)) {
      if (s.photos.length >= MAX) { errors.push(`Limite de ${MAX} fotografias atingido.`); break; }
      try { await validateImageFile(file); s.photos.push({ file, url: URL.createObjectURL(file) }); }
      catch (e) { errors.push(`${file.name}: ${e.message}`); }
    }
    s.open = true; rerender();
    if (errors.length) { toast(errors[0], 'error'); setTimeout(() => status(errors.join(' '), true), 0); }
  };

  root.querySelectorAll('[data-sx-ph]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.i), k = b.dataset.sxPh;
      if (k === 'del') { try { URL.revokeObjectURL(s.photos[i].url); } catch (e) { /* nada */ } s.photos.splice(i, 1); }
      if (k === 'left' && i > 0) [s.photos[i - 1], s.photos[i]] = [s.photos[i], s.photos[i - 1]];
      if (k === 'right' && i < s.photos.length - 1) [s.photos[i + 1], s.photos[i]] = [s.photos[i], s.photos[i + 1]];
      rerender();
    };
  });
}

/**
 * Fase 2 (depois de o produto estar gravado): envia fotografias e grava os dados da loja virtual.
 * Devolve { ok, warnings[] }. Nunca lança: o produto já está gravado.
 */
export async function saveShopExtras(productId, s, info, onProgress) {
  const warnings = [];
  const client = db.requireClient();
  let uploaded = 0;
  for (let i = 0; i < s.photos.length; i++) {
    let up = null;
    try {
      onProgress && onProgress(`A enviar fotografia ${i + 1}/${s.photos.length}…`);
      up = await uploadProductImage(client, info.store_id, productId, s.photos[i].file);
      await db.rpcV7('fn_product_image_add', { p_product_id: productId, p_path: up.path, p_thumb: up.thumb, p_size: up.size });
      uploaded++;
    } catch (e) {
      if (up) await removeStoredImages(client, [up.path, up.thumb]).catch(() => {});
      warnings.push(`Fotografia ${i + 1} (${s.photos[i].file.name}): ${e.message}`);
    }
  }
  const text = (v) => (v || '').trim();
  const data = { published: s.published !== false };
  ['brand', 'model', 'sale_unit', 'description', 'details', 'notes'].forEach((k) => { if (text(s[k])) data[k] = text(s[k]); });
  try {
    onProgress && onProgress('A gravar informações da loja virtual…');
    await db.rpcV7('fn_product_shop_save', { p_product_id: productId, p_data: data, p_colors: null });
  } catch (e) { warnings.push(`Informações da loja virtual: ${e.message}`); }
  return { ok: warnings.length === 0, uploaded, warnings };
}
