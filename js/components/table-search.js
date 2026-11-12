/**
 * GEF | BARRA DE PESQUISA PARA TABELAS (reutilizável)
 * - normalizeText: minúsculas e sem acentos (pesquisar «luanda» encontra «Luanda», «jose» encontra «José»).
 * - attachTableSearch: acrescenta uma caixa de pesquisa acima de uma tabela e filtra as linhas já desenhadas.
 */
export const normalizeText = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function attachTableSearch(table, { placeholder = 'Pesquisar…' } = {}) {
  if (!table || table.dataset.searchAttached) return null;
  table.dataset.searchAttached = '1';
  const wrap = table.closest('[style*="overflow-x"]') || table;
  const bar = document.createElement('div');
  bar.style.cssText = 'padding:10px 14px;border-bottom:1px solid #1f2937;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
  bar.innerHTML = `<input type="search" data-table-search placeholder="${placeholder.replace(/"/g, '&quot;')}" style="flex:1 1 240px;max-width:420px;"><span data-table-count style="font-size:11px;color:#94a3b8;"></span>`;
  wrap.parentNode.insertBefore(bar, wrap);
  const input = bar.querySelector('input'), count = bar.querySelector('[data-table-count]');
  const body = table.tBodies[0];
  const colSpan = (table.tHead?.rows[0]?.cells.length) || 1;
  const apply = () => {
    const q = normalizeText(input.value);
    const rows = Array.from(body.rows).filter((r) => !r.hasAttribute('data-search-empty'));
    let shown = 0;
    rows.forEach((r) => {
      const hit = !q || normalizeText(r.textContent).includes(q);
      r.style.display = hit ? '' : 'none';
      if (hit) shown += 1;
    });
    body.querySelector('[data-search-empty]')?.remove();
    if (q && shown === 0) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-search-empty', '');
      tr.innerHTML = `<td colspan="${colSpan}" style="padding:16px;color:#94a3b8;">Nenhum resultado para «${input.value.trim().replace(/[<>&]/g, '')}».</td>`;
      body.appendChild(tr);
    }
    count.textContent = q ? `${shown} de ${rows.length}` : '';
  };
  input.addEventListener('input', apply);
  return { input, apply };
}
