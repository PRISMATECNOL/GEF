-- ==============================================================================
-- GEF | CLIENTES DA LOJA, ÁREA DO CLIENTE, CONSENTIMENTOS E CAMPANHAS (v18) — idempotente.
-- Correr DEPOIS de v10, v10_1, v11 e v16. Não altera o ERP (customers, sales, caixa, stock…).
-- Contas de cliente = Supabase Auth. Contactos só visíveis ao próprio cliente e (por RPC) ao ADMIN/GERENTE da sua loja.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.fn_digits(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'); $$;

CREATE TABLE IF NOT EXISTS public.store_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
    phone TEXT CHECK (phone IS NULL OR char_length(public.fn_digits(phone)) BETWEEN 7 AND 15),
    whatsapp TEXT CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{9,15}$'),   -- só dígitos, com indicativo
    email TEXT,
    pwa_installed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, auth_user_id)
);
CREATE INDEX IF NOT EXISTS idx_store_customers_store ON public.store_customers(store_id, created_at DESC);

-- Consentimento actual por canal (nunca implícito: instalar o PWA NÃO cria linhas aqui) + registo de prova
CREATE TABLE IF NOT EXISTS public.customer_consents (
    customer_id UUID NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('PUSH', 'WHATSAPP')),
    granted BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (customer_id, channel)
);
CREATE TABLE IF NOT EXISTS public.customer_consent_log (
    id BIGSERIAL PRIMARY KEY, customer_id UUID NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE, store_id TEXT NOT NULL,
    channel TEXT NOT NULL, granted BOOLEAN NOT NULL, source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    installed BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON public.push_subscriptions(customer_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.store_integrations (
    store_id TEXT PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    wa_phone_number_id TEXT, wa_template_name TEXT, wa_template_lang TEXT NOT NULL DEFAULT 'pt_PT',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()      -- tokens NÃO ficam aqui: só em Supabase Secrets
);
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('PUSH', 'WHATSAPP')),
    title TEXT NOT NULL, body TEXT NOT NULL, url TEXT, audience JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'DONE', 'CANCELLED')),
    idempotency_key TEXT NOT NULL, created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ,
    UNIQUE (store_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_campaigns_store ON public.campaigns(store_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED')),
    error TEXT, provider_id TEXT, claimed_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
    PRIMARY KEY (campaign_id, customer_id)                       -- um cliente nunca recebe a mesma campanha duas vezes
);
CREATE INDEX IF NOT EXISTS idx_camp_rec_pending ON public.campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_camp_rec_provider ON public.campaign_recipients(provider_id) WHERE provider_id IS NOT NULL;

ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.store_customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_web_orders_customer ON public.web_orders(customer_id, created_at DESC);
-- Compra com sessão iniciada fica ligada à conta; convidado continua a funcionar (customer_id NULL)
CREATE OR REPLACE FUNCTION public.fn_web_order_link_customer() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NEW.customer_id IS NULL THEN
        SELECT id INTO NEW.customer_id FROM public.store_customers WHERE store_id = NEW.store_id AND auth_user_id = auth.uid();
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_web_order_link_customer ON public.web_orders;
CREATE TRIGGER trg_web_order_link_customer BEFORE INSERT ON public.web_orders FOR EACH ROW EXECUTE FUNCTION public.fn_web_order_link_customer();

-- RLS: o cliente só lê a própria linha; nada é escrito directamente (só RPC)
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['store_customers','customer_consents','customer_consent_log','push_subscriptions','store_integrations','campaigns','campaign_recipients'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "store_customers_own" ON public.store_customers;
CREATE POLICY "store_customers_own" ON public.store_customers FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
GRANT SELECT ON public.store_customers TO authenticated;
DROP POLICY IF EXISTS "customer_consents_own" ON public.customer_consents;
CREATE POLICY "customer_consents_own" ON public.customer_consents FOR SELECT TO authenticated USING (customer_id IN (SELECT id FROM public.store_customers WHERE auth_user_id = auth.uid()));
GRANT SELECT ON public.customer_consents TO authenticated;

CREATE TABLE IF NOT EXISTS public.order_payment_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT NOT NULL REFERENCES public.web_orders(id) ON DELETE CASCADE, store_id TEXT NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size_bytes INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proofs_order ON public.order_payment_proofs(order_id);
ALTER TABLE public.order_payment_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payment_proofs FROM anon, authenticated;

-- Bucket PRIVADO para comprovativos: o cliente só escreve/lê a sua pasta <cliente>/<encomenda>/; o ADMIN/GERENTE da loja lê (URL assinado)
DO $$ BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('payment-proofs', 'payment-proofs', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 5242880, allowed_mime_types = EXCLUDED.allowed_mime_types;
  DROP POLICY IF EXISTS "gef_proofs_insert" ON storage.objects;
  CREATE POLICY "gef_proofs_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'payment-proofs' AND EXISTS (
      SELECT 1 FROM public.store_customers c JOIN public.web_orders o ON o.customer_id = c.id
       WHERE c.auth_user_id = auth.uid() AND c.id::TEXT = (storage.foldername(name))[1] AND o.id = (storage.foldername(name))[2] AND o.payment_status <> 'PAGO' AND o.status <> 'CANCELADA'));
  DROP POLICY IF EXISTS "gef_proofs_select" ON storage.objects;
  CREATE POLICY "gef_proofs_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'payment-proofs' AND (
      EXISTS (SELECT 1 FROM public.store_customers c WHERE c.auth_user_id = auth.uid() AND c.id::TEXT = (storage.foldername(name))[1])
      OR EXISTS (SELECT 1 FROM public.web_orders o WHERE o.id = (storage.foldername(name))[2] AND o.store_id = public.get_auth_user_store_id() AND public.get_auth_user_role() IN ('ADMIN', 'GERENTE'))
      OR public.fn_is_superadmin()));
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'Sem permissão para criar o bucket/políticas: crie o bucket privado payment-proofs no painel Storage e repita este bloco.';
END $$;

