-- ==============================================================================
-- GEF | v19 — (1) Conta de cliente SEM email obrigatório  (2) Limite de tentativas de login
--             (3) Canal EMAIL nas campanhas  (4) Roles MARKETING e LOGISTA + fluxo Encomenda → Logística → Pronta
-- Idempotente. Correr DEPOIS da v18 (migracao_clientes_campanhas_v18.sql). Não apaga nem altera dados existentes.
-- Alterações a funções antigas são feitas por «remendo» do texto da própria função (fn__v19_patch): se o padrão já
-- estiver aplicado não faz nada; se não existir, só avisa (NOTICE) e continua.
-- ==============================================================================

-- ------------------------------ 0. utilitário de remendo (removido no fim) ------------------------------
CREATE OR REPLACE FUNCTION public.fn__v19_patch(p_name TEXT, p_from TEXT, p_to TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; d TEXT;
BEGIN
    FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = p_name LOOP
        d := pg_get_functiondef(r.oid);
        IF position(p_to IN d) > 0 THEN CONTINUE; END IF;
        IF position(p_from IN d) = 0 THEN RAISE NOTICE 'v19: padrão não encontrado em % (ignorado)', p_name; CONTINUE; END IF;
        EXECUTE replace(d, p_from, p_to);
    END LOOP;
END; $$;

-- ------------------------------ 1. LIMITE DE TENTATIVAS (login / criação de conta) ------------------------------
CREATE TABLE IF NOT EXISTS public.auth_attempts (
    id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL, kind TEXT NOT NULL, ok BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_key ON public.auth_attempts(key, kind, created_at DESC);
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_attempts FROM anon, authenticated;

-- segundos de espera (0 = pode tentar). p_only_failed: conta só falhas (login) ou todos os pedidos (criação de conta)
CREATE OR REPLACE FUNCTION public.fn_auth_blocked(p_key TEXT, p_kind TEXT, p_max INT, p_window_s INT, p_only_failed BOOLEAN DEFAULT TRUE) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n INT; v_oldest TIMESTAMPTZ;
BEGIN
    SELECT COUNT(*), MIN(created_at) INTO v_n, v_oldest FROM public.auth_attempts
     WHERE key = p_key AND kind = p_kind AND created_at > NOW() - make_interval(secs => p_window_s) AND (NOT p_only_failed OR NOT ok);
    IF v_n < p_max THEN RETURN 0; END IF;
    RETURN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest + make_interval(secs => p_window_s) - NOW())))::INT);
END; $$;
CREATE OR REPLACE FUNCTION public.fn_auth_record(p_keys TEXT[], p_kind TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO public.auth_attempts (key, kind, ok) SELECT LEFT(k, 120), p_kind, p_ok FROM unnest(p_keys) k;
    IF random() < 0.02 THEN DELETE FROM public.auth_attempts WHERE created_at < NOW() - INTERVAL '2 days'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.fn_auth_clear(p_key TEXT, p_kind TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ DELETE FROM public.auth_attempts WHERE key = p_key AND kind = p_kind AND NOT ok; $$;
DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['fn_auth_blocked(text,text,integer,integer,boolean)','fn_auth_record(text[],text,boolean)','fn_auth_clear(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ------------------------------ 2. CLIENTES: endereço, canal EMAIL ------------------------------
ALTER TABLE public.store_customers ADD COLUMN IF NOT EXISTS address TEXT;

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT c.conrelid::regclass AS t, c.conname FROM pg_constraint c
            WHERE c.contype = 'c' AND c.conrelid IN ('public.customer_consents'::regclass, 'public.campaigns'::regclass)
              AND pg_get_constraintdef(c.oid) LIKE '%WHATSAPP%' AND pg_get_constraintdef(c.oid) NOT LIKE '%EMAIL%' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
END $$;
ALTER TABLE public.customer_consents DROP CONSTRAINT IF EXISTS customer_consents_channel_v19;
ALTER TABLE public.customer_consents ADD CONSTRAINT customer_consents_channel_v19 CHECK (channel IN ('PUSH', 'WHATSAPP', 'EMAIL'));
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_channel_v19;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_channel_v19 CHECK (channel IN ('PUSH', 'WHATSAPP', 'EMAIL'));
-- 'ORDER_READY' = aviso automático «encomenda pronta» (não aparece na lista de promoções nem conta para o limite diário)
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'PROMO';
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_kind_v19;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_kind_v19 CHECK (kind IN ('PROMO', 'ORDER_READY'));

CREATE OR REPLACE FUNCTION public.fn_customer_state(p_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'whatsapp', c.whatsapp, 'email', c.email, 'address', c.address, 'created_at', c.created_at),
        'consents', jsonb_build_object(
            'PUSH', COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = 'PUSH'), FALSE),
            'WHATSAPP', COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = 'WHATSAPP'), FALSE),
            'EMAIL', COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = 'EMAIL'), FALSE)),
        'push_active', EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active),
        'installed', c.pwa_installed_at IS NOT NULL,
        'phone_login', COALESCE((SELECT u.raw_user_meta_data ->> 'login_kind' FROM auth.users u WHERE u.id = c.auth_user_id), '') = 'phone')
    FROM public.store_customers c WHERE c.id = p_id;
