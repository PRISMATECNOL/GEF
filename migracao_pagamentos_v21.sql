-- ==============================================================================
-- GEF | v21 — Pagamentos da loja virtual, miniaturas, instruções de pagamento e avisos
-- Instalar DEPOIS da v20. Idempotente (pode repetir). Não altera funções antigas por «remendo»,
-- excepto fn_customer_submit_proof (1 linha, protegida: se o padrão não existir, só dá um aviso).
--
--  1. Estado do pagamento passa a ter também «REJEITADO» (recusado).
--     Mostrado ao cliente como: Pagamento validado | Pagamento pendente | Pagamento recusado.
--  2. Miniaturas dos produtos no recibo/lista de compras do cliente (mesmas imagens do catálogo).
--  3. Instruções de pagamento e contas, editáveis pelo Administrador/Gerente (por loja).
--  4. fn_store_order_set_payment: valida/recusa o pagamento e cria o aviso ao cliente (PUSH/WhatsApp/Email).
--  5. Notificações PWA: quem tem a aplicação instalada e subscrição ACTIVA no dispositivo
--     (aceitou o pedido de permissão do sistema) passa a receber as campanhas directamente.
-- ==============================================================================

-- ------------------------------ 1. ESTADO DO PAGAMENTO ------------------------------
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'public.web_orders'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%payment_status%' LOOP
        EXECUTE format('ALTER TABLE public.web_orders DROP CONSTRAINT %I', r.conname);
    END LOOP;
    ALTER TABLE public.web_orders ADD CONSTRAINT web_orders_payment_status_v21
        CHECK (payment_status IN ('NAO_PAGO', 'COMPROVATIVO_ENVIADO', 'PAGO', 'REJEITADO'));
END $$;

ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS payment_note TEXT;                 -- motivo da recusa (visível ao cliente)
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS payment_reviewed_at TIMESTAMPTZ;
ALTER TABLE public.web_orders ADD COLUMN IF NOT EXISTS payment_reviewed_by_name TEXT;

-- avisos automáticos de pagamento (não aparecem na lista de promoções nem contam para o limite diário)
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_kind_v19;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_kind_v21;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_kind_v21 CHECK (kind IN ('PROMO', 'ORDER_READY', 'PAYMENT'));