-- ------------------------------ CLIENTE ------------------------------
CREATE OR REPLACE FUNCTION public.fn_cust(p_slug TEXT) RETURNS public.store_customers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; c public.store_customers%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicie sessão.'; END IF;
    s := public.fn_vstore_resolve(p_slug);
    SELECT * INTO c FROM public.store_customers WHERE store_id = s.id AND auth_user_id = auth.uid();
    IF c.id IS NULL THEN RAISE EXCEPTION 'Conta de cliente não encontrada nesta loja.'; END IF;
    RETURN c;
END; $$;
REVOKE ALL ON FUNCTION public.fn_cust(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_customer_state(p_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'whatsapp', c.whatsapp, 'email', c.email, 'created_at', c.created_at),
        'consents', jsonb_build_object(
            'PUSH', COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = 'PUSH'), FALSE),
            'WHATSAPP', COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = 'WHATSAPP'), FALSE)),
        'push_active', EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active),
        'installed', c.pwa_installed_at IS NOT NULL)
    FROM public.store_customers c WHERE c.id = p_id;
$$;
REVOKE ALL ON FUNCTION public.fn_customer_state(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_customer_ensure(p_slug TEXT, p_data JSONB DEFAULT '{}'::JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; u auth.users%ROWTYPE; c public.store_customers%ROWTYPE; m JSONB; v_name TEXT; v_phone TEXT; v_wa TEXT;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicie sessão.'; END IF;
    s := public.fn_vstore_resolve(p_slug);
    PERFORM public.fn_rate_limit('custens:' || auth.uid()::TEXT, 30, 600);
    SELECT * INTO u FROM auth.users WHERE id = auth.uid();
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = u.id) THEN
        RAISE EXCEPTION 'Este email pertence a um utilizador do sistema de gestão. Use outro email para a conta de cliente.';
    END IF;
    SELECT * INTO c FROM public.store_customers WHERE store_id = s.id AND auth_user_id = u.id;
    IF c.id IS NULL THEN
        m := COALESCE(u.raw_user_meta_data, '{}'::JSONB);
        v_name := LEFT(btrim(COALESCE(NULLIF(btrim(p_data ->> 'name'), ''), NULLIF(btrim(m ->> 'name'), ''), split_part(u.email, '@', 1))), 120);
        IF char_length(v_name) < 2 THEN v_name := 'Cliente'; END IF;
        v_phone := NULLIF(btrim(COALESCE(p_data ->> 'phone', m ->> 'phone', '')), '');
        IF v_phone IS NOT NULL AND char_length(public.fn_digits(v_phone)) NOT BETWEEN 7 AND 15 THEN v_phone := NULL; END IF;
        v_wa := NULLIF(public.fn_digits(COALESCE(p_data ->> 'whatsapp', m ->> 'whatsapp', '')), '');
        IF v_wa IS NOT NULL AND v_wa !~ '^[0-9]{9,15}$' THEN v_wa := NULL; END IF;
        INSERT INTO public.store_customers (store_id, auth_user_id, name, phone, whatsapp, email) VALUES (s.id, u.id, v_name, v_phone, v_wa, lower(u.email))
        ON CONFLICT (store_id, auth_user_id) DO NOTHING RETURNING * INTO c;
        IF c.id IS NULL THEN SELECT * INTO c FROM public.store_customers WHERE store_id = s.id AND auth_user_id = u.id; END IF;
        -- só há consentimento se o cliente marcou a caixa (explícita, desmarcada por defeito) ao criar a conta
        IF v_wa IS NOT NULL AND COALESCE(p_data ->> 'wa_optin', m ->> 'wa_optin') = 'true' THEN
            INSERT INTO public.customer_consents (customer_id, channel, granted, source) VALUES (c.id, 'WHATSAPP', TRUE, 'registo') ON CONFLICT (customer_id, channel) DO NOTHING;
            INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, s.id, 'WHATSAPP', TRUE, 'registo');
        END IF;
    END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_me(p_slug TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE; c public.store_customers%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;
    s := public.fn_vstore_resolve(p_slug);
    SELECT * INTO c FROM public.store_customers WHERE store_id = s.id AND auth_user_id = auth.uid();
    IF c.id IS NULL THEN RETURN NULL; END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_update(p_slug TEXT, p_name TEXT, p_phone TEXT, p_whatsapp TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; v_name TEXT := regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'); v_phone TEXT := NULLIF(btrim(COALESCE(p_phone, '')), ''); v_wa TEXT := NULLIF(public.fn_digits(p_whatsapp), '');
BEGIN
    c := public.fn_cust(p_slug);
    IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN RAISE EXCEPTION 'O nome deve ter entre 2 e 120 caracteres.'; END IF;
    IF v_phone IS NOT NULL AND char_length(public.fn_digits(v_phone)) NOT BETWEEN 7 AND 15 THEN RAISE EXCEPTION 'Telefone inválido.'; END IF;
    IF v_wa IS NOT NULL AND v_wa !~ '^[0-9]{9,15}$' THEN RAISE EXCEPTION 'WhatsApp inválido: indique o número com indicativo (ex.: +258 84 000 0000).'; END IF;
    UPDATE public.store_customers SET name = v_name, phone = v_phone, whatsapp = v_wa, updated_at = NOW() WHERE id = c.id;
    IF v_wa IS NULL AND EXISTS (SELECT 1 FROM public.customer_consents WHERE customer_id = c.id AND channel = 'WHATSAPP' AND granted) THEN
        UPDATE public.customer_consents SET granted = FALSE, source = 'numero_removido', updated_at = NOW() WHERE customer_id = c.id AND channel = 'WHATSAPP';
        INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, c.store_id, 'WHATSAPP', FALSE, 'numero_removido');
    END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_set_consent(p_slug TEXT, p_channel TEXT, p_granted BOOLEAN, p_source TEXT DEFAULT 'area_cliente') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    IF p_channel NOT IN ('PUSH', 'WHATSAPP') THEN RAISE EXCEPTION 'Canal inválido.'; END IF;
    IF p_granted AND p_channel = 'WHATSAPP' AND c.whatsapp IS NULL THEN RAISE EXCEPTION 'Indique primeiro o seu número de WhatsApp no perfil.'; END IF;
    INSERT INTO public.customer_consents (customer_id, channel, granted, source, updated_at) VALUES (c.id, p_channel, p_granted, LEFT(COALESCE(p_source, 'area_cliente'), 40), NOW())
    ON CONFLICT (customer_id, channel) DO UPDATE SET granted = EXCLUDED.granted, source = EXCLUDED.source, updated_at = NOW();
    INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (c.id, c.store_id, p_channel, p_granted, LEFT(COALESCE(p_source, 'area_cliente'), 40));
    IF NOT p_granted AND p_channel = 'PUSH' THEN UPDATE public.push_subscriptions SET active = FALSE WHERE customer_id = c.id; END IF;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_push_register(p_slug TEXT, p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_ua TEXT DEFAULT NULL, p_installed BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    IF p_endpoint !~ '^https://' OR char_length(p_endpoint) > 1000 OR COALESCE(p_p256dh, '') = '' OR COALESCE(p_auth, '') = '' THEN RAISE EXCEPTION 'Subscrição inválida.'; END IF;
    INSERT INTO public.push_subscriptions (store_id, customer_id, endpoint, p256dh, auth, installed, user_agent) VALUES (c.store_id, c.id, p_endpoint, p_p256dh, p_auth, COALESCE(p_installed, FALSE), LEFT(p_ua, 200))
    ON CONFLICT (endpoint) DO UPDATE SET store_id = c.store_id, customer_id = c.id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, active = TRUE, installed = EXCLUDED.installed, last_seen = NOW();
    RETURN public.fn_customer_state(c.id);   -- NÃO concede consentimento: isso é um passo explícito à parte
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_push_unregister(p_slug TEXT, p_endpoint TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    UPDATE public.push_subscriptions SET active = FALSE WHERE customer_id = c.id AND endpoint = p_endpoint;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_mark_installed(p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    UPDATE public.store_customers SET pwa_installed_at = COALESCE(pwa_installed_at, NOW()) WHERE id = c.id;
    UPDATE public.push_subscriptions SET installed = TRUE WHERE customer_id = c.id AND active;
    RETURN public.fn_customer_state(c.id);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_orders(p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.created_at DESC) FROM (
        SELECT o.id, o.code, o.created_at, o.status, o.payment_status, o.total, o.discount_total, (SELECT COUNT(*) FROM public.web_order_items i WHERE i.order_id = o.id) AS lines
          FROM public.web_orders o WHERE o.customer_id = c.id AND o.store_id = c.store_id ORDER BY o.created_at DESC LIMIT 100) z), '[]'::JSONB);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_order_get(p_slug TEXT, p_order_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; o public.web_orders%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND customer_id = c.id AND store_id = c.store_id;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    RETURN public.fn_web_order_receipt(o.id) || jsonb_build_object('id', o.id, 'status', o.status, 'payment_status', o.payment_status, 'address', o.address, 'phone', o.phone,
        'proofs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('created_at', p.created_at, 'mime', p.mime) ORDER BY p.created_at DESC), '[]'::JSONB) FROM public.order_payment_proofs p WHERE p.order_id = o.id));
END; $$;

-- Comprovativo de pagamento: o ficheiro já foi enviado ao bucket privado; aqui valida-se e regista-se (1 passo para o cliente)
CREATE OR REPLACE FUNCTION public.fn_customer_submit_proof(p_slug TEXT, p_order_id TEXT, p_path TEXT, p_mime TEXT, p_size INT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; o public.web_orders%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    PERFORM public.fn_rate_limit('proof:' || c.id::TEXT, 20, 3600);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND customer_id = c.id AND store_id = c.store_id;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    IF o.status = 'CANCELADA' OR o.payment_status = 'PAGO' THEN RAISE EXCEPTION 'Esta encomenda já não aceita comprovativos.'; END IF;
    IF p_mime NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') OR p_size IS NULL OR p_size <= 0 OR p_size > 5242880 THEN RAISE EXCEPTION 'Ficheiro inválido (JPG, PNG, WEBP ou PDF até 5 MB).'; END IF;
    IF p_path !~ ('^' || c.id::TEXT || '/' || o.id || '/[A-Za-z0-9._-]{1,80}$') THEN RAISE EXCEPTION 'Caminho do ficheiro inválido.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-proofs' AND name = p_path) THEN RAISE EXCEPTION 'O ficheiro não foi enviado. Tente novamente.'; END IF;
    IF (SELECT COUNT(*) FROM public.order_payment_proofs WHERE order_id = o.id) >= 5 THEN RAISE EXCEPTION 'Limite de 5 comprovativos por encomenda.'; END IF;
    INSERT INTO public.order_payment_proofs (order_id, store_id, customer_id, path, mime, size_bytes) VALUES (o.id, o.store_id, c.id, p_path, p_mime, p_size) ON CONFLICT (path) DO NOTHING;
    UPDATE public.web_orders SET payment_status = 'COMPROVATIVO_ENVIADO', updated_at = NOW() WHERE id = o.id AND payment_status = 'NAO_PAGO';
    RETURN jsonb_build_object('success', TRUE, 'payment_status', (SELECT payment_status FROM public.web_orders WHERE id = o.id));
END; $$;
CREATE OR REPLACE FUNCTION public.fn_store_order_proofs(p_order_id TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']);
BEGIN
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('path', p.path, 'mime', p.mime, 'created_at', p.created_at) ORDER BY p.created_at DESC) FROM public.order_payment_proofs p WHERE p.order_id = p_order_id AND p.store_id = v_store), '[]'::JSONB);
END; $$;

-- Associar compras antigas SÓ após verificação: email confirmado + (código da encomenda + telefone da compra) ou email igual ao da compra
CREATE OR REPLACE FUNCTION public.fn_customer_claim_orders(p_slug TEXT, p_code TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; u auth.users%ROWTYPE; n INT;
BEGIN
    c := public.fn_cust(p_slug);
    SELECT * INTO u FROM auth.users WHERE id = auth.uid();
    IF u.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirme primeiro o seu email (link enviado ao criar a conta).'; END IF;
    PERFORM public.fn_rate_limit('claim:' || auth.uid()::TEXT, 8, 3600);
    IF NULLIF(btrim(p_code), '') IS NOT NULL THEN
        IF char_length(public.fn_digits(p_phone)) < 7 THEN RAISE EXCEPTION 'Indique o telefone usado na compra.'; END IF;
        UPDATE public.web_orders SET customer_id = c.id
         WHERE store_id = c.store_id AND customer_id IS NULL AND upper(code) = upper(btrim(p_code))
           AND right(public.fn_digits(phone), 9) = right(public.fn_digits(p_phone), 9);
    ELSE
        UPDATE public.web_orders SET customer_id = c.id
         WHERE store_id = c.store_id AND customer_id IS NULL AND email IS NOT NULL AND lower(btrim(email)) = lower(u.email);
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE EXCEPTION 'Não foi possível verificar essa compra. Confirme o código e o telefone, ou o email usado na compra.'; END IF;
    RETURN jsonb_build_object('success', TRUE, 'linked', n);
END; $$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['fn_customer_ensure(text,jsonb)','fn_customer_me(text)','fn_customer_update(text,text,text,text)','fn_customer_set_consent(text,text,boolean,text)',
    'fn_customer_push_register(text,text,text,text,text,boolean)','fn_customer_push_unregister(text,text)','fn_customer_mark_installed(text)','fn_customer_orders(text)',
    'fn_customer_order_get(text,text)','fn_customer_claim_orders(text,text,text)','fn_customer_submit_proof(text,text,text,text,integer)','fn_store_order_proofs(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ------------------------------ ADMINISTRADOR: CLIENTES ------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_customers(p_q TEXT DEFAULT NULL, p_filter TEXT DEFAULT 'all', p_limit INT DEFAULT 50, p_offset INT DEFAULT 0) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); v_q TEXT := public.fn_norm(COALESCE(p_q, '')); v_rows JSONB; v_total INT;
BEGIN
    WITH o AS (SELECT customer_id, public.fn_digits(phone) AS ph, total, created_at, customer_name, phone, email FROM public.web_orders WHERE store_id = v_store AND status <> 'CANCELADA'),
    acc AS (
        SELECT c.id, c.name, c.phone, c.whatsapp, c.email, c.created_at, TRUE AS has_account,
               (c.pwa_installed_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.installed)) AS installed,
               COALESCE((SELECT granted FROM public.customer_consents k WHERE k.customer_id = c.id AND k.channel = 'PUSH'), FALSE) AS push_consent,
               COALESCE((SELECT granted FROM public.customer_consents k WHERE k.customer_id = c.id AND k.channel = 'WHATSAPP'), FALSE) AS wa_consent,
               EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active) AS push_active,
               COALESCE(a.n, 0) AS orders, COALESCE(a.t, 0) AS spent, a.last_order
          FROM public.store_customers c LEFT JOIN LATERAL (SELECT COUNT(*) AS n, SUM(total) AS t, MAX(created_at) AS last_order FROM o WHERE o.customer_id = c.id) a ON TRUE WHERE c.store_id = v_store),
    gst AS (
        SELECT NULL::UUID AS id, MAX(customer_name) AS name, MAX(phone) AS phone, NULL::TEXT AS whatsapp, MAX(email) AS email, MIN(created_at) AS created_at, FALSE AS has_account,
               FALSE AS installed, FALSE AS push_consent, FALSE AS wa_consent, FALSE AS push_active, COUNT(*) AS orders, SUM(total) AS spent, MAX(created_at) AS last_order
          FROM o WHERE customer_id IS NULL GROUP BY ph),
    x AS (SELECT * FROM acc UNION ALL SELECT * FROM gst),
    f AS (SELECT * FROM x WHERE (v_q = '' OR public.fn_norm(COALESCE(name, '') || ' ' || COALESCE(phone, '') || ' ' || COALESCE(whatsapp, '') || ' ' || COALESCE(email, '')) LIKE '%' || v_q || '%')
            AND CASE p_filter WHEN 'accounts' THEN has_account WHEN 'guests' THEN NOT has_account WHEN 'installed' THEN installed WHEN 'push' THEN push_consent
                              WHEN 'whatsapp' THEN wa_consent WHEN 'consent' THEN (push_consent OR wa_consent) WHEN 'buyers' THEN orders > 0 WHEN 'never' THEN has_account AND orders = 0 ELSE TRUE END)
    SELECT (SELECT COUNT(*) FROM f), COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM f ORDER BY COALESCE(last_order, created_at) DESC NULLS LAST LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)) r), '[]'::JSONB)
      INTO v_total, v_rows;
    RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_admin_customer_orders(p_customer UUID, p_phone TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']);
BEGIN
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.created_at DESC) FROM (
        SELECT o.id, o.code, o.created_at, o.status, o.payment_status, o.total, o.discount_total FROM public.web_orders o
         WHERE o.store_id = v_store AND ((p_customer IS NOT NULL AND o.customer_id = p_customer)
               OR (p_customer IS NULL AND o.customer_id IS NULL AND public.fn_digits(o.phone) = public.fn_digits(p_phone)))
         ORDER BY o.created_at DESC LIMIT 100) z), '[]'::JSONB);
