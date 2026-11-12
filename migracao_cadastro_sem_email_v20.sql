-- ==============================================================================
-- GEF | v20 — CADASTRO SEM EMAIL, SEM CÓDIGO DE CONFIRMAÇÃO, PRONTO PARA MUITOS CADASTROS EM SIMULTÂNEO
-- Executar no Supabase → SQL Editor, DEPOIS da v19. Idempotente (pode repetir).
--
--  1) Todos os utilizadores (lojista/admin, gerente, caixa, embaixador, marketing, logista) entram com
--     TELEMÓVEL + palavra-passe. O email passa a ser opcional e serve só para promoções (marketing).
--     Internamente o telemóvel vira um «email técnico» (s<9 dígitos>@<domínio>), nunca recebe mensagens.
--     Contas antigas com email real continuam a entrar com o email.
--  2) Cadastro público da loja (link do embaixador) em UM passo: nome, contacto, endereço e palavra-passe.
--     Sem email, sem código, sem link de confirmação. Cria utilizador + loja + ADMIN + ligação ao embaixador.
--  3) Carga alta: limitador «só acrescenta linhas» (sem UPDATE/contadores partilhados → sem bloqueios entre
--     pedidos), bloqueio mínimo apenas entre pedidos do MESMO telemóvel, repetição do mesmo pedido é idempotente.
-- ==============================================================================

-- ------------------------------ 1. COLUNAS ------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;                                  -- telemóvel de acesso (como foi escrito)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_email TEXT;                          -- email OPCIONAL (só marketing)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_optin BOOLEAN NOT NULL DEFAULT FALSE; -- autorizou promoções por email
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone) WHERE phone IS NOT NULL;

-- ------------------------------ 2. IDENTIFICADOR DE ACESSO ------------------------------
-- IMPORTANTE: o domínio abaixo tem de ser igual a LOGIN_DOMAIN (js/config.js) e ao segredo CUSTOMER_LOGIN_DOMAIN.
CREATE OR REPLACE FUNCTION public.fn_login_domain() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT 'cliente.invalid'::TEXT $$;