$$;
REVOKE ALL ON FUNCTION public.fn_customer_state(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_customer_ensure(p_slug TEXT, p_data JSONB DEFAULT '{}'::JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; u auth.users%ROWTYPE; c public.store_customers%ROWTYPE; m JSONB; v_name TEXT; v_phone TEXT; v_wa TEXT; v_mail TEXT; v_addr TEXT; v_phone_login BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicie sessão.'; END IF;
    s := public.fn_vstore_resolve(p_slug);
    PERFORM public.fn_rate_limit('custens:' || auth.uid()::TEXT, 30, 600);
    SELECT * INTO u FROM auth.users WHERE id = auth.uid();
    -- Só é utilizador do sistema de gestão quem tem perfil activo ou ligado a uma loja (o perfil «vazio» criado pelo trigger não conta)
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = u.id AND (store_id IS NOT NULL OR active)) THEN
        RAISE EXCEPTION 'Este acesso pertence a um utilizador do sistema de gestão. Crie uma conta de cliente com outro contacto.';
    END IF;
    SELECT * INTO c FROM public.store_customers WHERE store_id = s.id AND auth_user_id = u.id;
    IF c.id IS NULL THEN
        m := COALESCE(u.raw_user_meta_data, '{}'::JSONB);
        v_phone_login := COALESCE(m ->> 'login_kind', '') = 'phone';
        v_name := LEFT(btrim(COALESCE(NULLIF(btrim(p_data ->> 'name'), ''), NULLIF(btrim(m ->> 'name'), ''), CASE WHEN v_phone_login THEN 'Cliente' ELSE split_part(u.email, '@', 1) END)), 120);
        IF char_length(v_name) < 2 THEN v_name := 'Cliente'; END IF;
        v_phone := NULLIF(btrim(COALESCE(p_data ->> 'phone', m ->> 'phone', '')), '');
        IF v_phone IS NOT NULL AND char_length(public.fn_digits(v_phone)) NOT BETWEEN 7 AND 15 THEN v_phone := NULL; END IF;
        v_wa := NULLIF(public.fn_digits(COALESCE(p_data ->> 'whatsapp', m ->> 'whatsapp', '')), '');
        IF v_wa IS NOT NULL AND v_wa !~ '^[0-9]{9,15}$' THEN v_wa := NULL; END IF;
        v_addr := NULLIF(LEFT(btrim(COALESCE(p_data ->> 'address', m ->> 'address', '')), 300), '');
        v_mail := CASE WHEN v_phone_login THEN NULLIF(lower(btrim(COALESCE(m ->> 'email', ''))), '') ELSE lower(u.email) END;
        IF v_mail IS NOT NULL AND v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN v_mail := NULL; END IF;
        INSERT INTO public.store_customers (store_id, auth_user_id, name, phone, whatsapp, email, address) VALUES (s.id, u.id, v_name, v_phone, v_wa, v_mail, v_addr)
        ON CONFLICT (store_id, auth_user_id) DO NOTHING RETURNING * INTO c;
        IF c.id IS NULL THEN SELECT * INTO c FROM public.store_customers WHERE store_id = s.id AND auth_user_id = u.id; END IF;
        -- consentimento só se o cliente marcou a caixa (desmarcada por defeito)
        IF v_wa IS NOT NULL AND COALESCE(p_data ->> 'wa_optin', m ->> 'wa_optin') = 'true' THEN
            INSERT INTO public.customer_consents (customer_id, channel, granted, source) VALUES (c.id, 'WHATSAPP', TRUE, 'registo') ON CONFLICT (customer_id, channel) DO NOTHING;
            INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, s.id, 'WHATSAPP', TRUE, 'registo');
        END IF;
        IF v_mail IS NOT NULL AND COALESCE(p_data ->> 'email_optin', m ->> 'email_optin') = 'true' THEN
            INSERT INTO public.customer_consents (customer_id, channel, granted, source) VALUES (c.id, 'EMAIL', TRUE, 'registo') ON CONFLICT (customer_id, channel) DO NOTHING;
            INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, s.id, 'EMAIL', TRUE, 'registo');
        END IF;
    END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