END; $$;

-- ------------------------------ INTEGRAÇÃO WHATSAPP (config não secreta) ------------------------------
CREATE OR REPLACE FUNCTION public.fn_integration_get() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']);
BEGIN
    RETURN COALESCE((SELECT jsonb_build_object('wa_phone_number_id', wa_phone_number_id, 'wa_template_name', wa_template_name, 'wa_template_lang', wa_template_lang) FROM public.store_integrations WHERE store_id = v_store), '{}'::JSONB);
END; $$;
CREATE OR REPLACE FUNCTION public.fn_integration_save(p_phone_number_id TEXT, p_template TEXT, p_lang TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN']);
BEGIN
    IF COALESCE(p_phone_number_id, '') !~ '^[0-9]{5,30}$' THEN RAISE EXCEPTION 'O Phone Number ID da Meta deve ter só dígitos.'; END IF;
    IF COALESCE(p_template, '') !~ '^[a-z0-9_]{1,512}$' THEN RAISE EXCEPTION 'Nome de modelo inválido (minúsculas, números e _).'; END IF;
    IF COALESCE(p_lang, '') !~ '^[a-z]{2}(_[A-Z]{2})?$' THEN RAISE EXCEPTION 'Idioma do modelo inválido (ex.: pt_PT).'; END IF;
    INSERT INTO public.store_integrations (store_id, wa_phone_number_id, wa_template_name, wa_template_lang) VALUES (v_store, p_phone_number_id, p_template, p_lang)
    ON CONFLICT (store_id) DO UPDATE SET wa_phone_number_id = EXCLUDED.wa_phone_number_id, wa_template_name = EXCLUDED.wa_template_name, wa_template_lang = EXCLUDED.wa_template_lang, updated_at = NOW();
    RETURN jsonb_build_object('success', TRUE);
END; $$;

-- ------------------------------ CAMPANHAS ------------------------------
-- Limites (ALTERAR AQUI): campanhas por loja/dia, destinatários por campanha
CREATE OR REPLACE FUNCTION public.fn_campaign_limits() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$ SELECT '{"per_day":5,"max_push":5000,"max_whatsapp":1000}'::JSONB; $$;

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
       AND ((p_channel = 'PUSH' AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active)) OR (p_channel = 'WHATSAPP' AND c.whatsapp IS NOT NULL))
       AND CASE v_kind WHEN 'frequent' THEN o.n >= v_min WHEN 'inactive' THEN o.n > 0 AND o.last_order < NOW() - (v_days || ' days')::INTERVAL
                       WHEN 'buyers' THEN o.n > 0 WHEN 'never' THEN o.n = 0 WHEN 'new' THEN c.created_at >= NOW() - (v_days || ' days')::INTERVAL ELSE TRUE END;