-- ------------------------------ 2. MINIATURAS ------------------------------
CREATE OR REPLACE FUNCTION public.fn_order_item_thumb(p_product TEXT, p_color UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(
        (SELECT COALESCE(x.thumb_path, x.path) FROM public.product_colors c JOIN public.product_images x ON x.id = c.image_id
          WHERE p_color IS NOT NULL AND c.id = p_color LIMIT 1),
        (SELECT COALESCE(x.thumb_path, x.path) FROM public.product_images x WHERE x.product_id = p_product
          ORDER BY x.is_main DESC, x.sort_order, x.created_at LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.fn_order_item_thumb(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Recibo: igual ao da v16 + product_id e miniatura por linha
CREATE OR REPLACE FUNCTION public.fn_web_order_receipt(p_order_id TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('code', o.code, 'created_at', o.created_at, 'customer_name', o.customer_name,
        'subtotal_original', COALESCE(o.subtotal_original, (SELECT SUM(COALESCE(i.line_original, ROUND(i.base_price * i.quantity, 2))) FROM public.web_order_items i WHERE i.order_id = o.id)),
        'discount_total', o.discount_total, 'total', o.total,
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'code', i.product_code, 'unit', i.unit, 'color_name', i.color_name, 'color_hex', i.color_hex,
              'product_id', i.product_id, 'thumb', public.fn_order_item_thumb(i.product_id, i.color_id),
              'quantity', i.quantity, 'base_price', i.base_price, 'unit_price', i.unit_price, 'unit_discount', i.unit_discount,
              'line_original', COALESCE(i.line_original, ROUND(i.base_price * i.quantity, 2)), 'line_discount', i.line_discount, 'line_total', i.line_total,
              'promotion_name', i.promotion_name, 'promo_ends_at', i.promo_ends_at) ORDER BY i.id) FROM public.web_order_items i WHERE i.order_id = o.id), '[]'::JSONB))
      FROM public.web_orders o WHERE o.id = p_order_id;
$$;
REVOKE ALL ON FUNCTION public.fn_web_order_receipt(TEXT) FROM PUBLIC, anon, authenticated;

-- Lista de compras do cliente: + miniaturas (até 4), quantidade, estado da logística e data da última alteração
CREATE OR REPLACE FUNCTION public.fn_customer_orders(p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.created_at DESC) FROM (
        SELECT o.id, o.code, o.created_at, o.updated_at, o.status, o.payment_status, o.fulfillment, o.total, o.discount_total,
               (SELECT COUNT(*) FROM public.web_order_items i WHERE i.order_id = o.id) AS lines,
               (SELECT COALESCE(SUM(i.quantity), 0) FROM public.web_order_items i WHERE i.order_id = o.id) AS qty,
               COALESCE((SELECT jsonb_agg(t.th ORDER BY t.n) FROM (SELECT public.fn_order_item_thumb(i.product_id, i.color_id) AS th, i.id AS n
                           FROM public.web_order_items i WHERE i.order_id = o.id ORDER BY i.id LIMIT 4) t WHERE t.th IS NOT NULL), '[]'::JSONB) AS thumbs
          FROM public.web_orders o WHERE o.customer_id = c.id AND o.store_id = c.store_id ORDER BY o.created_at DESC LIMIT 100) z), '[]'::JSONB);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_customer_order_get(p_slug TEXT, p_order_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.store_customers%ROWTYPE; o public.web_orders%ROWTYPE;
BEGIN
    c := public.fn_cust(p_slug);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND customer_id = c.id AND store_id = c.store_id;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    RETURN public.fn_web_order_receipt(o.id) || jsonb_build_object('id', o.id, 'status', o.status, 'fulfillment', o.fulfillment, 'ready_at', o.ready_at,
        'payment_status', o.payment_status, 'payment_note', o.payment_note, 'payment_reviewed_at', o.payment_reviewed_at,
        'address', o.address, 'phone', o.phone,
        'proofs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('created_at', p.created_at, 'mime', p.mime) ORDER BY p.created_at DESC), '[]'::JSONB) FROM public.order_payment_proofs p WHERE p.order_id = o.id));
END; $$;

-- Depois de um pagamento recusado, o cliente pode enviar novo comprovativo (volta a «pendente»)
CREATE OR REPLACE FUNCTION public.fn__v21_patch(p_name TEXT, p_from TEXT, p_to TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; d TEXT;
BEGIN
    FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = p_name LOOP
        d := pg_get_functiondef(r.oid);
        IF position(p_to IN d) > 0 THEN CONTINUE; END IF;
        IF position(p_from IN d) = 0 THEN RAISE NOTICE 'v21: padrão não encontrado em % (ignorado)', p_name; CONTINUE; END IF;
        EXECUTE replace(d, p_from, p_to);
    END LOOP;
END; $$;
SELECT public.fn__v21_patch('fn_customer_submit_proof', 'AND payment_status = ''NAO_PAGO'';', 'AND payment_status IN (''NAO_PAGO'', ''REJEITADO'');');
DROP FUNCTION IF EXISTS public.fn__v21_patch(TEXT, TEXT, TEXT);

-- ------------------------------ 3. INSTRUÇÕES DE PAGAMENTO E CONTAS (por loja) ------------------------------
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS pay_instructions JSONB NOT NULL DEFAULT '{}'::JSONB;

-- público (loja virtual): só se a loja virtual estiver activa
CREATE OR REPLACE FUNCTION public.fn_public_payment_info(p_slug TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.stores%ROWTYPE;
BEGIN
    SELECT * INTO s FROM public.stores WHERE slug = lower(TRIM(COALESCE(p_slug, '')));
    IF s.id IS NULL OR NOT s.vstore_enabled OR COALESCE(s.acesso_ativo, TRUE) = FALSE THEN RETURN jsonb_build_object('ok', FALSE); END IF;
    PERFORM public.fn_rate_limit('ppay:' || public.fn_client_ip(), 120, 60);
    RETURN jsonb_build_object('ok', TRUE, 'text', COALESCE(s.pay_instructions ->> 'text', ''), 'accounts', COALESCE(s.pay_instructions -> 'accounts', '[]'::JSONB));
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_public_payment_info(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_vstore_get_payment() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); s public.stores%ROWTYPE;
BEGIN
    SELECT * INTO s FROM public.stores WHERE id = v_store;
    RETURN jsonb_build_object('text', COALESCE(s.pay_instructions ->> 'text', ''), 'accounts', COALESCE(s.pay_instructions -> 'accounts', '[]'::JSONB));
END; $$;

CREATE OR REPLACE FUNCTION public.fn_vstore_save_payment(p_text TEXT, p_accounts JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); v_acc JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('method', LEFT(TRIM(COALESCE(x ->> 'method', '')), 60), 'holder', LEFT(TRIM(COALESCE(x ->> 'holder', '')), 120),
                                                  'number', LEFT(TRIM(COALESCE(x ->> 'number', '')), 80), 'extra', LEFT(TRIM(COALESCE(x ->> 'extra', '')), 160))), '[]'::JSONB)
      INTO v_acc
      FROM (SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_accounts) = 'array' THEN p_accounts ELSE '[]'::JSONB END) x
             WHERE jsonb_typeof(x) = 'object'
               AND (NULLIF(TRIM(COALESCE(x ->> 'method', '')), '') IS NOT NULL OR NULLIF(TRIM(COALESCE(x ->> 'number', '')), '') IS NOT NULL) LIMIT 10) q;
    UPDATE public.stores SET pay_instructions = jsonb_build_object('text', LEFT(TRIM(COALESCE(p_text, '')), 1200), 'accounts', v_acc), updated_at = NOW() WHERE id = v_store;
    RETURN jsonb_build_object('success', TRUE);