-- telemóvel (7–15 dígitos) → s<últimos 9 dígitos>@domínio ;  email → o próprio email ;  senão NULL
CREATE OR REPLACE FUNCTION public.fn_login_email(p_identifier TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT := LOWER(TRIM(COALESCE(p_identifier, ''))); d TEXT;
BEGIN
    IF v = '' THEN RETURN NULL; END IF;
    IF POSITION('@' IN v) > 0 THEN
        RETURN CASE WHEN v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND char_length(v) <= 120 THEN v ELSE NULL END;
    END IF;
    d := REGEXP_REPLACE(v, '[^0-9]', '', 'g');
    IF char_length(d) < 7 OR char_length(d) > 15 THEN RETURN NULL; END IF;
    RETURN 's' || RIGHT(d, 9) || '@' || public.fn_login_domain();
END $$;

-- ------------------------------ 3. LIMITADOR SEM BLOQUEIOS ------------------------------
-- Só faz INSERT (nunca UPDATE de um contador partilhado): dois pedidos em simultâneo nunca esperam um pelo outro.
-- Pode deixar passar 1–2 pedidos acima do limite em corrida — aceitável; o que importa é nunca travar.
CREATE TABLE IF NOT EXISTS public.auth_attempts (
    id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL, kind TEXT NOT NULL, ok BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_key ON public.auth_attempts(key, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_created ON public.auth_attempts(created_at);
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_client_ip() RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h TEXT := NULLIF(current_setting('request.headers', TRUE), ''); ip TEXT;
BEGIN
    IF h IS NULL THEN RETURN 'unknown'; END IF;
    ip := NULLIF(TRIM(SPLIT_PART(COALESCE((h::JSONB)->>'cf-connecting-ip', (h::JSONB)->>'x-forwarded-for', ''), ',', 1)), '');
    RETURN COALESCE(LEFT(ip, 60), 'unknown');
EXCEPTION WHEN OTHERS THEN RETURN 'unknown';
END $$;

-- TRUE = pedido autorizado (e registado). FALSE = limite atingido (não regista, por isso a tabela nunca cresce sem limite).
CREATE OR REPLACE FUNCTION public.fn_rl_hit(p_key TEXT, p_kind TEXT, p_max INT, p_window_s INT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n INT;
BEGIN
    SELECT COUNT(*) INTO v_n FROM public.auth_attempts WHERE key = LEFT(p_key, 120) AND kind = p_kind AND created_at > NOW() - make_interval(secs => p_window_s);
    IF v_n >= p_max THEN RETURN FALSE; END IF;
    INSERT INTO public.auth_attempts (key, kind, ok) VALUES (LEFT(p_key, 120), p_kind, TRUE);
    IF random() < 0.01 THEN   -- limpeza ocasional, em lotes pequenos, sem esperar por linhas bloqueadas
        DELETE FROM public.auth_attempts WHERE id IN (SELECT id FROM public.auth_attempts WHERE created_at < NOW() - INTERVAL '2 days' LIMIT 500 FOR UPDATE SKIP LOCKED);
    END IF;
    RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.fn_rl_hit(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_client_ip() FROM PUBLIC, anon, authenticated;

-- fn_auth_record: limpeza também em lotes sem espera (substitui a da v19)
CREATE OR REPLACE FUNCTION public.fn_auth_record(p_keys TEXT[], p_kind TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO public.auth_attempts (key, kind, ok) SELECT LEFT(k, 120), p_kind, p_ok FROM unnest(p_keys) k;
    IF random() < 0.01 THEN
        DELETE FROM public.auth_attempts WHERE id IN (SELECT id FROM public.auth_attempts WHERE created_at < NOW() - INTERVAL '2 days' LIMIT 500 FOR UPDATE SKIP LOCKED);
    END IF;
END $$;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.fn_auth_record(text[],text,boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fn_auth_record(text[],text,boolean) TO service_role';
END $$;

-- ------------------------------ 4. CRIAR UTILIZADOR (telemóvel OU email) ------------------------------
-- Mesma assinatura de sempre: p_email agora aceita um TELEMÓVEL ou um email. Todas as funções que já a chamam
-- (admin cria loja, embaixador cria loja/utilizadores, super-admin cria embaixador…) passam a aceitar telemóvel.
CREATE OR REPLACE FUNCTION public.fn_internal_create_store_user(
    p_email TEXT, p_password TEXT, p_full_name TEXT, p_role TEXT, p_store_id TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp AS $$
DECLARE
    v_uid UUID := gen_random_uuid();
    v_login TEXT := public.fn_login_email(p_email);
    v_is_phone BOOLEAN := POSITION('@' IN COALESCE(p_email, '')) = 0;
    v_phone TEXT := CASE WHEN POSITION('@' IN COALESCE(p_email, '')) = 0 THEN LEFT(TRIM(p_email), 30) END;
BEGIN
    IF v_login IS NULL THEN RAISE EXCEPTION 'Indique um telemóvel válido (ou um email válido) para o acesso.'; END IF;
    IF p_password IS NULL OR LENGTH(p_password) < 8 THEN RAISE EXCEPTION 'A palavra-passe deve ter pelo menos 8 caracteres.'; END IF;
    IF p_role NOT IN ('ADMIN', 'GERENTE', 'CASHIER', 'ESTOQUISTA', 'EMBAIXADOR', 'MARKETING', 'LOGISTA') THEN
        RAISE EXCEPTION 'Função inválida para utilizador de loja: %', p_role;
    END IF;
    -- serializa SÓ pedidos do mesmo telemóvel/email (nunca bloqueia cadastros diferentes)
    PERFORM pg_advisory_xact_lock(hashtextextended('login:' || v_login, 0));
    IF EXISTS (SELECT 1 FROM auth.users WHERE LOWER(email) = v_login) THEN
        RAISE EXCEPTION 'Já existe um utilizador com %.', CASE WHEN v_is_phone THEN 'este telemóvel' ELSE 'este email' END;
    END IF;

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        v_login, crypt(p_password, gen_salt('bf')), NOW(),
        '{"provider":"email","providers":["email"]}'::JSONB,
        jsonb_build_object('full_name', TRIM(p_full_name), 'login_kind', CASE WHEN v_is_phone THEN 'phone' ELSE 'email' END),
        NOW(), NOW(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, v_uid::TEXT,
            jsonb_build_object('sub', v_uid::TEXT, 'email', v_login, 'email_verified', TRUE), 'email', NOW(), NOW(), NOW());

    UPDATE public.profiles
       SET email = v_login, full_name = TRIM(p_full_name), role = p_role, store_id = p_store_id, active = TRUE, updated_at = NOW(),
           phone = v_phone, contact_email = CASE WHEN v_is_phone THEN contact_email ELSE v_login END
     WHERE id = v_uid;
    IF NOT FOUND THEN
        INSERT INTO public.profiles (id, email, full_name, role, store_id, active, phone, contact_email)
        VALUES (v_uid, v_login, TRIM(p_full_name), p_role, p_store_id, TRUE, v_phone, CASE WHEN v_is_phone THEN NULL ELSE v_login END);
    END IF;
    RETURN v_uid;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um utilizador com %.', CASE WHEN v_is_phone THEN 'este telemóvel' ELSE 'este email' END;
END $$;
REVOKE ALL ON FUNCTION public.fn_internal_create_store_user(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------ 5. CADASTRO PÚBLICO DA LOJA (link do embaixador) ------------------------------
-- Obrigatórios: nome da loja, nome do responsável, contacto, endereço, palavra-passe.
-- Opcionais: cidade, NUIT/NIF, mensalidade, email (só marketing).
DROP FUNCTION IF EXISTS public.fn_public_ambassador_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_public_store_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.fn_public_store_signup(
    p_referral_code TEXT, p_store_name TEXT, p_owner_name TEXT, p_phone TEXT, p_address TEXT, p_password TEXT,
    p_city TEXT DEFAULT NULL, p_nuit_nif TEXT DEFAULT NULL, p_monthly_fee NUMERIC DEFAULT 0,
    p_marketing_email TEXT DEFAULT NULL, p_email_optin BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp AS $$
DECLARE
    v_amb public.ambassadors%ROWTYPE;
    v_login TEXT := public.fn_login_email(p_phone);
    v_digits TEXT := REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_mail TEXT := NULLIF(LOWER(TRIM(COALESCE(p_marketing_email, ''))), '');
    v_ip TEXT := public.fn_client_ip();
    v_store_id TEXT; v_code TEXT; v_uid UUID; v_old auth.users%ROWTYPE; v_city TEXT;
BEGIN
    -- validações (mensagens curtas, sem revelar nada interno)
    IF char_length(TRIM(COALESCE(p_store_name, ''))) < 2 THEN RAISE EXCEPTION 'Indique o nome da loja.'; END IF;
    IF char_length(TRIM(COALESCE(p_owner_name, ''))) < 2 THEN RAISE EXCEPTION 'Indique o seu nome.'; END IF;
    IF v_login IS NULL OR POSITION('@' IN COALESCE(p_phone, '')) > 0 THEN RAISE EXCEPTION 'Indique um contacto (telemóvel) válido.'; END IF;
    IF char_length(TRIM(COALESCE(p_address, ''))) < 3 THEN RAISE EXCEPTION 'Indique o endereço.'; END IF;
    IF p_password IS NULL OR char_length(p_password) < 8 OR char_length(p_password) > 128 THEN RAISE EXCEPTION 'A palavra-passe deve ter pelo menos 8 caracteres.'; END IF;
    IF p_password ~ '^(.)\1+$' OR REGEXP_REPLACE(p_password, '[^0-9]', '', 'g') = v_digits THEN RAISE EXCEPTION 'Escolha uma palavra-passe mais segura (não use o telemóvel nem caracteres repetidos).'; END IF;
    IF v_mail IS NOT NULL AND (v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR char_length(v_mail) > 120) THEN RAISE EXCEPTION 'Email inválido (pode deixá-lo em branco).'; END IF;

    SELECT * INTO v_amb FROM public.ambassadors
     WHERE UPPER(TRIM(referral_code)) = UPPER(TRIM(p_referral_code))
       AND COALESCE(status, CASE WHEN active THEN 'ATIVO' ELSE 'DESATIVADO' END) = 'ATIVO' LIMIT 1;
    IF v_amb.id IS NULL THEN RAISE EXCEPTION 'Link de embaixador inválido ou inativo.'; END IF;

    -- limites generosos (muitos utilizadores partilham o mesmo IP de operadora móvel): travam só abuso real
    IF v_ip <> 'unknown' AND NOT public.fn_rl_hit('ip:' || v_ip, 'store_signup', 300, 3600) THEN   -- sem IP identificável: não limita (nunca juntar todos num só balde)
        RAISE EXCEPTION 'Demasiadas tentativas deste dispositivo. Tente novamente dentro de alguns minutos.'; END IF;
    IF NOT public.fn_rl_hit('ph:' || v_login, 'store_signup', 20, 86400) THEN RAISE EXCEPTION 'Demasiadas tentativas com este telemóvel. Tente novamente mais tarde.'; END IF;

    -- só pedidos do MESMO telemóvel esperam uns pelos outros (microssegundos); todos os outros correm em paralelo
    PERFORM pg_advisory_xact_lock(hashtextextended('login:' || v_login, 0));

    -- pedido repetido (duplo clique, falha de rede, voltar a enviar): se o telemóvel+palavra-passe coincidem, devolve o mesmo resultado
    SELECT * INTO v_old FROM auth.users WHERE LOWER(email) = v_login LIMIT 1;
    IF v_old.id IS NOT NULL THEN
        IF v_old.encrypted_password = crypt(p_password, v_old.encrypted_password) THEN
            RETURN jsonb_build_object('success', TRUE, 'already', TRUE, 'admin_user_id', v_old.id,
                                      'store_id', (SELECT store_id FROM public.profiles WHERE id = v_old.id));
        END IF;
        RAISE EXCEPTION 'Já existe uma conta com este telemóvel. Use «Entrar».';
    END IF;

    v_store_id := 'store-' || SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 16);
    v_code := 'REF-' || UPPER(SUBSTR(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 8));
    v_city := COALESCE(NULLIF(TRIM(COALESCE(p_city, '')), ''), LEFT(TRIM(p_address), 60));   -- cidade é opcional: usa o endereço

    INSERT INTO public.stores (id, code, name, trade_name, nuit_nif, city, address, phone, email, currency, language, is_headquarters,
                               valor_mensalidade, data_inicio_teste, data_fim_teste, acesso_ativo)
    VALUES (v_store_id, v_code, TRIM(p_store_name), TRIM(p_store_name), NULLIF(TRIM(COALESCE(p_nuit_nif, '')), ''), v_city,
            TRIM(p_address), LEFT(TRIM(p_phone), 30), v_mail, 'MT', 'pt', FALSE,
            GREATEST(COALESCE(p_monthly_fee, 0), 0), NOW(), CURRENT_DATE + 30, TRUE);

    v_uid := public.fn_internal_create_store_user(p_phone, p_password, TRIM(p_owner_name), 'ADMIN', v_store_id);
    UPDATE public.profiles SET contact_email = v_mail, email_optin = (v_mail IS NOT NULL AND COALESCE(p_email_optin, FALSE)) WHERE id = v_uid;

    INSERT INTO public.ambassador_referred_stores (id, store_id, ambassador_id, name, owner_name, phone, city, monthly_fee, payment_status, next_due_date,
                                                   commission_rate, contract_duration_months, months_active, total_commission_earned)
    VALUES (v_store_id, v_store_id, v_amb.id, TRIM(p_store_name), TRIM(p_owner_name), LEFT(TRIM(p_phone), 30), v_city,
            GREATEST(COALESCE(p_monthly_fee, 0), 0), 'PENDENTE', CURRENT_DATE + 30, COALESCE(v_amb.commission_rate, 15), 12, 0, 0);

    RETURN jsonb_build_object('success', TRUE, 'store_id', v_store_id, 'admin_user_id', v_uid);
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma conta com este telemóvel. Use «Entrar».';
END $$;
GRANT EXECUTE ON FUNCTION public.fn_public_store_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, BOOLEAN) TO anon, authenticated;

-- ------------------------------ 6. FIM ------------------------------
-- Depois de executar: Authentication → Providers → Email → «Confirm email» DESLIGADO (já recomendado na v19).
-- Não é necessário configurar SMTP para criar contas nem para entrar.
NOTIFY pgrst, 'reload schema';