END; $$;
REVOKE ALL ON FUNCTION public.fn_campaign_audience(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_campaign_preview(p_channel TEXT, p_aud JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); v_el INT; v_cfg JSONB;
BEGIN
    IF p_channel NOT IN ('PUSH', 'WHATSAPP') THEN RAISE EXCEPTION 'Canal inválido.'; END IF;
    SELECT COUNT(*) INTO v_el FROM public.fn_campaign_audience(v_store, p_channel, COALESCE(p_aud, '{}'::JSONB));
    SELECT to_jsonb(i) INTO v_cfg FROM (SELECT (wa_phone_number_id IS NOT NULL AND wa_template_name IS NOT NULL) AS wa_configured FROM public.store_integrations WHERE store_id = v_store) i;
    RETURN jsonb_build_object('eligible', v_el,
        'accounts', (SELECT COUNT(*) FROM public.store_customers WHERE store_id = v_store),
        'with_consent', (SELECT COUNT(*) FROM public.customer_consents k JOIN public.store_customers c ON c.id = k.customer_id WHERE c.store_id = v_store AND k.channel = p_channel AND k.granted),
        'wa_configured', COALESCE(v_cfg ->> 'wa_configured', 'false') = 'true', 'limits', public.fn_campaign_limits());
END; $$;

CREATE OR REPLACE FUNCTION public.fn_campaign_create(p_channel TEXT, p_title TEXT, p_body TEXT, p_url TEXT, p_aud JSONB, p_idem TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); v_title TEXT := regexp_replace(btrim(COALESCE(p_title, '')), '\s+', ' ', 'g'); v_body TEXT := regexp_replace(btrim(COALESCE(p_body, '')), '\s+', ' ', 'g');
        v_url TEXT := NULLIF(btrim(COALESCE(p_url, '')), ''); v_lim JSONB := public.fn_campaign_limits(); v_n INT; v_id UUID; v_ex UUID;
BEGIN
    PERFORM public.fn_rate_limit('campcreate:' || v_store, 20, 600);
    IF p_channel NOT IN ('PUSH', 'WHATSAPP') THEN RAISE EXCEPTION 'Canal inválido.'; END IF;
    IF p_idem IS NULL OR char_length(p_idem) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'Pedido inválido (chave em falta).'; END IF;
    SELECT id INTO v_ex FROM public.campaigns WHERE store_id = v_store AND idempotency_key = p_idem;
    IF v_ex IS NOT NULL THEN RETURN jsonb_build_object('success', TRUE, 'duplicate', TRUE, 'id', v_ex); END IF;
    IF char_length(v_title) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'O título deve ter entre 2 e 60 caracteres.'; END IF;
    IF char_length(v_body) NOT BETWEEN 2 AND CASE p_channel WHEN 'PUSH' THEN 240 ELSE 500 END THEN RAISE EXCEPTION 'A mensagem deve ter entre 2 e % caracteres.', CASE p_channel WHEN 'PUSH' THEN 240 ELSE 500 END; END IF;
    IF v_url IS NOT NULL AND (v_url !~ '^https://[^[:space:]]+$' OR char_length(v_url) > 500) THEN RAISE EXCEPTION 'O link deve começar por https:// e não ter espaços.'; END IF;
    IF p_channel = 'WHATSAPP' AND NOT EXISTS (SELECT 1 FROM public.store_integrations WHERE store_id = v_store AND wa_phone_number_id IS NOT NULL AND wa_template_name IS NOT NULL) THEN
        RAISE EXCEPTION 'Configure primeiro a integração WhatsApp (Phone Number ID e modelo aprovado).'; END IF;
    IF (SELECT COUNT(*) FROM public.campaigns WHERE store_id = v_store AND created_at > NOW() - INTERVAL '24 hours' AND status <> 'CANCELLED') >= (v_lim ->> 'per_day')::INT THEN
        RAISE EXCEPTION 'Limite diário de campanhas atingido (%).', v_lim ->> 'per_day'; END IF;
    SELECT COUNT(*) INTO v_n FROM public.fn_campaign_audience(v_store, p_channel, COALESCE(p_aud, '{}'::JSONB));
    IF v_n = 0 THEN RAISE EXCEPTION 'Nenhum cliente elegível (só recebem os que autorizaram este canal).'; END IF;
    IF v_n > (v_lim ->> CASE p_channel WHEN 'PUSH' THEN 'max_push' ELSE 'max_whatsapp' END)::INT THEN RAISE EXCEPTION 'Demasiados destinatários (%). Escolha um grupo mais pequeno.', v_n; END IF;
    BEGIN
        INSERT INTO public.campaigns (store_id, channel, title, body, url, audience, idempotency_key) VALUES (v_store, p_channel, v_title, v_body, v_url, COALESCE(p_aud, '{}'::JSONB), p_idem) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_ex FROM public.campaigns WHERE store_id = v_store AND idempotency_key = p_idem;
        RETURN jsonb_build_object('success', TRUE, 'duplicate', TRUE, 'id', v_ex);
    END;
    INSERT INTO public.campaign_recipients (campaign_id, customer_id) SELECT v_id, a.customer_id FROM public.fn_campaign_audience(v_store, p_channel, COALESCE(p_aud, '{}'::JSONB)) a;
    RETURN jsonb_build_object('success', TRUE, 'duplicate', FALSE, 'id', v_id, 'recipients', v_n);
END; $$;

-- EDITAR campanha: só enquanto ainda nada foi enviado (QUEUED, todos PENDING). O público é recalculado com o consentimento actual.
CREATE OR REPLACE FUNCTION public.fn_campaign_update(p_id UUID, p_title TEXT, p_body TEXT, p_url TEXT, p_aud JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); c public.campaigns%ROWTYPE; v_title TEXT := regexp_replace(btrim(COALESCE(p_title, '')), '\s+', ' ', 'g'); v_body TEXT := regexp_replace(btrim(COALESCE(p_body, '')), '\s+', ' ', 'g');
        v_url TEXT := NULLIF(btrim(COALESCE(p_url, '')), ''); v_lim JSONB := public.fn_campaign_limits(); v_n INT;
BEGIN
    SELECT * INTO c FROM public.campaigns WHERE id = p_id AND store_id = v_store FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
    IF c.status <> 'QUEUED' OR EXISTS (SELECT 1 FROM public.campaign_recipients WHERE campaign_id = c.id AND status <> 'PENDING') THEN RAISE EXCEPTION 'Esta campanha já começou a ser enviada e não pode ser editada. Cancele-a e crie outra.'; END IF;
    IF char_length(v_title) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'O título deve ter entre 2 e 60 caracteres.'; END IF;
    IF char_length(v_body) NOT BETWEEN 2 AND CASE c.channel WHEN 'PUSH' THEN 240 ELSE 500 END THEN RAISE EXCEPTION 'A mensagem deve ter entre 2 e % caracteres.', CASE c.channel WHEN 'PUSH' THEN 240 ELSE 500 END; END IF;
    IF v_url IS NOT NULL AND (v_url !~ '^https://[^[:space:]]+$' OR char_length(v_url) > 500) THEN RAISE EXCEPTION 'O link deve começar por https:// e não ter espaços.'; END IF;
    SELECT COUNT(*) INTO v_n FROM public.fn_campaign_audience(v_store, c.channel, COALESCE(p_aud, '{}'::JSONB));
    IF v_n = 0 THEN RAISE EXCEPTION 'Nenhum cliente elegível (só recebem os que autorizaram este canal).'; END IF;
    IF v_n > (v_lim ->> CASE c.channel WHEN 'PUSH' THEN 'max_push' ELSE 'max_whatsapp' END)::INT THEN RAISE EXCEPTION 'Demasiados destinatários (%). Escolha um grupo mais pequeno.', v_n; END IF;
    DELETE FROM public.campaign_recipients WHERE campaign_id = c.id;
    UPDATE public.campaigns SET title = v_title, body = v_body, url = v_url, audience = COALESCE(p_aud, '{}'::JSONB) WHERE id = c.id;
    INSERT INTO public.campaign_recipients (campaign_id, customer_id) SELECT c.id, a.customer_id FROM public.fn_campaign_audience(v_store, c.channel, COALESCE(p_aud, '{}'::JSONB)) a;
    RETURN jsonb_build_object('success', TRUE, 'id', c.id, 'recipients', v_n);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_campaign_list() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']);
BEGIN
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.created_at DESC) FROM (
        SELECT c.id, c.channel, c.title, c.body, c.url, c.audience, c.status, c.created_at, c.finished_at,
               COUNT(r.*) AS total, COUNT(*) FILTER (WHERE r.status IN ('SENT', 'DELIVERED', 'READ')) AS sent, COUNT(*) FILTER (WHERE r.status IN ('DELIVERED', 'READ')) AS delivered,
               COUNT(*) FILTER (WHERE r.status = 'READ') AS read, COUNT(*) FILTER (WHERE r.status = 'FAILED') AS failed, COUNT(*) FILTER (WHERE r.status = 'SKIPPED') AS skipped,
               COUNT(*) FILTER (WHERE r.status IN ('PENDING', 'SENDING')) AS pending
          FROM public.campaigns c LEFT JOIN public.campaign_recipients r ON r.campaign_id = c.id WHERE c.store_id = v_store GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50) z), '[]'::JSONB);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_campaign_recipients(p_id UUID, p_status TEXT DEFAULT 'FAILED') RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']);
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = p_id AND store_id = v_store) THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('name', c.name, 'whatsapp', c.whatsapp, 'email', c.email, 'status', r.status, 'error', r.error, 'sent_at', r.sent_at))
        FROM (SELECT * FROM public.campaign_recipients WHERE campaign_id = p_id AND (p_status IS NULL OR status = p_status) LIMIT 200) r JOIN public.store_customers c ON c.id = r.customer_id), '[]'::JSONB);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_campaign_cancel(p_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); n INT;
