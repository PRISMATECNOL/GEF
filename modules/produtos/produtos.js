/**
 * GEF - GESTÃO FINANCEIRA | CATÁLOGO DE PRODUTOS
 * JavaScript Puro (Vanilla JS)
 */

import { db } from '../../js/core/database.js';
import { auth } from '../../js/core/auth.js';
import { showToast } from '../../js/components/toast.js';
import { i18n } from '../../js/core/i18n.js';
import { openProductShopModal, getProductLink } from './loja-produto.js';
import { emptyShopExtras, loadShopInfo, hasShopExtras, releaseShopExtras, shopExtrasHtml, bindShopExtras, saveShopExtras } from './cadastro-loja.js';
import { shareLink } from '../../js/components/share-link.js';
import { loadSectorConfig, categoryNames, subcategoriesOf as sectorSubs, unitOptions, locationLabel, attributeDefs, attributeFieldHtml, readAttributes, businessTypeName } from '../../js/core/sector.js';
import { APP_VERSION } from '../../js/config.js';
const CUR = () => i18n.getCurrencyObj().symbol;

export async function initProdutosModule(container) {
  const storeId = db.getCurrentStoreId();
  const currentUser = auth.getCurrentUser();
  const isAdmin = currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'SUPERADMIN' || currentUser.role === 'MANAGER');
  let products = await db.getProducts(storeId);
  await loadSectorConfig();   // v25: categorias, unidades e atributos do tipo de negócio da loja (FERRAGENS = como sempre)
  let searchTerm = '';
  let categoryFilter = 'ALL';

  const DEFAULT_CATEGORIES = ['Cimento & Argamassa', 'Aço & Ferro', 'Tubagens & Hidráulica', 'Material Elétrico', 'Tintas & Impermeabilizantes', 'Ferramentas', 'Agregados & Areia'];
  // Categorias = as de sempre + as que já existem nos produtos (o utilizador pode criar novas ao cadastrar)
  const allCategories = () => categoryNames(products.map(p => (p.category || '').trim())).sort((a, b) => a.localeCompare(b, 'pt'));
  const subcategoriesOf = (cat) => [...new Set([...sectorSubs((cat || '').trim()), ...products.filter(p => (p.category || '').trim() === (cat || '').trim()).map(p => (p.subcategory || '').trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt'));
  const escAttr = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let categories = ['ALL'];
  const selected = new Set(); // produtos seleccionados para alocar a uma categoria

  const render = async () => {
    products = await db.getProducts(storeId);
    categories = ['ALL', ...allCategories()];

    const filtered = products.filter(p => {
      const matchSearch = !searchTerm || 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.code || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.subcategory || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.category || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.barcode || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = categoryFilter === 'ALL' || (p.category || '').trim() === categoryFilter;
      return matchSearch && matchCat;
    });

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Header Card -->
        <div class="card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 20px;">
          <div>
            <h2 style="font-size: 18px; font-weight: 800; color: #f8fafc; margin: 0;">Catálogo de Produtos & Conversões</h2>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
              Cadastro de produtos, múltiplos tipos de embalagem e unidades, alertas de mínimo e margens.
              <span style="color:#64748b;">· versão ${APP_VERSION}</span>
            </div>
          </div>
          ${isAdmin ? `
            <button class="btn btn-secondary" id="btn-manage-cats" title="Renomear categorias e subcategorias, juntar, mover produtos">🗂 Gerir categorias</button>
            <button class="btn btn-primary" id="btn-create-product">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12"/></svg>
              <span>Cadastrar Novo Material</span>
            </button>
          ` : ''}
        </div>

        <!-- Filters Bar Card -->
        <div class="card" style="padding: 12px 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
          <input 
            type="text" 
            id="input-prod-search" 
            placeholder="Buscar por nome, código interno ou código de barras..." 
            value="${searchTerm}"
            style="flex: 1; min-width: 200px; font-size: 12px;"
          >

          <select id="select-cat-filter" style="font-size: 12px;">
            ${categories.map(c => `
              <option value="${c}" ${categoryFilter === c ? 'selected' : ''}>
                ${c === 'ALL' ? 'Todas as Categorias' : c}
              </option>
            `).join('')}
          </select>

          <button class="btn btn-secondary" id="btn-prod-clear" style="padding: 6px 12px; font-size: 11px;">
            Limpar
          </button>
        </div>

        ${isAdmin ? `
        <div id="bulk-bar" class="card" ${selected.size ? '' : 'hidden'} style="padding: 12px 16px; display: ${selected.size ? 'flex' : 'none'}; gap: 10px; flex-wrap: wrap; align-items: end; border: 1px solid #f97316;">
          <div style="font-size: 12px; font-weight: 800; color: #f8fafc;"><span id="bulk-count">${selected.size}</span> produto(s) seleccionado(s) → mover para:</div>
          <label style="font-size: 10px; color: #94a3b8;">Categoria *<input id="bulk-cat" list="dl-bulk-cats" maxlength="60" autocomplete="off" placeholder="Escolha ou escreva" style="display:block;font-size:12px;"></label>
          <label style="font-size: 10px; color: #94a3b8;">Subcategoria (vazio = sem subcategoria)<input id="bulk-sub" list="dl-bulk-subs" maxlength="60" autocomplete="off" placeholder="Opcional" style="display:block;font-size:12px;"></label>
          <datalist id="dl-bulk-cats">${allCategories().map(c => `<option value="${escAttr(c)}"></option>`).join('')}</datalist>
          <datalist id="dl-bulk-subs"></datalist>
          <button class="btn btn-primary" id="bulk-apply" style="font-size: 12px;">Aplicar</button>
          <button class="btn btn-secondary" id="bulk-clear" style="font-size: 12px;">Limpar selecção</button>
        </div>` : ''}

        <!-- Products Table Card -->
        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  ${isAdmin ? `<th style="width:28px;"><input type="checkbox" id="chk-all" title="Seleccionar todos os listados" ${filtered.length && filtered.every(p => selected.has(p.id)) ? 'checked' : ''}></th>` : ''}
                  <th>Código</th>
                  <th>Material / Descrição</th>
                  <th>Categoria</th>
                  <th>Unidade</th>
                  <th>Estoque Atual</th>
                  ${isAdmin ? '<th>Preço Custo</th>' : ''}
                  <th>Preço Venda</th>
                  ${isAdmin ? '<th>Margem</th>' : ''}
                  ${isAdmin ? '<th title="Visível na loja virtual">Loja virtual</th>' : ''}
                  <th style="text-align: right;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.length === 0 ? `
                  <tr>
                    <td colspan="11" style="text-align: center; color: #64748b; padding: 32px;">
                      Nenhum produto cadastrado para esta visualização.
                    </td>
                  </tr>
                ` : filtered.map(p => {
                  const margin = p.salePriceBase > 0 ? ((p.salePriceBase - p.costPriceBase) / p.salePriceBase * 100).toFixed(1) : 0;
                  const isLow = p.currentStockBase <= p.minStockAlert && p.currentStockBase > 0;
                  const isOut = p.currentStockBase <= 0;
                  return `
                    <tr>
                      ${isAdmin ? `<td><input type="checkbox" class="chk-prod" data-prod-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''}></td>` : ''}
                      <td>
                        <span style="font-weight: 800; font-family: var(--font-mono); color: #f97316;">${p.code}</span>
                        ${p.barcode ? `<div style="font-size: 9px; color: #64748b;">${p.barcode}</div>` : ''}
                      </td>
                      <td>
                        <div style="font-weight: 700; color: #f8fafc;">${p.name}</div>
                        ${(p.conversions || []).length > 0 ? `
                          <div style="font-size: 10px; color: #94a3b8;">
                            Embalagens: ${(p.conversions || []).map(c => c.packagingName).join(', ')}
                          </div>
                        ` : ''}
                      </td>
                      <td>
                        <span class="badge badge-blue" style="font-size: 9px;">${p.category || 'Geral'}</span>${p.subcategory ? `<div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">↳ ${escAttr(p.subcategory)}</div>` : ''}
                      </td>
                      <td>
                        <strong style="color: #cbd5e1; font-family: var(--font-mono);">${p.baseUnit}</strong>
                      </td>
                      <td>
                        <span class="badge ${isOut ? 'badge-red' : isLow ? 'badge-amber' : 'badge-emerald'}" style="font-size: 10px;">
                          ${p.currentStockBase} ${p.baseUnit}
                        </span>
                        <div style="font-size: 9px; color: #64748b; margin-top: 2px;">
                          ${locationLabel('LOJA')}: ${p.stockByLocation?.LOJA || 0} | ${locationLabel('ARMAZEM')}: ${p.stockByLocation?.ARMAZEM || 0} | ${locationLabel('PATIO')}: ${p.stockByLocation?.PATIO || 0}
                        </div>
                      </td>
                      ${isAdmin ? `
                        <td style="font-family: var(--font-mono); color: #cbd5e1;">
                          ${p.costPriceBase.toFixed(2)} ${CUR()}
                        </td>
                      ` : ''}
                      <td style="font-family: var(--font-mono); font-weight: 800; color: #34d399;">
                        ${p.salePriceBase.toFixed(2)} ${CUR()}
                      </td>
                      ${isAdmin ? `
                        <td>
                          <span style="font-size: 11px; font-weight: bold; color: ${margin > 25 ? '#34d399' : '#f59e0b'};">
                            ${margin}%
                          </span>
                        </td>
                      ` : ''}
                      ${isAdmin ? `
                        <td>
                          <button class="btn btn-secondary btn-toggle-pub" data-prod-id="${p.id}" data-pub="${p.published ? '1' : '0'}"
                            style="padding: 4px 8px; font-size: 10px; font-weight: 800; color: ${p.published ? '#34d399' : '#94a3b8'};"
                            title="Clique para ${p.published ? 'esconder da' : 'mostrar na'} loja virtual">
                            ${p.published ? '● Visível' : '○ Oculto'}
                          </button>
                        </td>
                      ` : ''}
                      <td style="text-align: right;">
                        <div style="display: flex; gap: 4px; justify-content: flex-end;">
                          ${isAdmin ? `
                            <button class="btn btn-secondary btn-shop-prod" data-prod-id="${p.id}" style="padding: 4px 8px; font-size: 10px;" title="Fotografias, cores, promoção, publicação e link">Loja virtual</button>
                            <button class="btn btn-secondary btn-link-prod" data-prod-id="${p.id}" style="padding: 4px 6px; font-size: 10px;" title="Partilhar / copiar o link deste produto" aria-label="Partilhar link do produto">🔗</button>
                            <button class="btn btn-secondary btn-edit-prod" data-prod-id="${p.id}" style="padding: 4px 8px; font-size: 10px;">
                              Editar
                            </button>
                            <button class="btn btn-secondary btn-delete-prod" data-prod-id="${p.id}" style="padding: 4px 6px; font-size: 10px; color: #f87171;">
                              ✕
                            </button>
                          ` : `
                            <span style="font-size: 10px; color: #64748b;">Apenas leitura</span>
                          `}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Filter events
    const searchInp = container.querySelector('#input-prod-search');
    searchInp.oninput = (e) => {
      searchTerm = e.target.value;
      render();
      const ref = container.querySelector('#input-prod-search');
      if (ref) {
        ref.focus();
        ref.setSelectionRange(searchTerm.length, searchTerm.length);
      }
    };

    container.querySelector('#select-cat-filter').onchange = (e) => {
      categoryFilter = e.target.value;
      render();
    };

    container.querySelector('#btn-prod-clear').onclick = () => {
      searchTerm = '';
      categoryFilter = 'ALL';
      render();
    };

    // Create
    container.querySelector('#btn-create-product').onclick = () => {
      openProductModal(null, () => render());
    };

    // Partilhar / copiar o link directo do produto, sem sair da lista
    container.querySelectorAll('.btn-link-prod').forEach(btn => {
      btn.onclick = async () => {
        const prod = products.find(p => p.id === btn.getAttribute('data-prod-id'));
        try {
          const url = await getProductLink(btn.getAttribute('data-prod-id'));
          if (!url) return showToast('A loja ainda não tem endereço público.', 'error');
          await shareLink({ url, title: prod ? prod.name : 'Produto' });
        } catch (e) { showToast(e.message, 'error'); }
      };
    });

    // Gerir categorias (renomear, juntar, mover subcategorias)
    const manageBtn = container.querySelector('#btn-manage-cats');
    if (manageBtn) manageBtn.onclick = () => openCategoryManager(() => render());

    // Seleccionar produtos e alocá-los a uma categoria/subcategoria
    const bar = container.querySelector('#bulk-bar');
    const refreshBar = () => {
      if (!bar) return;
      bar.hidden = selected.size === 0; bar.style.display = selected.size ? 'flex' : 'none';
      bar.querySelector('#bulk-count').textContent = selected.size;
      const all = container.querySelector('#chk-all'); if (all) all.checked = filtered.length > 0 && filtered.every(p => selected.has(p.id));
    };
    container.querySelectorAll('.chk-prod').forEach(cb => {
      cb.onchange = () => { const id = cb.getAttribute('data-prod-id'); cb.checked ? selected.add(id) : selected.delete(id); refreshBar(); };
    });
    const chkAll = container.querySelector('#chk-all');
    if (chkAll) chkAll.onchange = () => {
      filtered.forEach(p => chkAll.checked ? selected.add(p.id) : selected.delete(p.id));
      container.querySelectorAll('.chk-prod').forEach(cb => { cb.checked = chkAll.checked; });
      refreshBar();
    };
    if (bar) {
      const catIn = bar.querySelector('#bulk-cat');
      catIn.addEventListener('input', () => { bar.querySelector('#dl-bulk-subs').innerHTML = subcategoriesOf(catIn.value).map(c => `<option value="${escAttr(c)}"></option>`).join(''); });
      bar.querySelector('#bulk-clear').onclick = () => { selected.clear(); container.querySelectorAll('.chk-prod').forEach(cb => { cb.checked = false; }); refreshBar(); };
      bar.querySelector('#bulk-apply').onclick = async () => {
        const cat = catIn.value.trim(); const sub = bar.querySelector('#bulk-sub').value.trim();
        if (!cat) return showToast('Indique a categoria de destino.', 'error');
        if (!confirm(`Mover ${selected.size} produto(s) para «${cat}»${sub ? ' › «' + sub + '»' : ' (sem subcategoria)'}?`)) return;
        try {
          const n = await db.assignProductsCategory(storeId, [...selected], cat, sub);
          showToast(`${n} produto(s) movido(s) para ${cat}${sub ? ' › ' + sub : ''}.`, 'success');
          selected.clear(); await render();
        } catch (e) { showToast(catError(e), 'error'); }
      };
    }

    // Activar / desactivar a visibilidade do produto na loja virtual
    container.querySelectorAll('.btn-toggle-pub').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-prod-id');
        const next = btn.getAttribute('data-pub') !== '1';
        btn.disabled = true;
        try {
          await db.rpcV7('fn_product_shop_save', { p_product_id: id, p_data: { published: next } });
          const prod = products.find(p => p.id === id);
          if (prod) prod.published = next;
          btn.setAttribute('data-pub', next ? '1' : '0');
          btn.style.color = next ? '#34d399' : '#94a3b8';
          btn.textContent = next ? '● Visível' : '○ Oculto';
          btn.title = 'Clique para ' + (next ? 'esconder da' : 'mostrar na') + ' loja virtual';
          showToast(next ? 'Produto visível na loja virtual.' : 'Produto escondido da loja virtual.', 'success');
        } catch (e) {
          showToast(/could not find the function|schema cache/i.test(e.message) ? 'Falta executar a migração da loja virtual no Supabase.' : e.message, 'error');
        } finally { btn.disabled = false; }
      };
    });

    // Loja virtual (fotografias, cores, promoção, publicação e link partilhável)
    container.querySelectorAll('.btn-shop-prod').forEach(btn => {
      btn.onclick = () => {
        const prod = products.find(p => p.id === btn.getAttribute('data-prod-id'));
        if (prod) openProductShopModal(prod);
      };
    });

    // Edit
    container.querySelectorAll('.btn-edit-prod').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-prod-id');
        const prod = products.find(p => p.id === id);
        if (prod) openProductModal(prod, () => render());
      };
    });

    // Delete
    container.querySelectorAll('.btn-delete-prod').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-prod-id');
        if (confirm('Deseja realmente remover este material do catálogo?')) {
          await db.deleteProduct(id);
          showToast('Material removido do cadastro.', 'success');
          render();
        }
      };
    });
  };

  const catError = (e) => (/subcategory/i.test(e?.message || '') ? 'Falta executar migracao_loja_virtual_v11.sql no Supabase (coluna da subcategoria).' : (e?.message || 'Erro'));

  /** Janela «Gerir categorias»: lista as categorias/subcategorias em uso e permite renomear, juntar e mover. */
  const openCategoryManager = (onChange) => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:12px;';
    document.body.appendChild(modal);
    let changed = false;

    const tree = () => {
      const map = new Map();
      products.forEach(p => {
        const c = (p.category || 'Geral').trim() || 'Geral';
        if (!map.has(c)) map.set(c, { n: 0, subs: new Map() });
        const e = map.get(c); e.n++;
        const sc = (p.subcategory || '').trim(); if (sc) e.subs.set(sc, (e.subs.get(sc) || 0) + 1);
      });
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt'));
    };
    const btn = 'padding:2px 8px;font-size:10px;';

    const paint = () => {
      modal.innerHTML = `<div class="card" style="width:100%;max-width:760px;padding:18px;margin:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;">
          <h3 style="margin:0;font-size:16px;color:#f8fafc;">Gerir categorias e subcategorias</h3>
          <button class="btn btn-secondary" id="cm-close" style="padding:2px 10px;">✕</button></div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Criar: escreva a categoria/subcategoria ao cadastrar ou editar um produto (ou use a selecção na lista para mover vários de uma vez).
          Renomear uma categoria para o nome de outra existente junta as duas. As alterações aplicam-se de imediato ao ERP e à loja virtual.</div>
        ${tree().map(([cat, e], i) => `
          <div style="border:1px solid #334155;border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#0f172a;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <strong style="flex:1;color:#f8fafc;font-size:13px;">${escAttr(cat)} <span style="color:#94a3b8;font-weight:400;">(${e.n})</span></strong>
              <button class="btn btn-secondary" data-cm="rename-cat" data-c="${i}" style="${btn}">Renomear / juntar</button></div>
            ${[...e.subs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt')).map(([sub, n], k) => `
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 0 14px;font-size:12px;color:#cbd5e1;">
                <span style="flex:1;">↳ ${escAttr(sub)} <span style="color:#94a3b8;">(${n})</span></span>
                <button class="btn btn-secondary" data-cm="rename-sub" data-c="${i}" data-s="${k}" style="${btn}">Renomear</button>
                <button class="btn btn-secondary" data-cm="move-sub" data-c="${i}" data-s="${k}" style="${btn}">Mover para outra categoria</button>
                <button class="btn btn-secondary" data-cm="del-sub" data-c="${i}" data-s="${k}" style="${btn}color:#f87171;" title="Os produtos ficam na categoria, sem subcategoria">Remover subcategoria</button></div>`).join('')}
          </div>`).join('') || '<div style="color:#94a3b8;font-size:12px;">Ainda não há produtos com categoria.</div>'}
      </div>`;
      modal.querySelector('#cm-close').onclick = () => { modal.remove(); if (changed) onChange && onChange(); };
      const rows = tree();
      modal.querySelectorAll('[data-cm]').forEach(b => {
        b.onclick = async () => {
          const [cat] = rows[Number(b.dataset.c)]; const sub = b.dataset.s !== undefined ? [...rows[Number(b.dataset.c)][1].subs.keys()].sort((a, z) => a.localeCompare(z, 'pt'))[Number(b.dataset.s)] : null;
          const kind = b.dataset.cm;
          try {
            let n = 0;
            if (kind === 'rename-cat') {
              const nv = (window.prompt(`Novo nome para a categoria «${cat}» (se escrever o nome de outra categoria, as duas ficam juntas):`, cat) || '').trim();
              if (!nv || nv === cat) return; n = await db.renameCategory(storeId, cat, nv);
            } else if (kind === 'rename-sub') {
              const nv = (window.prompt(`Novo nome para a subcategoria «${sub}» (em ${cat}):`, sub) || '').trim();
              if (!nv || nv === sub) return; n = await db.renameSubcategory(storeId, cat, sub, nv);
            } else if (kind === 'move-sub') {
              const nc = (window.prompt(`Mover a subcategoria «${sub}» (de ${cat}) para qual categoria? (escreva o nome; se não existir é criada)`, cat) || '').trim();
              if (!nc || nc === cat) return; n = await db.renameSubcategory(storeId, cat, sub, sub, nc);
            } else if (kind === 'del-sub') {
              if (!confirm(`Remover a subcategoria «${sub}»? Os produtos ficam em «${cat}», sem subcategoria.`)) return;
              n = await db.renameSubcategory(storeId, cat, sub, '');
            }
            showToast(`${n} produto(s) actualizado(s).`, 'success');
            changed = true; products = await db.getProducts(storeId); paint();
          } catch (e) { showToast(catError(e), 'error'); }
        };
      });
    };
    paint();
  };

  const openProductModal = (product, onSuccess) => {
    const isEdit = !!product;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';

    let conversions = product?.conversions ? JSON.parse(JSON.stringify(product.conversions)) : [];

    // Secção opcional «Loja virtual» (só no cadastro novo): fotografias + informações, enviadas depois de o produto ser gravado.
    const shop = emptyShopExtras();
    let shopInfo = null;
    let shopReady = false;
    const closeModal = () => { releaseShopExtras(shop); modal.remove(); };
    const paintShop = () => {
      const root = modal.querySelector('#sx-root');
      if (!root || !shopReady) return;
      root.innerHTML = shopExtrasHtml(shop, shopInfo);
      bindShopExtras(root, shop, shopInfo, { rerender: paintShop, toast: showToast });
    };

    const renderModal = () => {
      modal.innerHTML = `
        <div class="modal-dialog" style="max-width: 600px;">
          <div class="modal-header">
            <h3 class="modal-title">${isEdit ? 'Editar Material / Produto' : 'Cadastrar Novo Material'}</h3>
            <button class="modal-close-btn" id="btn-close-pmodal">✕</button>
          </div>

          <div class="modal-body" style="padding: 16px; display: flex; flex-direction: column; gap: 12px; max-height: 75vh; overflow-y: auto;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Código Interno:</label>
                <input type="text" id="inp-p-code" value="${product?.code || 'MAT-' + Math.floor(100 + Math.random() * 900)}" required style="width: 100%; font-family: var(--font-mono);">
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Código de Barras (EAN):</label>
                <input type="text" id="inp-p-barcode" value="${product?.barcode || ''}" placeholder="Ex: 7891234567890" style="width: 100%; font-family: var(--font-mono);">
              </div>
            </div>

            <div>
              <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Nome do Material:</label>
              <input type="text" id="inp-p-name" value="${product?.name || ''}" placeholder="Ex: Cimento Portland Especial 32.5N" required style="width: 100%;">
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Categoria (escolha ou escreva uma nova):</label>
                <input type="text" id="inp-p-category" list="dl-p-categories" maxlength="60" autocomplete="off" required value="${escAttr(product?.category || '')}" placeholder="Ex: Ferramentas" style="width: 100%;">
                <datalist id="dl-p-categories">${allCategories().map(c => `<option value="${escAttr(c)}"></option>`).join('')}</datalist>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin: 8px 0 4px;">Subcategoria (opcional):</label>
                <input type="text" id="inp-p-subcategory" list="dl-p-subcategories" maxlength="60" autocomplete="off" value="${escAttr(product?.subcategory || '')}" placeholder="Ex: Martelos" style="width: 100%;">
                <datalist id="dl-p-subcategories">${subcategoriesOf(product?.category).map(c => `<option value="${escAttr(c)}"></option>`).join('')}</datalist>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Unidade Base:</label>
                <select id="inp-p-unit" style="width: 100%;">${unitOptions(product?.baseUnit).map(([c, n]) => `<option value="${escAttr(c)}" ${product?.baseUnit === c ? 'selected' : ''}>${escAttr(n)}</option>`).join('')}</select>
              </div>
            </div>

            ${attributeDefs().length ? `<div style="font-size: 11px; font-weight: 800; color: #94a3b8; margin: 2px 0 -4px;">ATRIBUTOS · ${escAttr(businessTypeName())}</div>
            <div id="attr-box" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px;">${attributeDefs().map(a => attributeFieldHtml(a, (product?.attributes || {})[a.key], escAttr)).join('')}</div>` : ''}

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Preço Custo (${CUR()}):</label>
                <input type="number" step="0.01" id="inp-p-cost" value="${product?.costPriceBase || 0}" style="width: 100%; font-family: var(--font-mono);">
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Preço Venda (${CUR()}):</label>
                <input type="number" step="0.01" id="inp-p-sale" value="${product?.salePriceBase || 0}" style="width: 100%; font-family: var(--font-mono); font-weight: bold; color: #34d399;">
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Alerta Estoque Mín:</label>
                <input type="number" step="1" id="inp-p-min" value="${product?.minStockAlert || 10}" style="width: 100%; font-family: var(--font-mono);">
              </div>
            </div>

            <!-- Locations breakdown if new -->
            ${!isEdit ? `
              <div style="background: #1e293b; padding: 10px; border-radius: 8px; border: 1px solid #334155;">
                <span style="font-size: 10px; font-weight: 700; color: #ea580c; text-transform: uppercase; display: block; margin-bottom: 6px;">Estoque Inicial por Local:</span>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                  <div>
                    <label style="font-size: 10px; color: #94a3b8;">${escAttr(locationLabel('LOJA'))}:</label>
                    <input type="number" id="inp-p-stock-loja" value="0" style="width: 100%; font-size: 11px;">
                  </div>
                  <div>
                    <label style="font-size: 10px; color: #94a3b8;">${escAttr(locationLabel('ARMAZEM'))}:</label>
                    <input type="number" id="inp-p-stock-arm" value="0" style="width: 100%; font-size: 11px;">
                  </div>
                  <div>
                    <label style="font-size: 10px; color: #94a3b8;">${escAttr(locationLabel('PATIO'))}:</label>
                    <input type="number" id="inp-p-stock-patio" value="0" style="width: 100%; font-size: 11px;">
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- Conversions table (Multi-packaging) -->
            <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 10px; font-weight: 700; color: #ea580c; text-transform: uppercase;">Múltiplas Embalagens / Conversões (PDV):</span>
                <button type="button" class="btn btn-secondary" id="btn-add-conversion" style="padding: 2px 8px; font-size: 10px;">
                  + Adicionar Embalagem
                </button>
              </div>

              ${conversions.length === 0 ? `
                <div style="font-size: 11px; color: #64748b;">Nenhuma embalagem alternativa configurada (vendido apenas na unidade base).</div>
              ` : `
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  ${conversions.map((c, idx) => `
                    <div style="display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 6px; align-items: center;">
                      <input type="text" placeholder="Nome (Ex: Saco 50kg)" value="${c.packagingName}" data-cidx="${idx}" class="inp-c-name" style="font-size: 11px;">
                      <input type="number" step="any" placeholder="Multiplicador" value="${c.multiplierToBase}" data-cidx="${idx}" class="inp-c-mult" style="font-size: 11px;">
                      <input type="number" step="any" placeholder="Preço ${CUR()}" value="${c.salePrice || ''}" data-cidx="${idx}" class="inp-c-price" style="font-size: 11px;">
                      <button type="button" class="btn-del-conv" data-cidx="${idx}" style="color: #f87171; background: transparent; border: none; cursor: pointer;">✕</button>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>

            <!-- Weight Scale toggle -->
            <div>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #cbd5e1; cursor: pointer;">
                <input type="checkbox" id="inp-p-weight" ${product?.allowWeight ? 'checked' : ''}>
                <span>Habilitar pesagem direta na Balança Eletrônica (Modo Granel / Quilo)</span>
              </label>
            </div>

            ${!isEdit ? '<div id="sx-root"></div>' : ''}
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" id="btn-cancel-pmodal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-prod">
              ${isEdit ? 'Atualizar Material' : 'Salvar no Catálogo'}
            </button>
          </div>
        </div>
      `;

      modal.querySelector('#btn-close-pmodal').onclick = closeModal;
      modal.querySelector('#btn-cancel-pmodal').onclick = closeModal;
      paintShop();

      // Add conversion row
      modal.querySelector('#btn-add-conversion').onclick = () => {
        conversions.push({
          packagingName: 'Embalagem Especial',
          multiplierToBase: 1,
          salePrice: 0
        });
        renderModal();
      };

      // Conversion row inputs
      modal.querySelectorAll('.inp-c-name').forEach(inp => {
        inp.oninput = (e) => {
          const idx = parseInt(inp.getAttribute('data-cidx'));
          conversions[idx].packagingName = e.target.value;
        };
      });
      modal.querySelectorAll('.inp-c-mult').forEach(inp => {
        inp.oninput = (e) => {
          const idx = parseInt(inp.getAttribute('data-cidx'));
          conversions[idx].multiplierToBase = parseFloat(e.target.value) || 1;
        };
      });
      modal.querySelectorAll('.inp-c-price').forEach(inp => {
        inp.oninput = (e) => {
          const idx = parseInt(inp.getAttribute('data-cidx'));
          conversions[idx].salePrice = parseFloat(e.target.value) || 0;
        };
      });
      modal.querySelectorAll('.btn-del-conv').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.getAttribute('data-cidx'));
          conversions.splice(idx, 1);
          renderModal();
        };
      });

      // Subcategorias sugeridas conforme a categoria escrita/escolhida
      const catInp = modal.querySelector('#inp-p-category');
      catInp.addEventListener('input', () => {
        modal.querySelector('#dl-p-subcategories').innerHTML = subcategoriesOf(catInp.value).map(c => `<option value="${escAttr(c)}"></option>`).join('');
      });

      // Save
      modal.querySelector('#btn-save-prod').onclick = async () => {
        const name = modal.querySelector('#inp-p-name').value.trim();
        const code = modal.querySelector('#inp-p-code').value.trim();
        if (!name || !code) {
          showToast('Código e Nome do material são obrigatórios.', 'error');
          return;
        }

        const cost = parseFloat(modal.querySelector('#inp-p-cost').value) || 0;
        const sale = parseFloat(modal.querySelector('#inp-p-sale').value) || 0;
        const minStock = parseFloat(modal.querySelector('#inp-p-min').value) || 10;
        const baseUnit = modal.querySelector('#inp-p-unit').value;
        const category = modal.querySelector('#inp-p-category').value.trim();
        const subcategory = modal.querySelector('#inp-p-subcategory').value.trim();
        if (!category) { showToast('Indique a categoria do material.', 'error'); return; }
        const barcode = modal.querySelector('#inp-p-barcode').value.trim();
        const attrRead = readAttributes(modal);   // v25
        if (attrRead.missing.length) { showToast('Preencha os atributos obrigatórios: ' + attrRead.missing.join(', ') + '.', 'error'); return; }
        const allowWeight = modal.querySelector('#inp-p-weight').checked;

        let stockByLocation = product?.stockByLocation || { LOJA: 0, ARMAZEM: 0, PATIO: 0 };
        let currentStockBase = product?.currentStockBase || 0;

        if (!isEdit) {
          const sLoja = parseFloat(modal.querySelector('#inp-p-stock-loja')?.value) || 0;
          const sArm = parseFloat(modal.querySelector('#inp-p-stock-arm')?.value) || 0;
          const sPatio = parseFloat(modal.querySelector('#inp-p-stock-patio')?.value) || 0;
          stockByLocation = { LOJA: sLoja, ARMAZEM: sArm, PATIO: sPatio };
          currentStockBase = sLoja + sArm + sPatio;
        }

        const savedItem = {
          id: product?.id || 'prod-' + Date.now(),
          storeId,
          code,
          barcode,
          name,
          category,
          subcategory,
          baseUnit,
          costPriceBase: cost,
          salePriceBase: sale,
          minStockAlert: minStock,
          minStockBase: minStock,
          currentStockBase,
          stockByLocation,
          allowWeight,
          conversions,
          attributes: (() => { const m = { ...(product?.attributes || {}) }; attributeDefs().forEach(d => { delete m[d.key]; }); return Object.assign(m, attrRead.values); })()
        };

        const saveBtn = modal.querySelector('#btn-save-prod');
        const saveLabel = saveBtn.innerHTML;
        saveBtn.disabled = true;
        try {
          await db.saveProduct(savedItem);
        } catch (e) {
          saveBtn.disabled = false;
          throw e;
        }
        // Fase 2 (opcional): fotografias e informações da loja virtual. O produto já está gravado; uma falha aqui só gera aviso.
        let shopResult = null;
        if (!isEdit && shopInfo && hasShopExtras(shop)) {
          shopResult = await saveShopExtras(savedItem.id, shop, shopInfo, (t) => { saveBtn.textContent = t; });
        }
        saveBtn.innerHTML = saveLabel;
        if (shopResult && !shopResult.ok) {
          showToast(`Material ${savedItem.name} gravado, mas nem tudo da loja virtual foi guardado: ${shopResult.warnings.join(' | ')} Pode completar em «Loja virtual» do produto.`, 'warning');
        } else {
          showToast(`Material ${savedItem.name} gravado com sucesso!${shopResult && shopResult.uploaded ? ` (${shopResult.uploaded} foto(s) na loja virtual)` : ''}`, 'success');
        }
        closeModal();
        if (onSuccess) onSuccess();
      };
    };

    renderModal();
    document.body.appendChild(modal);
    if (!isEdit) {
      loadShopInfo().then((info) => { shopInfo = info; shopReady = true; if (modal.isConnected) paintShop(); });
    }
  };

  await render();
}