-- Perfil: nome, telefone, WhatsApp, endereço e email (opcional). Substitui fn_customer_update (que fica, sem uso).
CREATE OR REPLACE FUNCTION public.fn_customer_update_v19(p_slug TEXT, p_name TEXT, p_phone TEXT, p_whatsapp TEXT, p_address TEXT, p_email TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; v_name TEXT := regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'); v_phone TEXT := NULLIF(btrim(COALESCE(p_phone, '')), '');
        v_wa TEXT := NULLIF(public.fn_digits(p_whatsapp), ''); v_addr TEXT := NULLIF(LEFT(btrim(COALESCE(p_address, '')), 300), ''); v_mail TEXT := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
BEGIN
    c := public.fn_cust(p_slug);
    PERFORM public.fn_rate_limit('custupd:' || c.id::TEXT, 20, 3600);
    IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN RAISE EXCEPTION 'O nome deve ter entre 2 e 120 caracteres.'; END IF;
    IF v_phone IS NOT NULL AND char_length(public.fn_digits(v_phone)) NOT BETWEEN 7 AND 15 THEN RAISE EXCEPTION 'Telefone inválido.'; END IF;
    IF v_wa IS NOT NULL AND v_wa !~ '^[0-9]{9,15}$' THEN RAISE EXCEPTION 'WhatsApp inválido: indique o número com indicativo (ex.: +258 84 000 0000).'; END IF;
    IF v_mail IS NOT NULL AND (v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR char_length(v_mail) > 120) THEN RAISE EXCEPTION 'Email inválido.'; END IF;
    UPDATE public.store_customers SET name = v_name, phone = v_phone, whatsapp = v_wa, address = v_addr, email = v_mail, updated_at = NOW() WHERE id = c.id;
    IF v_wa IS NULL AND EXISTS (SELECT 1 FROM public.customer_consents WHERE customer_id = c.id AND channel = 'WHATSAPP' AND granted) THEN
        UPDATE public.customer_consents SET granted = FALSE, source = 'numero_removido', updated_at = NOW() WHERE customer_id = c.id AND channel = 'WHATSAPP';
        INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, c.store_id, 'WHATSAPP', FALSE, 'numero_removido');
    END IF;
    IF v_mail IS NULL AND EXISTS (SELECT 1 FROM public.customer_consents WHERE customer_id = c.id AND channel = 'EMAIL' AND granted) THEN
        UPDATE public.customer_consents SET granted = FALSE, source = 'email_removido', updated_at = NOW() WHERE customer_id = c.id AND channel = 'EMAIL';
        INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, c.store_id, 'EMAIL', FALSE, 'email_removido');
    END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_set_consent(p_slug TEXT, p_channel TEXT, p_granted BOOLEAN, p_source TEXT DEFAULT 'area_cliente') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    IF p_channel NOT IN ('PUSH', 'WHATSAPP', 'EMAIL') THEN RAISE EXCEPTION 'Canal inválido.'; END IF;
    IF p_granted AND p_channel = 'WHATSAPP' AND c.whatsapp IS NULL THEN RAISE EXCEPTION 'Indique primeiro o seu número de WhatsApp no perfil.'; END IF;
    IF p_granted AND p_channel = 'EMAIL' AND c.email IS NULL THEN RAISE EXCEPTION 'Indique primeiro o seu email no perfil.'; END IF;
    INSERT INTO public.customer_consents (customer_id, channel, granted, source, updated_at) VALUES (c.id, p_channel, p_granted, LEFT(COALESCE(p_source, 'area_cliente'), 40), NOW())
    ON CONFLICT (customer_id, channel) DO UPDATE SET granted = EXCLUDED.granted, source = EXCLUDED.source, updated_at = NOW();
    INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, c.store_id, p_channel, p_granted, LEFT(COALESCE(p_source, 'area_cliente'), 40));
    IF NOT p_granted AND p_channel = 'PUSH' THEN UPDATE public.push_subscriptions SET active = FALSE WHERE customer_id = c.id; END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