BEGIN
    UPDATE public.campaigns SET status = 'CANCELLED', finished_at = NOW() WHERE id = p_id AND store_id = v_store AND status IN ('QUEUED', 'SENDING');
    GET DIAGNOSTICS n = ROW_COUNT; IF n = 0 THEN RAISE EXCEPTION 'Campanha não encontrada ou já concluída.'; END IF;
    UPDATE public.campaign_recipients SET status = 'SKIPPED', error = 'Campanha cancelada' WHERE campaign_id = p_id AND status = 'PENDING';
    RETURN jsonb_build_object('success', TRUE);
END; $$;

-- Autorização do envio (chamada pela Edge Function com o JWT do administrador)
CREATE OR REPLACE FUNCTION public.fn_campaign_get_for_send(p_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); c public.campaigns%ROWTYPE; i public.store_integrations%ROWTYPE; s public.stores%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.campaigns WHERE id = p_id AND store_id = v_store;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada.'; END IF;
    IF c.status NOT IN ('QUEUED', 'SENDING') THEN RAISE EXCEPTION 'Esta campanha já não pode ser enviada (estado: %).', c.status; END IF;
    UPDATE public.campaigns SET status = 'SENDING' WHERE id = c.id;
    SELECT * INTO i FROM public.store_integrations WHERE store_id = v_store; SELECT * INTO s FROM public.stores WHERE id = v_store;
    RETURN jsonb_build_object('id', c.id, 'store_id', v_store, 'channel', c.channel, 'title', c.title, 'body', c.body, 'url', c.url, 'slug', s.slug, 'store_name', COALESCE(s.trade_name, s.name),
        'wa_phone_number_id', i.wa_phone_number_id, 'wa_template_name', i.wa_template_name, 'wa_template_lang', i.wa_template_lang);