END; $$;

-- ------------------------------ 4. VALIDAR / RECUSAR PAGAMENTO + AVISO AO CLIENTE ------------------------------
CREATE OR REPLACE FUNCTION public.fn_store_order_set_payment(p_order_id TEXT, p_payment_status TEXT, p_note TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_store TEXT := public.fn_catalog_store_id(ARRAY['ADMIN', 'GERENTE']); o public.web_orders%ROWTYPE; c public.store_customers%ROWTYPE; v_name TEXT;
        v_ids JSONB := '[]'::JSONB; v_ch TEXT; v_cid UUID; v_ok BOOLEAN; v_title TEXT; v_msg TEXT; v_note TEXT := NULLIF(LEFT(TRIM(COALESCE(p_note, '')), 300), '');
BEGIN
    IF p_payment_status NOT IN ('NAO_PAGO', 'COMPROVATIVO_ENVIADO', 'PAGO', 'REJEITADO') THEN RAISE EXCEPTION 'Estado de pagamento inválido.'; END IF;
    PERFORM public.fn_rate_limit('payset:' || auth.uid()::TEXT, 300, 600);
    SELECT * INTO o FROM public.web_orders WHERE id = p_order_id AND store_id = v_store FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Encomenda não encontrada.'; END IF;
    IF o.payment_status = p_payment_status AND v_note IS NOT DISTINCT FROM o.payment_note THEN
        RETURN jsonb_build_object('success', TRUE, 'changed', FALSE, 'campaigns', '[]'::JSONB, 'has_account', o.customer_id IS NOT NULL, 'phone', o.phone, 'message', '');
    END IF;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    UPDATE public.web_orders SET payment_status = p_payment_status, payment_note = CASE WHEN p_payment_status = 'REJEITADO' THEN v_note END,
           payment_reviewed_at = NOW(), payment_reviewed_by_name = v_name, updated_at = NOW() WHERE id = o.id;
    IF p_payment_status = 'PAGO' THEN
        v_title := 'Pagamento validado'; v_msg := 'O pagamento da sua encomenda ' || o.code || ' foi validado. Obrigado!';
    ELSIF p_payment_status = 'REJEITADO' THEN
        v_title := 'Pagamento recusado'; v_msg := 'O pagamento da sua encomenda ' || o.code || ' foi recusado.' || COALESCE(' Motivo: ' || v_note || '.', '') || ' Envie um novo comprovativo ou contacte a loja.';
    END IF;
    IF v_title IS NOT NULL AND o.customer_id IS NOT NULL THEN
        SELECT * INTO c FROM public.store_customers WHERE id = o.customer_id;
        FOREACH v_ch IN ARRAY ARRAY['PUSH', 'WHATSAPP', 'EMAIL'] LOOP
            v_ok := (COALESCE((SELECT granted FROM public.customer_consents WHERE customer_id = c.id AND channel = v_ch), FALSE)
                     OR (v_ch = 'PUSH' AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active AND s.installed)))
                AND CASE v_ch WHEN 'PUSH' THEN EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active)
                              WHEN 'WHATSAPP' THEN c.whatsapp IS NOT NULL AND EXISTS (SELECT 1 FROM public.store_integrations WHERE store_id = v_store AND wa_phone_number_id IS NOT NULL AND wa_template_name IS NOT NULL)
                              ELSE c.email IS NOT NULL END;
            IF v_ok THEN
                v_cid := NULL;
                INSERT INTO public.campaigns (store_id, channel, title, body, url, audience, idempotency_key, kind, order_id)
                VALUES (v_store, v_ch, v_title, v_msg, NULL, '{}'::JSONB, 'pay:' || o.id || ':' || p_payment_status || ':' || v_ch || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MI'), 'PAYMENT', o.id)
                ON CONFLICT (store_id, idempotency_key) DO NOTHING RETURNING id INTO v_cid;
                IF v_cid IS NOT NULL THEN
                    INSERT INTO public.campaign_recipients (campaign_id, customer_id) VALUES (v_cid, c.id);
                    v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_cid, 'channel', v_ch));
                END IF;
            END IF;
        END LOOP;
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'changed', TRUE, 'campaigns', v_ids, 'has_account', o.customer_id IS NOT NULL, 'phone', o.phone, 'message', COALESCE(v_msg, ''));
END; $$;