-- Associar compras antigas: por código + telefone (não exige email). Por email só em contas com email real confirmado.
CREATE OR REPLACE FUNCTION public.fn_customer_claim_orders(p_slug TEXT, p_code TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; u auth.users%ROWTYPE; n INT;
BEGIN
    c := public.fn_cust(p_slug);
    SELECT * INTO u FROM auth.users WHERE id = auth.uid();
    PERFORM public.fn_rate_limit('claim:' || auth.uid()::TEXT, 8, 3600);
    IF NULLIF(btrim(p_code), '') IS NOT NULL THEN
        IF char_length(public.fn_digits(p_phone)) < 7 THEN RAISE EXCEPTION 'Indique o telefone usado na compra.'; END IF;
        UPDATE public.web_orders SET customer_id = c.id
         WHERE store_id = c.store_id AND customer_id IS NULL AND upper(code) = upper(btrim(p_code))
           AND right(public.fn_digits(phone), 9) = right(public.fn_digits(p_phone), 9);
    ELSE
        IF COALESCE(u.raw_user_meta_data ->> 'login_kind', '') = 'phone' OR u.email_confirmed_at IS NULL THEN
            RAISE EXCEPTION 'Para associar uma compra indique o código da encomenda e o telefone usado na compra.';
        END IF;
        UPDATE public.web_orders SET customer_id = c.id
         WHERE store_id = c.store_id AND customer_id IS NULL AND email IS NOT NULL AND lower(btrim(email)) = lower(u.email);
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE EXCEPTION 'Não foi possível verificar essa compra. Confirme o código e o telefone.'; END IF;
    RETURN jsonb_build_object('success', TRUE, 'linked', n);
END; $$;

-- o cliente passa a ver se a encomenda está na logística / pronta para entrega
SELECT public.fn__v19_patch('fn_customer_orders', 'o.payment_status, o.total, o.discount_total,', 'o.payment_status, o.fulfillment, o.total, o.discount_total,');
SELECT public.fn__v19_patch('fn_customer_order_get', '''status'', o.status, ''payment_status'', o.payment_status', '''status'', o.status, ''fulfillment'', o.fulfillment, ''ready_at'', o.ready_at, ''payment_status'', o.payment_status');

-- ------------------------------ 3. CAMPANHAS: canal EMAIL ------------------------------
CREATE OR REPLACE FUNCTION public.fn_campaign_audience(p_store TEXT, p_channel TEXT, p_aud JSONB) RETURNS TABLE (customer_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind TEXT := COALESCE(p_aud ->> 'kind', 'all'); v_min INT := LEAST(GREATEST(COALESCE((p_aud ->> 'min_orders')::INT, 3), 1), 1000); v_days INT := LEAST(GREATEST(COALESCE((p_aud ->> 'days')::INT, 90), 1), 3650);
BEGIN
    IF v_kind NOT IN ('all', 'frequent', 'inactive', 'buyers', 'never', 'new') THEN RAISE EXCEPTION 'Grupo de clientes inválido.'; END IF;
    RETURN QUERY
    SELECT c.id FROM public.store_customers c
      JOIN public.customer_consents k ON k.customer_id = c.id AND k.channel = p_channel AND k.granted
      LEFT JOIN LATERAL (SELECT COUNT(*) AS n, MAX(w.created_at) AS last_order FROM public.web_orders w WHERE w.customer_id = c.id AND w.store_id = c.store_id AND w.status <> 'CANCELADA') o ON TRUE
     WHERE c.store_id = p_store
       AND ((p_channel = 'PUSH' AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active))
            OR (p_channel = 'WHATSAPP' AND c.whatsapp IS NOT NULL)
            OR (p_channel = 'EMAIL' AND c.email IS NOT NULL AND c.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
       AND CASE v_kind WHEN 'frequent' THEN o.n >= v_min WHEN 'inactive' THEN o.n > 0 AND o.last_order < NOW() - (v_days || ' days')::INTERVAL
                       WHEN 'buyers' THEN o.n > 0 WHEN 'never' THEN o.n = 0 WHEN 'new' THEN c.created_at >= NOW() - (v_days || ' days')::INTERVAL ELSE TRUE END;
END; $$;
REVOKE ALL ON FUNCTION public.fn_campaign_audience(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

SELECT public.fn__v19_patch('fn_campaign_preview', '(''PUSH'', ''WHATSAPP'')', '(''PUSH'', ''WHATSAPP'', ''EMAIL'')');
SELECT public.fn__v19_patch('fn_campaign_create', '(''PUSH'', ''WHATSAPP'')', '(''PUSH'', ''WHATSAPP'', ''EMAIL'')');
-- avisos automáticos (ORDER_READY) não aparecem na lista de promoções
SELECT public.fn__v19_patch('fn_campaign_list', 'WHERE c.store_id = v_store GROUP BY', 'WHERE c.store_id = v_store AND c.kind = ''PROMO'' GROUP BY');
-- o limite diário só conta promoções
SELECT public.fn__v19_patch('fn_campaign_create', 'WHERE store_id = v_store AND created_at > NOW() - INTERVAL ''24 hours'' AND status <> ''CANCELLED''', 'WHERE store_id = v_store AND kind = ''PROMO'' AND created_at > NOW() - INTERVAL ''24 hours'' AND status <> ''CANCELLED''');

-- lote para envio: acrescenta o email do cliente (as funções de envio existentes ignoram campos a mais)
CREATE OR REPLACE FUNCTION public.fn_campaign_claim_batch(p_id UUID, p_n INT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH ch AS (SELECT id, channel FROM public.campaigns WHERE id = p_id AND status IN ('QUEUED', 'SENDING')),
    pick AS (SELECT r.customer_id FROM public.campaign_recipients r JOIN ch ON ch.id = r.campaign_id
              WHERE r.status = 'PENDING' OR (r.status = 'SENDING' AND r.claimed_at < NOW() - INTERVAL '10 minutes')
              ORDER BY r.customer_id LIMIT LEAST(GREATEST(p_n, 1), 100) FOR UPDATE OF r SKIP LOCKED),
    upd AS (UPDATE public.campaign_recipients r SET status = 'SENDING', claimed_at = NOW() FROM pick WHERE r.campaign_id = p_id AND r.customer_id = pick.customer_id RETURNING r.customer_id)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'email', c.email,
        'consent', COALESCE(k.granted, FALSE),
        'subs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::JSONB) FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active))), '[]'::JSONB)
      FROM upd JOIN public.store_customers c ON c.id = upd.customer_id LEFT JOIN public.customer_consents k ON k.customer_id = c.id AND k.channel = (SELECT channel FROM ch);
$$;
REVOKE ALL ON FUNCTION public.fn_campaign_claim_batch(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_campaign_claim_batch(UUID, INT) TO service_role;

-- ------------------------------ 4. ROLES MARKETING e LOGISTA ------------------------------
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%ESTOQUISTA%' AND pg_get_constraintdef(oid) NOT LIKE '%MARKETING%' LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_v19;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_v19 CHECK (role IN ('SUPERADMIN', 'ADMIN', 'GERENTE', 'CASHIER', 'ESTOQUISTA', 'EMBAIXADOR', 'MARKETING', 'LOGISTA'));

-- o Super Administrador pode criar/editar/listar/repor palavra-passe de utilizadores com as novas funções (vários por função)
SELECT public.fn__v19_patch('fn_internal_create_store_user', '(''ADMIN'', ''GERENTE'', ''CASHIER'', ''ESTOQUISTA'', ''EMBAIXADOR'')', '(''ADMIN'', ''GERENTE'', ''CASHIER'', ''ESTOQUISTA'', ''EMBAIXADOR'', ''MARKETING'', ''LOGISTA'')');
SELECT public.fn__v19_patch(n, '(''ADMIN'', ''GERENTE'', ''CASHIER'', ''ESTOQUISTA'')', '(''ADMIN'', ''GERENTE'', ''CASHIER'', ''ESTOQUISTA'', ''MARKETING'', ''LOGISTA'')')
  FROM unnest(ARRAY['fn_admin_create_store_user', 'fn_admin_update_store_user', 'fn_admin_reset_store_user_password', 'fn_admin_list_store_users']) n;

-- MARKETING: promoções, clientes, campanhas (PWA / WhatsApp / Email), encomendas e comprovativos (só leitura)
SELECT public.fn__v19_patch(n, 'fn_catalog_store_id(ARRAY[''ADMIN'', ''GERENTE''])', 'fn_catalog_store_id(ARRAY[''ADMIN'', ''GERENTE'', ''MARKETING''])')
  FROM unnest(ARRAY['fn_promo_products', 'fn_promo_list', 'fn_promo_save', 'fn_promo_cancel', 'fn_admin_customers', 'fn_admin_customer_orders', 'fn_campaign_preview',
                    'fn_campaign_create', 'fn_campaign_update', 'fn_campaign_list', 'fn_campaign_recipients', 'fn_campaign_cancel', 'fn_store_order_proofs']) n;
SELECT public.fn__v19_patch(n, '''ESTOQUISTA'', ''CASHIER'']', '''ESTOQUISTA'', ''CASHIER'', ''MARKETING'']') FROM unnest(ARRAY['fn_store_orders_list', 'fn_store_order_get']) n;
SELECT public.fn__v19_patch('fn_store_orders_list', 'o.payment_status, o.total, o.created_at,', 'o.payment_status, o.total, o.created_at, o.fulfillment,');

-- comprovativos (bucket privado): MARKETING também pode ver
DO $$ BEGIN
  DROP POLICY IF EXISTS "gef_proofs_select" ON storage.objects;
  CREATE POLICY "gef_proofs_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'payment-proofs' AND (
      EXISTS (SELECT 1 FROM public.store_customers c WHERE c.auth_user_id = auth.uid() AND c.id::TEXT = (storage.foldername(name))[1])
      OR EXISTS (SELECT 1 FROM public.web_orders o WHERE o.id = (storage.foldername(name))[2] AND o.store_id = public.get_auth_user_store_id() AND public.get_auth_user_role() IN ('ADMIN', 'GERENTE', 'MARKETING'))
      OR public.fn_is_superadmin()));
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'Sem permissão para alterar a política do bucket payment-proofs: repita este bloco no SQL Editor.';
END $$;

-- ------------------------------ 5. FLUXO ENCOMENDA → LOGÍSTICA → PRONTA PARA ENTREGA ------------------------------
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS fulfillment TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE public.web_orders DROP CONSTRAINT IF EXISTS web_orders_fulfillment_v19;
ALTER TABLE public.web_orders ADD CONSTRAINT web_orders_fulfillment_v19 CHECK (fulfillment IN ('NONE', 'LOGISTICA', 'PRONTA'));
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS sent_logistics_at TIMESTAMPTZ;
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS sent_logistics_by UUID;
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS sent_logistics_by_name TEXT;
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS ready_by UUID;
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS ready_by_name TEXT;
CREATE INDEX IF NOT EXISTS idx_web_orders_fulfillment ON public.web_orders(store_id, fulfillment) WHERE fulfillment <> 'NONE';

-- Registo de quem fez o quê (identificação do utilizador + função) e «visto» das notificações internas
CREATE TABLE IF NOT EXISTS public.order_events (
    id BIGSERIAL PRIMARY KEY, store_id TEXT NOT NULL, order_id TEXT NOT NULL, order_code TEXT,
    event TEXT NOT NULL CHECK (event IN ('SENT_LOGISTICS', 'READY')),
    actor_id UUID, actor_name TEXT, actor_role TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_store ON public.order_events(store_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.order_events_seen (user_id UUID PRIMARY KEY, seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.order_events FROM anon, authenticated;
ALTER TABLE public.order_events_seen ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.order_events_seen FROM anon, authenticated;

-- MARKETING / ADMIN / GERENTE: envia a encomenda para a logística
CREATE OR REPLACE FUNCTION public.fn_order_send_logistics(p_order_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'MARKETING']); o public.web_orders%ROWTYPE; v_name TEXT; v_role TEXT := public.get_auth_user_role();
BEGIN
    PERFORM public.fn_rate_limit('sendlog:' || auth.uid()::TEXT, 120, 600);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND store_id = v_store FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    IF o.status IN ('CANCELADA', 'ENTREGUE') THEN RAISE EXCEPTION 'Esta encomenda já está % e não pode seguir para a logística.', lower(o.status); END IF;
    IF o.fulfillment <> 'NONE' THEN RAISE EXCEPTION 'Esta encomenda já foi enviada para a logística.'; END IF;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    UPDATE public.web_orders SET fulfillment = 'LOGISTICA', sent_logistics_at = NOW(), sent_logistics_by = auth.uid(), sent_logistics_by_name = v_name,
           status = CASE WHEN status IN ('PENDENTE', 'CONFIRMADA') THEN 'EM_PREPARACAO' ELSE status END, updated_at = NOW() WHERE id = o.id;
    INSERT INTO public.order_events (store_id, order_id, order_code, event, actor_id, actor_name, actor_role) VALUES (v_store, o.id, o.code, 'SENT_LOGISTICS', auth.uid(), v_name, v_role);
    RETURN jsonb_build_object('success', TRUE);
END; $$;

-- LOGISTA (e ADMIN/GERENTE): fila de trabalho com os produtos a separar
CREATE OR REPLACE FUNCTION public.fn_logistics_queue(p_filter TEXT DEFAULT 'todo') RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'LOGISTA', 'MARKETING']);
BEGIN
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.sent_logistics_at DESC) FROM (
        SELECT o.id, o.code, o.status, o.payment_status, o.fulfillment, o.customer_name, o.phone, o.address, o.notes, o.sent_logistics_at, o.sent_logistics_by_name, o.ready_at, o.ready_by_name,
               (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.product_name, 'code', i.product_code, 'unit', i.unit, 'color_name', i.color_name, 'color_hex', i.color_hex, 'quantity', i.quantity) ORDER BY i.id), '[]'::JSONB)
                  FROM public.web_order_items i WHERE i.order_id = o.id) AS items
          FROM public.web_orders o
         WHERE o.store_id = v_store AND o.status <> 'CANCELADA'
           AND ((p_filter = 'prontas' AND o.fulfillment = 'PRONTA' AND o.ready_at > NOW() - INTERVAL '14 days') OR (p_filter <> 'prontas' AND o.fulfillment = 'LOGISTICA'))
         ORDER BY o.sent_logistics_at DESC LIMIT 100) z), '[]'::JSONB);
