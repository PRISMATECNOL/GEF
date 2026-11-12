/**
 * GEF - ADESÃO PÚBLICA POR EMBAIXADOR
 *
 * Fluxo:
 * 1. Lê o código do embaixador da URL.
 * 2. Valida o embaixador no Supabase.
 * 3. Cria o utilizador através do Supabase Auth.
 * 4. Completa o onboarding através da RPC segura.
 * 5. Cria a loja em public.stores.
 * 6. Liga o ADMIN à loja em public.profiles.
 * 7. Regista a relação em ambassador_referred_stores.
 */

import {
    supabase as sharedSupabase,
    isSupabaseConfigured
} from './core/supabase.js';
import { panelState } from './core/ambassador-view.js';
import { toLoginEmail } from './core/login-id.js';

let supabase = null;
let ambassador = null;


/* =========================================================
   ELEMENTOS
========================================================= */

const form = document.getElementById('adesao-form');
const submitButton = document.getElementById('submit-btn');
const messageBox = document.getElementById('message');

/* Formulário SEMPRE vazio: ao abrir, ao voltar atrás (cache do navegador) e contra preenchimento automático. */
const clearForm = () => { form.reset(); form.querySelectorAll('input').forEach((i) => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; }); };
setTimeout(clearForm, 50);
window.addEventListener('pageshow', clearForm);

const ambassadorBox = document.getElementById('ambassador-box');
const ambassadorName = document.getElementById('ambassador-name');


/* =========================================================
   MENSAGENS
========================================================= */

function showMessage(message, type = 'error') {

    messageBox.textContent = message;

    messageBox.className = `message ${type}`;

    messageBox.style.display = 'block';
}


function hideMessage() {

    messageBox.style.display = 'none';

    messageBox.textContent = '';
}


/* =========================================================
   CONFIGURAÇÃO SUPABASE
========================================================= */

function initializeSupabase() {

    if (!isSupabaseConfigured() || !sharedSupabase) {
        throw new Error(
            'A ligação com o Supabase ainda não está configurada.'
        );
    }

    supabase = sharedSupabase;
}


/* =========================================================
   CÓDIGO DO EMBAIXADOR
========================================================= */

function getAmbassadorCode() {

    const params = new URLSearchParams(
        window.location.search
    );

    return (
        params.get('embaixador') ||
        params.get('ambassador') ||
        params.get('codigo') ||
        ''
    ).trim();
}


/* =========================================================
   VALIDAR EMBAIXADOR
========================================================= */

async function loadAmbassador() {

    const code = getAmbassadorCode();

    if (!code) {

        throw new Error(
            'Link de adesão inválido. O código do embaixador não foi informado.'
        );
    }

    const { data, error } = await supabase
        .rpc(
            'fn_validate_ambassador_code',
            {
                p_referral_code: code
            }
        );

    if (error) {

        console.error(
            'Erro ao validar embaixador:',
            error
        );

        throw new Error(
            'Não foi possível validar o link do embaixador.'
        );
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row || row.valid === false) {
        throw new Error(
            row?.message ||
            'Este link de embaixador é inválido ou está inativo.'
        );
    }

    ambassador = row;
    ambassador.referral_code = ambassador.referral_code || code;

    ambassadorName.textContent =
        ambassador.name || ambassador.referral_code || code;

    ambassadorBox.style.display = 'block';
}


/* =========================================================
   OBTER DADOS DO FORMULÁRIO
========================================================= */

function getFormData() {

    const data = new FormData(form);

    return {

        businessType:
            String(data.get('businessType') || '').trim(),

        storeName:
            String(data.get('storeName') || '').trim(),

        ownerName:
            String(data.get('ownerName') || '').trim(),

        phone:
            String(data.get('phone') || '').trim(),

        city:
            String(data.get('city') || '').trim(),

        address:
            String(data.get('address') || '').trim(),

        nuitNif:
            String(data.get('nuitNif') || '').trim(),

        monthlyFee:
            Number(data.get('monthlyFee') || 0),

        adminEmail:
            String(data.get('adminEmail') || '').trim().toLowerCase(),   // OPCIONAL: só marketing

        emailOptin:
            !!data.get('emailOptin'),

        adminPassword:
            String(data.get('adminPassword') || '')
    };
}


/* =========================================================
   VALIDAÇÃO
========================================================= */

function validateForm(data) {

    if (!data.businessType) {

        throw new Error(
            'Seleccione o tipo de negócio.'
        );
    }

    if (!data.storeName) {

        throw new Error(
            'Informe o nome da empresa / loja.'
        );
    }

    if (!data.ownerName) {

        throw new Error(
            'Informe o nome do responsável.'
        );
    }

    const phoneDigits = data.phone.replace(/[^0-9]/g, '');

    if (data.phone.includes('@') || phoneDigits.length < 7 || phoneDigits.length > 15) {

        throw new Error(
            'Informe um contacto (telemóvel) válido.'
        );
    }

    if (!data.address || data.address.length < 3) {

        throw new Error(
            'Informe o endereço.'
        );
    }

    if (data.adminEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.adminEmail)) {

        throw new Error(
            'Email inválido (pode deixá-lo em branco).'
        );
    }

    if (data.emailOptin && !data.adminEmail) {

        throw new Error(
            'Para receber promoções por email, indique o seu email.'
        );
    }

    if (!data.adminPassword || data.adminPassword.length < 8) {

        throw new Error(
            'A palavra-passe deve ter pelo menos 8 caracteres.'
        );
    }

    if (
        !Number.isFinite(data.monthlyFee) ||
        data.monthlyFee < 0
    ) {

        throw new Error(
            'A mensalidade informada é inválida.'
        );
    }
}