-- ------------------------------ 5. NOTIFICAÇÕES: APLICAÇÃO INSTALADA = RECEBE DIRECTAMENTE ------------------------------
-- Quem tem a app instalada e uma subscrição push activa (aceitou o pedido de permissão do sistema) está elegível mesmo sem o
-- interruptor «Autorizar» da Área do Cliente. Se desativar as notificações no dispositivo, a subscrição deixa de estar activa.
CREATE OR REPLACE FUNCTION public.fn_campaign_audience(p_store TEXT, p_channel TEXT, p_aud JSONB) RETURNS TABLE (customer_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind TEXT := COALESCE(p_aud ->> 'kind', 'all'); v_min INT := LEAST(GREATEST(COALESCE((p_aud ->> 'min_orders')::INT, 3), 1), 1000); v_days INT := LEAST(GREATEST(COALESCE((p_aud ->> 'days')::INT, 90), 1), 3650);
BEGIN
    IF v_kind NOT IN ('all', 'frequent', 'inactive', 'buyers', 'never', 'new') THEN RAISE EXCEPTION 'Grupo de clientes inválido.'; END IF;
    RETURN QUERY
    SELECT c.id FROM public.store_customers c
      LEFT JOIN public.customer_consents k ON k.customer_id = c.id AND k.channel = p_channel
      LEFT JOIN LATERAL (SELECT COUNT(*) AS n, MAX(w.created_at) AS last_order FROM public.web_orders w WHERE w.customer_id = c.id AND w.store_id = c.store_id AND w.status <> 'CANCELADA') o ON TRUE
     WHERE c.store_id = p_store
       AND (COALESCE(k.granted, FALSE) OR (p_channel = 'PUSH' AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active AND s.installed)))
       AND ((p_channel = 'PUSH' AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active))
            OR (p_channel = 'WHATSAPP' AND c.whatsapp IS NOT NULL)
            OR (p_channel = 'EMAIL' AND c.email IS NOT NULL AND c.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
       AND CASE v_kind WHEN 'frequent' THEN o.n >= v_min WHEN 'inactive' THEN o.n > 0 AND o.last_order < NOW() - (v_days || ' days')::INTERVAL
                       WHEN 'buyers' THEN o.n > 0 WHEN 'never' THEN o.n = 0 WHEN 'new' THEN c.created_at >= NOW() - (v_days || ' days')::INTERVAL ELSE TRUE END;
END; $$;
REVOKE ALL ON FUNCTION public.fn_campaign_audience(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_campaign_claim_batch(p_id UUID, p_n INT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH ch AS (SELECT id, channel FROM public.campaigns WHERE id = p_id AND status IN ('QUEUED', 'SENDING')),
    pick AS (SELECT r.customer_id FROM public.campaign_recipients r JOIN ch ON ch.id = r.campaign_id
              WHERE r.status = 'PENDING' OR (r.status = 'SENDING' AND r.claimed_at < NOW() - INTERVAL '10 minutes')
              ORDER BY r.customer_id LIMIT LEAST(GREATEST(p_n, 1), 100) FOR UPDATE OF r SKIP LOCKED),
    upd AS (UPDATE public.campaign_recipients r SET status = 'SENDING', claimed_at = NOW() FROM pick WHERE r.campaign_id = p_id AND r.customer_id = pick.customer_id RETURNING r.customer_id)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'email', c.email,
        'consent', (COALESCE(k.granted, FALSE) OR ((SELECT channel FROM ch) = 'PUSH' AND EXISTS (SELECT 1 FROM public.push_subscriptions s2 WHERE s2.customer_id = c.id AND s2.active AND s2.installed))),
        'subs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::JSONB) FROM public.push_subscriptions s WHERE s.customer_id = c.id AND s.active))), '[]'::JSONB)
      FROM upd JOIN public.store_customers c ON c.id = upd.customer_id LEFT JOIN public.customer_consents k ON k.customer_id = c.id AND k.channel = (SELECT channel FROM ch);
$$;
REVOKE ALL ON FUNCTION public.fn_campaign_claim_batch(UUID, INT) FROM PUBLIC, anon, authenticated;

-- ------------------------------ PERMISSÕES ------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['fn_vstore_get_payment()', 'fn_vstore_save_payment(text,jsonb)', 'fn_store_order_set_payment(text,text,text)', 'fn_customer_orders(text)', 'fn_customer_order_get(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verificação:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.web_orders'::regclass AND conname = 'web_orders_payment_status_v21';
-- SELECT proname FROM pg_proc WHERE proname IN ('fn_public_payment_info','fn_vstore_get_payment','fn_vstore_save_payment','fn_store_order_set_payment','fn_order_item_thumb');