END; $$;

-- LOGISTA: «Pronta para entrega». Avisa os cargos superiores (notificação interna) e o cliente (campanhas ORDER_READY por cada canal autorizado)
CREATE OR REPLACE FUNCTION public.fn_order_mark_ready(p_order_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'LOGISTA']); o public.web_orders%ROWTYPE; c public.store_customers%ROWTYPE; v_name TEXT; v_role TEXT := public.get_auth_user_role();
        v_ids JSONB := '[]'::JSONB; v_ch TEXT; v_cid UUID; v_msg TEXT; v_ok BOOLEAN;
BEGIN
    PERFORM public.fn_rate_limit('markready:' || auth.uid()::TEXT, 120, 600);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND store_id = v_store FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    IF o.status = 'CANCELADA' THEN RAISE EXCEPTION 'Encomenda cancelada.'; END IF;
    IF o.fulfillment = 'PRONTA' THEN RAISE EXCEPTION 'Esta encomenda já foi marcada como pronta.'; END IF;
    IF o.fulfillment <> 'LOGISTICA' THEN RAISE EXCEPTION 'Esta encomenda ainda não foi enviada para a logística.'; END IF;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    UPDATE public.web_orders SET fulfillment = 'PRONTA', ready_at = NOW(), ready_by = auth.uid(), ready_by_name = v_name, updated_at = NOW() WHERE id = o.id;
    INSERT INTO public.order_events (store_id, order_id, order_code, event, actor_id, actor_name, actor_role) VALUES (v_store, o.id, o.code, 'READY', auth.uid(), v_name, v_role);
    v_msg := 'A sua encomenda ' || o.code || ' está pronta para entrega.';
    IF o.customer_id IS NOT NULL THEN
        SELECT * INTO c FROM public.store_customers WHERE id = o.customer_id;
        FOREACH v_ch IN ARRAY ARRAY['PUSH', 'WHATSAPP', 'EMAIL'] LOOP
            v_ok := COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = v_ch), FALSE)
                AND CASE v_ch WHEN 'PUSH' THEN EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active)
                              WHEN 'WHATSAPP' THEN c.whatsapp IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_integrations WHERE store_id = v_store AND wa_phone_number_id IS NOT NULL AND wa_template_name IS NOT NULL)
                              ELSE c.email IS NOT NULL END;
            IF v_ok THEN
                v_cid := NULL;
                INSERT INTO public.campaigns (store_id, channel, title, body, url, audience, idempotency_key, kind, order_id)
                VALUES (v_store, v_ch, 'Encomenda pronta para entrega', v_msg, NULL, '{}'::JSONB, 'ready:' || o.id || ':' || v_ch, 'ORDER_READY', o.id)
                ON CONFLICT (store_id, idempotency_key) DO NOTHING RETURNING id INTO v_cid;
                IF v_cid IS NOT NULL THEN
                    INSERT INTO public.campaign_recipients (campaign_id, customer_id) VALUES (v_cid, c.id);
                    v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_cid, 'channel', v_ch));
                END IF;
            END IF;
        END LOOP;
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'campaigns', v_ids, 'has_account', o.customer_id IS NOT NULL, 'phone', o.phone, 'message', v_msg);
END; $$;

