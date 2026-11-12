/**
 * GEF - Assinatura "PRISMA" (empresa criadora) para a página de abertura/login.
 * Só HTML/CSS inline: não altera o logótipo GEF (assets/icons/icon.svg) nem o Supabase.
 */
export function prismaSignatureHtml() {
  return `
  <div class="prisma-sig" style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:26px;">
    <div style="width:56px;height:1px;background:linear-gradient(90deg,transparent,#475569,transparent);"></div>
    <span style="font:600 9px/1 system-ui,-apple-system,sans-serif;letter-spacing:.38em;text-transform:uppercase;color:#64748b;">Criado por</span>
    <div style="display:flex;align-items:center;gap:10px;">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <defs><linearGradient id="prSp" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#f97316"/><stop offset=".5" stop-color="#facc15"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs>
        <path d="M12 2.5 22 20H2z" fill="none" stroke="#e2e8f0" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M7.5 14.5 16.5 11" stroke="#f8fafc" stroke-width="1" stroke-linecap="round"/>
        <path d="M16.5 11 22 9.5M16.5 11l5.5 1.5M16.5 11l5 4" stroke="url(#prSp)" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      <span style="font:300 19px/1 Georgia,'Times New Roman',serif;letter-spacing:.42em;color:#e2e8f0;padding-left:.42em;">PRISMA</span>
    </div>
  </div>`;
}
