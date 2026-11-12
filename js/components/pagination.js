/**
 * GEF | PAGINAÇÃO LEVE (reutilizável)
 * Mostra só uma página de cada vez em históricos longos -> render muito mais rápido.
 */

export const DEFAULT_PAGE_SIZE = 25;

/** Fatia a lista e devolve a página corrigida. */
export function paginate(items, page = 1, size = DEFAULT_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * size;
  return {
    rows: list.slice(start, start + size),
    page: current,
    pages,
    total,
    size,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + size, total)
  };
}

/** HTML dos controlos. `key` distingue vários paginadores na mesma página. */
export function renderPager(p, key = 'main') {
  if (!p || p.total <= p.size) {
    return p && p.total > 0
      ? `<div style="padding: 8px 14px; font-size: 11px; color: #64748b;">${p.total} registo(s)</div>`
      : '';
  }
  const btn = (label, target, disabled) => `
    <button type="button" class="btn btn-secondary gef-pager-btn" data-pager="${key}" data-page="${target}"
      ${disabled ? 'disabled' : ''} style="padding: 4px 10px; font-size: 11px;">${label}</button>`;
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 14px; border-top: 1px solid #1f2937;">
      <span style="font-size: 11px; color: #94a3b8;">
        ${p.from}–${p.to} de ${p.total} registos
      </span>
      <div style="display: flex; gap: 6px; align-items: center;">
        ${btn('«', 1, p.page === 1)}
        ${btn('‹ Anterior', p.page - 1, p.page === 1)}
        <span style="font-size: 11px; color: #cbd5e1; font-weight: 700; padding: 0 4px;">Página ${p.page} / ${p.pages}</span>
        ${btn('Seguinte ›', p.page + 1, p.page === p.pages)}
        ${btn('»', p.pages, p.page === p.pages)}
      </div>
    </div>`;
}

/** Liga os botões do paginador `key` dentro de `root`. */
export function bindPager(root, key, onPage) {
  root.querySelectorAll(`.gef-pager-btn[data-pager="${key}"]`).forEach((b) => {
    b.onclick = () => {
      if (b.disabled) return;
      onPage(Number(b.getAttribute('data-page')) || 1);
    };
  });
}

/**
 * Paginação automática de tabelas `table.data-table` dentro de `root`.
 * Não mexe na lógica do módulo: só esconde as linhas fora da página atual e
 * acrescenta os controlos. Reaplica-se sozinha quando o módulo volta a desenhar.
 */
export function enhanceTables(root, size = DEFAULT_PAGE_SIZE) {
  if (!root || root.__gefPager) return;
  root.__gefPager = true;

  let timer = null;
  let observer = null;

  const apply = () => {
    if (observer) observer.disconnect();
    try {
      root.querySelectorAll('table.data-table').forEach((table) => paginateOne(table));
    } finally {
      if (observer) observer.observe(root, { childList: true, subtree: true });
    }
  };

  const paginateOne = (table) => {
    const body = table.tBodies[0];
    if (!body) return;
    const rows = Array.from(body.rows);
    const host = table.parentElement;
    const existing = host && host.parentElement
      ? host.parentElement.querySelector(':scope > .gef-table-pager')
      : null;

    if (rows.length <= size) {
      if (existing) existing.remove();
      rows.forEach((r) => { r.style.display = ''; });
      return;
    }

    const page = table.__gefPage || 1;
    const info = paginate(rows, page, size);
    table.__gefPage = info.page;

    rows.forEach((r, i) => {
      r.style.display = (i >= (info.page - 1) * size && i < info.page * size) ? '' : 'none';
    });

    let pager = existing;
    if (!pager) {
      pager = document.createElement('div');
      pager.className = 'gef-table-pager';
      host.insertAdjacentElement('afterend', pager);
    }
    pager.innerHTML = renderPager(info, 'tbl');
    bindPager(pager, 'tbl', (pg) => {
      table.__gefPage = pg;
      apply();
    });
  };

  observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(apply, 0);
  });

  apply();
}