-- Notificações internas: ADMIN/GERENTE/MARKETING recebem «pronta»; LOGISTA recebe «nova encomenda na logística»
CREATE OR REPLACE FUNCTION public.fn_order_notifications(p_mark_seen BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'MARKETING', 'LOGISTA']); v_role TEXT := public.get_auth_user_role(); v_ev TEXT := CASE WHEN public.get_auth_user_role() = 'LOGISTA' THEN 'SENT_LOGISTICS' ELSE 'READY' END;
        v_seen TIMESTAMPTZ; v_items JSONB; v_unread INT;
BEGIN
    SELECT seen_at INTO v_seen FROM public.order_events_seen WHERE user_id = auth.uid();
    v_seen := COALESCE(v_seen, '-infinity'::TIMESTAMPTZ);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('order_id', e.order_id, 'code', e.order_code, 'event', e.event, 'by', e.actor_name, 'role', e.actor_role, 'at', e.created_at, 'unread', e.created_at > v_seen) ORDER BY e.created_at DESC), '[]'::JSONB),
           COUNT(*) FILTER (WHERE e.created_at > v_seen)
      INTO v_items, v_unread
      FROM (SELECT * FROM public.order_events WHERE store_id = v_store AND event = v_ev AND created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 30) e;
    IF p_mark_seen THEN INSERT INTO public.order_events_seen (user_id, seen_at) VALUES (auth.uid(), NOW()) ON CONFLICT (user_id) DO UPDATE SET seen_at = NOW(); END IF;
    RETURN jsonb_build_object('unread', v_unread, 'items', v_items);