/* =========================================================
   SUBMIT
========================================================= */

form.addEventListener(
    'submit',
    async event => {

        event.preventDefault();

        hideMessage();

        submitButton.disabled = true;

        submitButton.textContent =
            'A processar...';


        try {

            if (!supabase) {

                initializeSupabase();
            }


            const data = getFormData();


            validateForm(data);


            /*
             * Se ainda não carregamos o embaixador,
             * carregamos agora.
             */

            if (!ambassador) {

                await loadAmbassador();
            }


            /*
             * DONO DO LINK AUTENTICADO (confirmado pelo servidor em adesao-publica.js):
             * cria a loja pela RPC autenticada, que liga ao embaixador da sessão.
             * Não faz login com a conta da loja, para não fechar a sessão do embaixador.
             */
            if (panelState.ownerMode) {
                const { data: created, error: createError } =
                    await supabase.rpc('fn_ambassador_create_store', {
                        p_ambassador_id: null,
                        p_store_name: data.storeName,
                        p_owner_name: data.ownerName,
                        p_phone: data.phone,
                        p_city: data.city || data.address.slice(0, 60),
                        p_monthly_fee: data.monthlyFee,
                        p_contract_months: 12,
                        p_admin_email: data.phone,   // o acesso é o telemóvel (sem email, sem código)
                        p_admin_password: data.adminPassword,
                        p_address: data.address || null,
                        p_nuit_nif: data.nuitNif || null,
                        p_business_type: data.businessType
                    });

                if (createError) {
                    throw new Error(
                        createError.message ||
                        'Não foi possível criar a loja.'
                    );
                }

                if (!created?.success) {
                    throw new Error(
                        'O sistema não confirmou a criação da loja.'
                    );
                }

                form.reset();
                showMessage(
                    `Loja criada! O administrador entra com o telemóvel ${data.phone}. Já aparece na sua lista de lojas vinculadas.`,
                    'success'
                );
                submitButton.disabled = false;
                submitButton.textContent = 'Criar conta e registar empresa';

                if (typeof panelState.refresh === 'function') {
                    await panelState.refresh();
                }
                return;
            }

            /*
             * Visitante (loja nova): cria utilizador + loja + ADMIN + ligação ao embaixador
             * num único passo seguro (não depende de confirmação de e-mail).
             */
            const { data: result, error: rpcError } =
                await supabase.rpc(
                    'fn_public_store_signup',
                    {
                        p_referral_code: ambassador.referral_code,
                        p_store_name: data.storeName,
                        p_owner_name: data.ownerName,
                        p_phone: data.phone,
                        p_address: data.address,
                        p_password: data.adminPassword,
                        p_city: data.city || null,
                        p_nuit_nif: data.nuitNif || null,
                        p_monthly_fee: data.monthlyFee,
                        p_marketing_email: data.adminEmail || null,
                        p_email_optin: data.emailOptin,
                        p_business_type: data.businessType
                    }
                );

            if (rpcError) {
                throw new Error(
                    rpcError.message ||
                    'Não foi possível concluir o registo da empresa.'
                );
            }

            if (!result?.success) {
                throw new Error(
                    'O sistema não confirmou a criação da empresa.'
                );
            }

            // Entra automaticamente e segue para o sistema
            const { error: loginError } =
                await supabase.auth.signInWithPassword({
                    email: toLoginEmail(data.phone),
                    password: data.adminPassword
                });

            if (!loginError) {
                showMessage(
                    'Registo concluído! A entrar no sistema...',
                    'success'
                );
                form.reset();
                submitButton.textContent = 'Registo concluído';
                setTimeout(() => {
                    window.location.href = './index.html';
                }, 1200);
                return;
            }

            showMessage(
                'Registo concluído com sucesso! A empresa e o utilizador administrador foram criados.',
                'success'
            );


            form.reset();


            submitButton.textContent =
                'Registo concluído';


            /*
             * Não fazemos logout aqui porque a sessão
             * criada pelo Supabase pertence ao novo ADMIN.
             */

        } catch (error) {

            console.error(
                'Erro na adesão:',
                error
            );


            showMessage(
                error?.message ||
                'Ocorreu um erro ao processar a adesão.',
                'error'
            );


            submitButton.disabled = false;

            submitButton.textContent =
                'Criar conta e registar empresa';
        }

    }
);


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

(async function init() {

    try {

        initializeSupabase();

        await loadAmbassador();

    } catch (error) {

        console.error(
            'Erro inicial:',
            error
        );

        showMessage(
            error?.message ||
            'Não foi possível carregar o link de adesão.',
            'error'
        );

        submitButton.disabled = true;
    }

})();


/* v25 — TIPO DE NEGÓCIO (obrigatório): lista pública dos sectores activos */
(async function loadBusinessTypes() {
    const sel = document.getElementById('businessType');
    if (!sel) return;
    try {
        const client = supabase || sharedSupabase;
        const { data, error } = await client.rpc('fn_business_types');
        if (error) throw error;
        const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const grp = (k) => (data || []).filter((t) => t.kind === k).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
        sel.innerHTML = `<option value="">— Seleccione o tipo de negócio —</option><optgroup label="Comércio">${grp('COMERCIO')}</optgroup><optgroup label="Armazéns">${grp('ARMAZEM')}</optgroup>`;
    } catch (e) {
        sel.innerHTML = '<option value="">Indisponível. Tente mais tarde.</option>';
    }
})();
