/**
 * GEF - GESTÃO FINANCEIRA | LOGIN MODULE
 * JavaScript Puro (Vanilla JS)
 * Autenticação exclusivamente via Supabase Auth. Sem usuários de demonstração.
 */

import { auth } from '../../js/core/auth.js';
import { showToast } from '../../js/components/toast.js';
import { isSupabaseConfigured } from '../../js/core/supabase.js';
import { prismaSignatureHtml } from '../../js/components/prisma-signature.js';

export async function initLoginModule(container, onSuccess) {
  const isConnected = isSupabaseConfigured();

  container.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: #0b0f19;">
      <div style="width: 100%; max-width: 440px; background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
        <!-- Logo & Header -->
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 96px; height: 96px; margin-bottom: 14px; filter: drop-shadow(0 8px 28px rgba(249,115,22,.28));">
            <img src="assets/icons/icon.svg" alt="GEF Logo" style="width: 96px; height: 96px;">
          </div>
          <h1 style="font-size: 20px; font-weight: 900; color: #f8fafc; margin: 0;">GEF - GESTÃO FINANCEIRA</h1>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Gestão completa do seu negócio</p>
        </div>

        ${!isConnected ? `
          <div style="margin-bottom: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #fca5a5;">
            <strong>Supabase não configurado.</strong> Defina <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> em <code>js/config.js</code> antes de publicar.
          </div>
        ` : ''}

        <!-- Form -->
        <form id="form-login" style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label for="login-email" style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Telemóvel</label>
            <input type="text" id="login-email" name="gef-login-id" inputmode="tel" required autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120" style="width: 100%; font-size: 13px;">
          </div>
          <div>
            <label for="login-password" style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">Palavra-passe</label>
            <input type="password" id="login-password" name="gef-login-pass" required autocomplete="new-password" style="width: 100%; font-size: 13px;">
          </div>

          <button type="submit" class="btn btn-primary" id="btn-submit-login" style="width: 100%; padding: 12px; font-size: 13px; font-weight: 800; margin-top: 6px;" ${!isConnected ? 'disabled' : ''}>
            Acessar Sistema GEF
          </button>
        </form>
        ${prismaSignatureHtml()}
      </div>
    </div>
  `;

  const form = container.querySelector('#form-login');
  const submitBtn = container.querySelector('#btn-submit-login');
  form.setAttribute('autocomplete', 'off');
  // Formulário SEMPRE vazio: também ao voltar atrás no navegador (cache de páginas) ou depois de terminar a sessão.
  const clearForm = () => { form.reset(); form.querySelectorAll('input').forEach((i) => { i.value = ''; }); };
  window.addEventListener('pageshow', clearForm);
  setTimeout(clearForm, 50);   // apaga o que o navegador preencher sozinho
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = container.querySelector('#login-email').value;   // telemóvel (ou email, nas contas antigas)
    const password = container.querySelector('#login-password').value;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Autenticando...';

    try {
      const res = await auth.signIn(email, password);
      if (res.success) {
        showToast(`Bem-vindo, ${res.user.fullName}!`, 'success');
        if (onSuccess) onSuccess(res.user);
      } else {
        showToast(res.error || 'Falha ao autenticar.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Erro inesperado ao realizar login.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Acessar Sistema GEF';
    }
  };
}