END; $$;

-- Autorização de envio de campanha: MARKETING também; LOGISTA só para avisos automáticos «ORDER_READY»
CREATE OR REPLACE FUNCTION public.fn_campaign_get_for_send(p_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE', 'MARKETING', 'LOGISTA']); c public.campaigns%ROWTYPE; i public.store_integrations%ROWTYPE; s public.stores%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.campaigns WHERE id = p_id AND store_id = v_store;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
    IF public.get_auth_user_role() = 'LOGISTA' AND c.kind <> 'ORDER_READY' THEN RAISE EXCEPTION 'Sem permissão para esta operação.'; END IF;
    IF c.status NOT IN ('QUEUED', 'SENDING') THEN RAISE EXCEPTION 'Esta campanha já não pode ser enviada (estado: %).', c.status; END IF;
    UPDATE public.campaigns SET status = 'SENDING' WHERE id = c.id;
    SELECT * INTO i FROM public.store_integrations WHERE store_id = v_store; SELECT * INTO s FROM public.stores WHERE id = v_store;
    RETURN jsonb_build_object('id', c.id, 'store_id', v_store, 'channel', c.channel, 'title', c.title, 'body', c.body, 'url', c.url, 'slug', s.slug, 'store_name', COALESCE(s.trade_name, s.name),
        'wa_phone_number_id', i.wa_phone_number_id, 'wa_template_name', i.wa_template_name, 'wa_template_lang', i.wa_template_lang);
END; $$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['fn_customer_update_v19(text,text,text,text,text,text)','fn_order_send_logistics(text)','fn_logistics_queue(text)','fn_order_mark_ready(text)','fn_order_notifications(boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.fn__v19_patch(TEXT, TEXT, TEXT);