END; $$;

-- Funções só para a Edge Function (service_role)
CREATE OR REPLACE FUNCTION public.fn_campaign_claim_batch(p_id UUID, p_n INT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH ch AS (SELECT id, channel FROM public.campaigns WHERE id = p_id AND status IN ('QUEUED', 'SENDING')),
    pick AS (SELECT r.customer_id FROM public.campaign_recipients r JOIN ch ON ch.id = r.campaign_id
              WHERE r.status = 'PENDING' OR (r.status = 'SENDING' AND r.claimed_at < NOW() - INTERVAL '10 minutes')
              ORDER BY r.customer_id LIMIT LEAST(GREATEST(p_n, 1), 100) FOR UPDATE OF r SKIP LOCKED),
    upd AS (UPDATE public.campaign_recipients r SET status = 'SENDING', claimed_at = NOW() FROM pick WHERE r.campaign_id = p_id AND r.customer_id = pick.customer_id RETURNING r.customer_id)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'whatsapp', c.whatsapp,
        'consent', COALESCE(k.granted, FALSE),
        'subs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::JSONB) FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active))), '[]'::JSONB)
      FROM upd JOIN public.store_customers c ON c.id = upd.customer_id LEFT JOIN public.customer_consents k ON k.customer_id = c.id AND k.channel = (SELECT channel FROM ch);
$$;
CREATE OR REPLACE FUNCTION public.fn_campaign_mark(p_id UUID, p_customer UUID, p_status TEXT, p_provider TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE public.campaign_recipients SET status = p_status, provider_id = p_provider, error = LEFT(p_error, 300), sent_at = NOW()
     WHERE campaign_id = p_id AND customer_id = p_customer AND status = 'SENDING' AND p_status IN ('SENT', 'FAILED', 'SKIPPED');
$$;
CREATE OR REPLACE FUNCTION public.fn_campaign_finish(p_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_left INT;
BEGIN
    SELECT COUNT(*) INTO v_left FROM public.campaign_recipients WHERE campaign_id = p_id AND status IN ('PENDING', 'SENDING');
    IF v_left = 0 THEN UPDATE public.campaigns SET status = 'DONE', finished_at = NOW() WHERE id = p_id AND status IN ('QUEUED', 'SENDING'); END IF;
    RETURN jsonb_build_object('remaining', v_left);
END; $$;
CREATE OR REPLACE FUNCTION public.fn_push_deactivate(p_endpoint TEXT) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ UPDATE public.push_subscriptions SET active = FALSE WHERE endpoint = p_endpoint; $$;
CREATE OR REPLACE FUNCTION public.fn_wa_status(p_provider TEXT, p_status TEXT, p_error TEXT DEFAULT NULL) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE public.campaign_recipients SET status = p_status, error = COALESCE(LEFT(p_error, 300), error)
     WHERE provider_id = p_provider AND p_status IN ('DELIVERED', 'READ', 'FAILED')
       AND (CASE status WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 0 END) < (CASE p_status WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 4 END);
$$;
-- «PARAR» recebido por WhatsApp: retira o consentimento desse número nessa loja
CREATE OR REPLACE FUNCTION public.fn_wa_optout(p_phone_number_id TEXT, p_from TEXT) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT := 0; r RECORD;
BEGIN
    FOR r IN SELECT c.id, c.store_id FROM public.store_customers c JOIN public.store_integrations i ON i.store_id = c.store_id
              WHERE i.wa_phone_number_id = p_phone_number_id AND c.whatsapp = public.fn_digits(p_from) LOOP
        UPDATE public.customer_consents SET granted = FALSE, source = 'whatsapp_parar', updated_at = NOW() WHERE customer_id = r.id AND channel = 'WHATSAPP' AND granted;
        IF FOUND THEN INSERT INTO public.customer_consent_log (customer_id, store_id, channel, granted, source) VALUES (r.id, r.store_id, 'WHATSAPP', FALSE, 'whatsapp_parar'); n := n + 1; END IF;
    END LOOP;
    RETURN n;
END; $$;
CREATE OR REPLACE FUNCTION public.fn_wa_store_for_phone_id(p_phone_number_id TEXT) RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT store_id FROM public.store_integrations WHERE wa_phone_number_id = p_phone_number_id; $$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY['fn_campaign_claim_batch(uuid,integer)','fn_campaign_mark(uuid,uuid,text,text,text)','fn_campaign_finish(uuid)','fn_push_deactivate(text)','fn_wa_status(text,text,text)','fn_wa_optout(text,text)','fn_wa_store_for_phone_id(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['fn_admin_customers(text,text,integer,integer)','fn_admin_customer_orders(uuid,text)','fn_integration_get()','fn_integration_save(text,text,text)','fn_campaign_preview(text,jsonb)',
    'fn_campaign_create(text,text,text,text,jsonb,text)','fn_campaign_update(uuid,text,text,text,jsonb)','fn_campaign_list()','fn_campaign_recipients(uuid,text)','fn_campaign_cancel(uuid)','fn_campaign_get_for_send(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
